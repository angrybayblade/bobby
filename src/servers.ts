// Which language servers a review runs, and their lives: detected from the PR's files, asked about before anything is
// installed, started in the background (the UI is usable meanwhile), and their answers merged into the definitions.
import type { ReviewGraph } from "./graph.ts";
import { go } from "./go.ts";
import { Inspector } from "./inspect.ts";
import { headTree, keepTree, type LanguageServer, type Offer } from "./langserver.ts";
import { python } from "./python.ts";
import type { Session } from "./server.ts";
import { loadCachedDefs, loadSettings, saveCachedDefs, saveSettings } from "./state.ts";
import type { Definition } from "./types.ts";
import { typescript } from "./typescript.ts";

/** Every language with a server. A new one is a LanguageServer added here. */
export const SERVERS: LanguageServer[] = [typescript, python, go];
export const serverById = (id: string) => SERVERS.find((s) => s.id === id);

// consent: Bobby can install it and is waiting for a yes; missing: something to install yourself (hint, command);
// installing, pending (loading the project), done, failed; off: not wanted (--no-lsp, "never", "not now").
export type ServerState = "consent" | "missing" | "installing" | "pending" | "done" | "failed" | "off";
export interface ServerInfo {
  id: string; title: string; state: ServerState;
  error?: string; hint?: string; command?: string; offer?: Offer;
  placed?: number; names?: number; // names placed by it, of its files' names
}
type Log = (m: string) => void;

/** The servers for the languages a review's files are in. */
export const serversFor = (g: ReviewGraph) => SERVERS.filter((s) => g.files.some((f) => f.status !== "deleted" && s.languageId(f.path)));

/** Decides, for each language in the review, whether its server runs, waits for a yes, or needs something installed;
 *  starts those that can run. Resolves when every started server is done or failed. ask: whether a server Bobby can
 *  install waits for a yes (the UI asks), or is skipped with a hint (extract). */
export async function startServers(s: Session, opts: { ask: boolean; off?: boolean; log: Log }) {
  s.servers = {};
  s.inspectors = {};
  s.log = opts.log;
  const wanted = serversFor(s.staticGraph);
  for (const srv of wanted) s.servers[srv.id] = { id: srv.id, title: srv.title, state: opts.off || !s.cwd ? "off" : "pending" }; // pending until decided: the page polls
  if (opts.off || !s.cwd) return;
  process.once("SIGINT", () => void stopServers(s).finally(() => process.exit(130)));
  await Promise.all(wanted.map((srv) => decide(s, srv, opts.ask).catch((e) => { // never takes the review down: that language just has no server
    Object.assign(s.servers![srv.id], { state: "failed", error: String((e as Error).message ?? e) });
    console.error(`  ✗ ${srv.title} language server: ${s.servers![srv.id].error}`);
  })));
}

async function decide(s: Session, srv: LanguageServer, ask: boolean) {
  const info = s.servers![srv.id], log = s.log!;
  if ((loadSettings().servers as Record<string, string> | undefined)?.[srv.id] === "never") {
    Object.assign(info, { state: "off", hint: `Turned off for ${srv.title}. bobby lsp install ${srv.id} turns it back on.` });
    return;
  }
  const missing = await srv.missing(); // first: it looks afresh (gopls you've just installed)
  if (missing) {
    Object.assign(info, { state: "missing", ...missing });
    log(`  ${missing.hint}${missing.command ? ` ${missing.command}` : ""}`);
    return;
  }
  if (await srv.installed()) return run(s, srv);
  if (srv.offer && ask) {
    Object.assign(info, { state: "consent", offer: srv.offer });
    log(`  ${srv.title} types: the language server isn't installed. The review asks first; or run bobby lsp install ${srv.id}`);
    return;
  }
  Object.assign(info, { state: "off", hint: `Not installed: bobby lsp install ${srv.id}` });
  log(`  ${srv.title} types: skipped, the language server isn't installed (bobby lsp install ${srv.id})`);
}

