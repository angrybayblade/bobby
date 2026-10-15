#!/usr/bin/env bun
import { parseArgs } from "node:util";
import { readFileSync, statSync, writeFileSync } from "node:fs";
import { resolve as resolvePath } from "node:path";
import { reviewComments, run } from "./git.ts";
import { GRAPH_SCHEMA, LEGACY_SCHEMAS, type ReviewGraph } from "./graph.ts";
import { clean, prune } from "./prune.ts";
import { watchReleases } from "./updates.ts";
import { hold, holder, home, loadSettings, loadState } from "./state.ts";
import { allow, SERVERS, serverById, startServers, stopServers } from "./servers.ts";
import { resolve, reviewId, start, type ReviewOptions } from "./review.ts";
import { type App, startServer, type Session } from "./server.ts";
import pkg from "../package.json" with { type: "json" };

// A failure is one line (no such file, a git or gh error), not a stack trace; BOBBY_DEBUG=1 shows the trace too.
const fail = (e: unknown) => {
  console.error(`✗ ${(e as Error)?.message ?? e}`);
  if (process.env.BOBBY_DEBUG) console.error((e as Error)?.stack);
  process.exit(1);
};
process.on("uncaughtException", fail);
process.on("unhandledRejection", fail);

const { values, positionals } = parseArgs({
  args: Bun.argv.slice(2),
  allowPositionals: true,
  options: {
    repo: { type: "string" },
    base: { type: "string" },
    port: { type: "string", default: "4173" },
    out: { type: "string", short: "o" },
    "no-llm": { type: "boolean", default: false },
    "no-lsp": { type: "boolean", default: false },
    lsp: { type: "boolean", default: false },
    refresh: { type: "boolean", default: false },
    "no-open": { type: "boolean", default: false },
    repos: { type: "boolean", default: false },
    help: { type: "boolean", short: "h", default: false },
    version: { type: "boolean", short: "v", default: false },
  },
});

const USAGE = `bobby: review a PR one focused page at a time

  bobby                              inside a repo: review this branch (and uncommitted changes)
  bobby <pr-url | number>            extract + open the review UI for a PR
  bobby <pr-url>/changes/<sha>       just that commit of the PR (against its parent), or <from>..<to>
  bobby extract [pr] [-o file.json]  write the review graph (${GRAPH_SCHEMA}) and exit
  bobby open <graph.json>            open the UI on an existing graph file
  bobby lsp                          the language servers behind the inspector, by language
  bobby lsp install <language>       install one (typescript, python), or say how (go)
  bobby clean [--repos]              remove caches and exported trees (and with --repos, the clones
                                     in ~/.bobby/repos); your reviews' progress stays

  --base <ref>   no PR: the branch to compare against (default: this branch's PR base,
                 origin's default branch, then main/master/develop/trunk; asks if none)
  --repo <dir>   local clone (default: cwd, else auto-clone to ~/.bobby/repos)
  --port <n>     UI port (default 4173)
  --no-llm       static analysis only; skip Claude
  --no-lsp       don't start language servers (the inspector then answers from imports alone)
  --lsp          extract: ask the installed language servers too (slower: they load the project first)
  --refresh      rebuild everything for this commit (ignore cached graphs, Claude tree and language server answers)
  --no-open      don't open the browser
  -v, --version  print the version`;

const [cmd, arg] = ["extract", "open", "lsp", "clean"].includes(positionals[0]) ? [positionals[0], positionals[1]] : ["review", positionals[0]];
if (values.version) {
  console.log(pkg.version);
  process.exit(0);
}
if (values.help || (cmd === "open" && !arg)) {
  console.log(USAGE);
  process.exit(values.help ? 0 : 1);
}
if (!/^\d{1,5}$/.test(values.port!) || Number(values.port) > 65535) fail(`--port takes a port number (0–65535), got "${values.port}"`);
if (values.repo && !statSync(values.repo, { throwIfNoEntry: false })?.isDirectory()) fail(`--repo takes a folder with a git checkout, got "${values.repo}"`);
if (cmd === "lsp") process.exit(await lspCommand(arg, positionals[2]));
if (cmd === "clean") {
  const freed = clean(SERVERS, !!values.repos);
  const mb = (b: number) => `${(b / 1e6).toFixed(b < 1e7 ? 1 : 0)} MB`;
  for (const [what, b] of freed) console.log(`  removed ${what}: ${mb(b)}`);
  console.log(freed.length ? `✓ freed ${mb(freed.reduce((n, [, b]) => n + b, 0))}${values.repos ? "" : `; the clones in ${home()}/repos stay (--repos removes them too)`}` : "✓ nothing to remove");
  process.exit(0);
}
// Housekeeping, once Bobby is up: caches for commits not opened in a month, other versions of language servers.
if (cmd !== "extract") setTimeout(() => { try { prune(SERVERS); } catch { /* best effort */ } }, 15_000).unref();

/** bobby lsp: where each language's server stands. bobby lsp install <language>: installs it (or says how), and
 *  clears a "never" given in the UI. */
async function lspCommand(sub?: string, id?: string): Promise<number> {
  if (sub === "install") {
    const srv = id ? serverById(id) : undefined;
    if (!srv) { console.error(`Which language? ${SERVERS.map((s) => s.id).join(", ")}`); return 1; }
    allow(srv.id);
    if (await srv.installed()) { console.log(`✓ ${srv.title}: already installed (${await srv.version()})`); return 0; }
    const missing = await srv.missing();
    if (missing || !srv.install) { console.log(`${srv.title}: ${missing?.hint ?? "Bobby can't install this one."}${missing?.command ? `\n  ${missing.command}` : ""}`); return 1; }
    await srv.install((m) => console.log(m));
    console.log(`✓ ${srv.title}: installed (${await srv.version()})`);
    return 0;
  }
  if (sub) { console.error(USAGE); return 1; }
  const never = (loadSettings().servers ?? {}) as Record<string, string>;
  for (const srv of SERVERS) {
    const status = (await srv.installed()) ? `installed (${await srv.version()})`
      : await srv.missing().then((m) => m ? `${m.hint}${m.command ? ` ${m.command}` : ""}` : `not installed: bobby lsp install ${srv.id}${srv.offer ? ` (${srv.offer.size}, ${srv.offer.from})` : ""}`);
    console.log(`${srv.title.padEnd(12)} ${status}${never[srv.id] === "never" ? "  [turned off in the UI]" : ""}`);
  }
  return 0;
}
const log = (m: string) => (cmd === "extract" && !values.out ? console.error(m) : console.log(m));
const opts: ReviewOptions & { refresh?: boolean } = { repo: values.repo, base: values.base, refresh: values.refresh, noLlm: values["no-llm"], noLsp: values["no-lsp"], log };

if (cmd === "extract") {
  const p = await (await resolve(arg, opts)).build();
  let graph = p.claudeGraph ?? p.staticGraph;
  if (p.wantLlm) {
    log("▸ asking Claude to build the change tree…");
    graph = await p.claude().catch((e) => (log(`  ✗ Claude failed, writing static graph: ${e.message}`), p.staticGraph));
  }
  if (values.lsp) { // the servers that are installed; none is installed without asking
    const s: Session = { cwd: p.cwd, staticGraph: graph, state: { headSha: graph.pr.headSha, marks: {}, comments: [] }, llm: "off", refresh: values.refresh };
    await startServers(s, { ask: false, log });
    await stopServers(s);
    if (s.definitions) graph = { ...graph, definitions: s.definitions };
  }
  const text = JSON.stringify(graph, null, 1);
  if (values.out) { writeFileSync(values.out, text); log(`  ✓ wrote ${values.out}`); }
  else console.log(text);
  process.exit(0);
}