/** After a yes: installs the server, then starts it. Never asks again for that language. */
export async function installServer(s: Session, id: string) {
  const srv = serverById(id), info = s.servers?.[id];
  if (!srv?.install || !info || !["consent", "off", "failed"].includes(info.state)) return;
  allow(id);
  Object.assign(info, { state: "installing", error: undefined, hint: undefined });
  try {
    await srv.install(s.log!);
  } catch (e) {
    Object.assign(info, { state: "failed", error: String((e as Error).message ?? e) });
    return;
  }
  await run(s, srv);
}
/** Looks again for a prerequisite you installed yourself (gopls), and starts the server if it's there now. */
export async function recheckServer(s: Session, id: string) {
  const srv = serverById(id), info = s.servers?.[id];
  if (!srv || !info || info.state !== "missing") return;
  Object.assign(info, { hint: undefined, command: undefined });
  await decide(s, srv, true);
}
/** "Not now" (this review) or "never" (saved). */
export function declineServer(s: Session, id: string, never: boolean) {
  const info = s.servers?.[id];
  if (!info) return;
  Object.assign(info, { state: "off", offer: undefined, hint: never ? `Turned off for ${info.title}. bobby lsp install ${id} turns it back on.` : undefined });
  if (never) saveSettings({ ...loadSettings(), servers: { ...((loadSettings().servers as object) ?? {}), [id]: "never" } });
}
/** Clears a "never", as installing from the command line does. */
export function allow(id: string) {
  const all = { ...((loadSettings().servers as Record<string, string>) ?? {}) };
  if (all[id] !== "never") return;
  delete all[id];
  saveSettings({ ...loadSettings(), servers: all });
}

async function run(s: Session, srv: LanguageServer) {
  const info = s.servers![srv.id], log = s.log!, g = s.staticGraph, pr = g.pr, t0 = Date.now();
  Object.assign(info, { state: "pending", error: undefined, hint: undefined, offer: undefined });
  const cacheable = pr.provider !== "local"; // a local review reads your working copy, which changes
  try {
    const key = `${await srv.version()}.${g.generator.extraction ?? g.generator.version}`; // what it placed depends on the names extraction found
    const cached = cacheable ? loadCachedDefs(pr, key) : null;
    if (cached) merge(s, cached);
    const root = await treeRoot(s);
    log(`▸ starting the ${srv.title} language server…`);
    const insp = (s.inspectors![srv.id] = await Inspector.start(srv, root, log));
    insp.onExit((why) => { // it stopped on its own: say so, and answer from imports from now on
      Object.assign(info, { state: "failed", error: `the language server stopped: ${why}` });
      console.error(`  ✗ ${srv.title}: ${info.error}. Its names are found through imports from now on.`);
    });
    const mine = Object.fromEntries(Object.entries(g.definitions ?? {}).filter(([p]) => srv.languageId(p)));
    if (cached) { // already placed: one name loads the project, so the inspector's first answer is quick
      const [path, list] = Object.entries(mine).find(([, l]) => l.length) ?? [];
      if (path && list) await insp.definitions({ [path]: list.slice(0, 1) });
    } else {
      const placed = await insp.definitions(mine);
      merge(s, placed);
      if (cacheable) saveCachedDefs(pr, key, placed);
    }
    const all = Object.entries(s.definitions ?? {}).filter(([p]) => srv.languageId(p)).flatMap(([, l]) => l);
    Object.assign(info, { state: "done", placed: all.filter((d) => d.via === "lsp").length, names: all.length });
    log(`  ✓ ${srv.title} language server ready: ${info.placed} of ${info.names} names placed by it (${((Date.now() - t0) / 1000).toFixed(1)}s)`);
  } catch (e) {
    Object.assign(info, { state: "failed", error: String((e as Error).message ?? e) });
    console.error(`  ✗ ${srv.title} language server: ${info.error}. Its names are found through imports.`);
  }
}

/** The code servers read: your working copy for a local review, else the PR's head exported once (every language's
 *  files, so a server you agree to later reads the same tree), kept marked as in use while Bobby runs. */
function treeRoot(s: Session): Promise<string> {
  const pr = s.staticGraph.pr;
  if (pr.provider === "local") return Promise.resolve(s.cwd!);
  return (s.root ??= headTree(s.cwd!, pr, SERVERS).then((dir) => { setInterval(() => keepTree(dir), 3_600_000).unref(); return dir; }));
}
function merge(s: Session, placed: Record<string, Definition[]>) {
  s.definitions = { ...(s.definitions ?? s.staticGraph.definitions ?? {}), ...placed };
}

export async function stopServers(s: Session) {
  await Promise.all(Object.values(s.inspectors ?? {}).map((i) => i.stop()));
}
/** The inspector for a file, if its language's server is up. */
export const inspectorFor = (s: Session, path: string) =>
  Object.values(s.inspectors ?? {}).find((i) => i.reads(path) && i.alive && s.servers?.[i.server.id]?.state === "done");
export const serverInfoFor = (s: Session, path: string) => {
  const srv = SERVERS.find((x) => x.languageId(path));
  return srv ? s.servers?.[srv.id] : undefined;
};