// A Bobby app already running: it opens the review (it's the one with your other reviews' progress in memory), and this
// one only points the browser at it.
const running = await runningApp();
if (running) {
  if (cmd === "open") fail(`Bobby is already running at ${running}: stop it to open a graph file`);
  const local = arg ? undefined : values.repo ?? process.cwd();
  const r = await fetch(`${running}/api/open`, { method: "POST", headers: { "content-type": "application/json", origin: running }, body: JSON.stringify({ arg, repo: arg ? values.repo && resolvePath(values.repo) : resolvePath(local!), cwd: process.cwd(), base: values.base, refresh: values.refresh, noLlm: values["no-llm"], noLsp: values["no-lsp"] }) });
  const out = (await r.json()) as { id?: string; error?: string };
  if (!out.id) fail(out.error ?? `Bobby at ${running} couldn't open it`);
  const url = `${running}/r/${out.id}`;
  console.log(`  opened in the Bobby already running (its terminal shows the progress)\n\n  ▶ ${url}\n`);
  if (!values["no-open"]) await run(openCommand(url), { allowFail: true }).catch(() => {});
  process.exit(0);
}

const app: App = { reviews: new Map(), loading: new Map() };
// Opening a review: named at once (resolve), built in the background, so its page can show the progress.
app.open = async (a, o) => {
  const ro: ReviewOptions = { ...opts, ...o };
  const resolved = await resolve(a, ro);
  const id = resolved.id;
  if (app.reviews.has(id) || (app.loading.has(id) && !app.loading.get(id)!.error)) return id;
  app.loading.set(id, { title: resolved.title });
  resolved.build().then(
    (p) => { app.reviews.set(id, start(p, ro)); app.loading.delete(id); },
    (e) => { app.loading.set(id, { title: resolved.title, error: String(e?.message ?? e) }); console.error(`  ✗ ${resolved.title}: ${e?.message ?? e}`); },
  );
  return id;
};

let path = "/";
if (cmd === "open") {
  const graph = JSON.parse(readFileSync(arg, "utf8")) as ReviewGraph;
  if (graph.schema !== GRAPH_SCHEMA && !LEGACY_SCHEMAS.includes(graph.schema)) throw new Error(`Unsupported graph schema: ${graph.schema}`);
  // The file's comments are as of its extraction: read the PR's current ones, keeping the file's if GitHub can't be reached.
  if (graph.pr.provider !== "local" && graph.pr.number) {
    const discussion = await reviewComments(graph.pr, true).catch(() => null);
    if (discussion) graph.discussion = discussion;
  }
  const session: Session = { cwd: values.repo ?? null, staticGraph: graph, state: loadState({ ...graph.pr }), llm: "off", refresh: values.refresh };
  void startServers(session, { ask: true, off: values["no-lsp"], log });
  const id = reviewId(graph.pr);
  app.reviews.set(id, session);
  path = `/r/${id}`;
} else {
  const id = await app.open(arg, { repo: values.repo, base: values.base }).catch((e) => {
    if (!arg) { console.error(`✗ ${e.message}\n\n${USAGE}`); process.exit(1); }
    throw e;
  });
  path = `/r/${id}`;
}
await serve(app, path);

/** The Bobby app already running, by its lock, if it answers. */
async function runningApp(): Promise<string | null> {
  const other = holder();
  if (!other) return null;
  const url = `http://127.0.0.1:${other.port}`;
  return (await fetch(`${url}/api/avatar?u=`, { signal: AbortSignal.timeout(1500) }).then((r) => r.status === 400, () => false)) ? url : null;
}

async function serve(app: App, path: string) {
  // The default port may be taken (a dev server): fall back to any free one.
  let server;
  try { server = startServer(app, Number(values.port)); }
  catch (e) {
    if (!/EADDRINUSE|in use/i.test(String((e as Error).message ?? e))) throw e;
    server = startServer(app, 0);
    console.log(`  port ${values.port} is in use, using ${server.port}`);
  }
  const url = `http://127.0.0.1:${server.port}${path}`;
  hold(server.port!);
  watchReleases((r) => { app.release = r; console.log(`  ▸ Bobby ${r.version} is out (you have ${pkg.version}): ${r.url}`); });
  console.log(`\n  ▶ ${url}\n`);
  if (!values["no-open"]) await run(openCommand(url), { allowFail: true }).catch(() => console.log("  (open that link in your browser)"));
}

function openCommand(url: string) {
  if (process.platform === "darwin") return ["open", url];
  if (process.platform === "win32") return ["cmd", "/c", "start", "", url];
  return ["xdg-open", url];
}
