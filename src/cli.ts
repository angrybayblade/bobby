#!/usr/bin/env bun
import { parseArgs } from "node:util";
import { readFileSync, statSync, writeFileSync } from "node:fs";
import { resolve as resolvePath } from "node:path";
import { git, parsePrArg, reviewComments, run } from "./git.ts";
import { ghStatus } from "./github.ts";
import { GRAPH_SCHEMA, LEGACY_SCHEMAS, type ReviewGraph, setDiscussion } from "./graph.ts";
import { clean, prune } from "./prune.ts";
import { selfUpdate, tidyUpdate, watchReleases } from "./updates.ts";
import { hold, holder, home, legacyHolder, loadSettings, loadState } from "./state.ts";
import { allow, SERVERS, serverById, startServers, stopServers } from "./servers.ts";
import { resolve, reviewId, start, type ReviewOptions } from "./review.ts";
import { noteRecent, recentOf } from "./recents.ts";
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
    host: { type: "string", default: process.env.BOBBY_HOST ?? "127.0.0.1" },
    "allow-host": { type: "string", multiple: true, default: [] },
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

  bobby                              inside a repo: review this branch (and uncommitted changes);
                                     elsewhere, or with nothing to review: the home page, to pick a PR
                                     (or bobby home)
  bobby <pr-url | number>            extract + open the review UI for a PR
  bobby <pr-url>/changes/<sha>       just that commit of the PR (against its parent), or <from>..<to>
  bobby extract [pr] [-o file.json]  write the review graph (${GRAPH_SCHEMA}) and exit
  bobby open <graph.json>            open the UI on an existing graph file
  bobby lsp                          the language servers behind the inspector, by language
  bobby lsp install <language>       install one (typescript, python), or say how (go)
  bobby update [version]             install the newest release (or that one) in place of this one
  bobby clean [--repos]              remove caches and exported trees (and with --repos, the clones
                                     in ~/.bobby/repos); your reviews' progress stays

  --base <ref>   no PR: the branch to compare against (default: this branch's PR base,
                 origin's default branch, then main/master/develop/trunk; asks if none)
  --repo <dir>   local clone (default: cwd, else auto-clone to ~/.bobby/repos)
  --port <n>     UI port (default 4173)
  --host <addr>  the address to listen on (default 127.0.0.1, this machine only; 0.0.0.0 for
                 every interface, as on a cloud VM). Also $BOBBY_HOST
  --allow-host <name[:port]>   another name the page may be opened at, as a VM's IP or DNS name
                 (any port, or only that one; * for any name); repeat it or separate with commas.
                 Also $BOBBY_ALLOW_HOSTS. localhost at any port (an SSH tunnel) always works
  --no-llm       static analysis only; skip Claude
  --no-lsp       don't start language servers (the inspector then answers from imports alone)
  --lsp          extract: ask the installed language servers too (slower: they load the project first)
  --refresh      rebuild everything for this commit (ignore cached graphs, Claude tree and language server answers)
  --no-open      don't open the browser
  -v, --version  print the version`;

const [cmd, arg] = ["extract", "open", "lsp", "clean", "home", "update"].includes(positionals[0]) ? [positionals[0], positionals[1]] : ["review", positionals[0]];
if (values.version) {
  console.log(pkg.version);
  process.exit(0);
}
if (values.help || (cmd === "open" && !arg)) {
  console.log(USAGE);
  process.exit(values.help ? 0 : 1);
}
// Not a PR (a typo, or a command this version doesn't have): say so now, not after starting, or offering to set gh up.
if (cmd === "review" && arg) try { parsePrArg(arg); } catch (e) {
  const m = (e as Error).message;
  fail(m.startsWith("Expected") ? `${m} (bobby --help lists the commands)` : m);
}
if (!/^\d{1,5}$/.test(values.port!) || Number(values.port) > 65535) fail(`--port takes a port number (0–65535), got "${values.port}"`);
if (values.repo && !statSync(values.repo, { throwIfNoEntry: false })?.isDirectory()) fail(`--repo takes a folder with a git checkout, got "${values.repo}"`);
if (cmd === "lsp") process.exit(await lspCommand(arg, positionals[2]));
if (cmd === "update") {
  await selfUpdate(arg, (m) => console.log(m));
  const other = holder(); // it holds the old binary in memory
  if (other) console.log(`  The Bobby running on port ${other.port} is still the old one: stop it (ctrl-c) and start it again.`);
  process.exit(0);
}
tidyUpdate();
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

// No PR and not in a repo (or `bobby home`): the home page, to pick one.
const toHome = cmd === "home" || (cmd === "review" && !arg && !(await git(values.repo ?? process.cwd(), ["rev-parse", "--show-toplevel"], true)).trim());

// A Bobby app already running: it opens the review (it's the one with your other reviews' progress in memory), and this
// one only points the browser at it.
const running = await runningApp();
if (running && toHome) {
  console.log(`  Bobby is already running\n\n  ▶ ${running}/\n`);
  if (!values["no-open"]) await run(openCommand(`${running}/`), { allowFail: true }).catch(() => {});
  process.exit(0);
}
if (running) {
  if (cmd === "open") fail(`Bobby is already running at ${running}: stop it to open a graph file`);
  const local = arg ? undefined : values.repo ?? process.cwd();
  const r = await fetch(`${running}/api/open`, { method: "POST", headers: { "content-type": "application/json", origin: running }, body: JSON.stringify({ arg, repo: arg ? values.repo && resolvePath(values.repo) : resolvePath(local!), cwd: process.cwd(), base: values.base, refresh: values.refresh, noLlm: values["no-llm"], noLsp: values["no-lsp"] }) });
  const out = (await r.json()) as { id?: string; error?: string; setup?: string };
  if (!out.id && arg && out.setup === "gh") { // its page sets gh up, then opens the PR
    const url = `${running}/?open=${encodeURIComponent(arg)}`;
    console.log(`  ${out.error}\n  GitHub's CLI isn't set up: the page sets it up, then opens the PR\n\n  ▶ ${url}\n`);
    if (!values["no-open"]) await run(openCommand(url), { allowFail: true }).catch(() => {});
    process.exit(0);
  }
  if (!out.id && arg) fail(out.error ?? `Bobby at ${running} couldn't open it`);
  // a bare `bobby` in a repo with nothing to review: the home page instead
  const url = out.id ? `${running}/r/${out.id}` : `${running}/`;
  console.log(out.id ? `  opened in the Bobby already running (its terminal shows the progress)\n\n  ▶ ${url}\n`
    : `  ${out.error ?? "Nothing to review here"}\n  opening the home page instead\n\n  ▶ ${url}\n`);
  if (!values["no-open"]) await run(openCommand(url), { allowFail: true }).catch(() => {});
  process.exit(0);
}

const app: App = { reviews: new Map(), loading: new Map() };
// Opening a review: named at once (resolve), built in the background, so its page can show the progress.
app.open = async (a, o) => {
  // what the build logs is also its page's progress
  const steps: string[] = [];
  const ro: ReviewOptions = { ...opts, ...o, log: (m) => { opts.log(m); steps.push(m.trim()); } };
  const resolved = await resolve(a, ro);
  const id = resolved.id;
  // TODO(0.1.0): remove with legacyHolder (state.ts): an rc Bobby still serving this review can't be handed it
  const old = legacyHolder(resolved.key);
  if (old) throw new Error(`An older Bobby (pid ${old.pid}) has this review open at http://127.0.0.1:${old.port}: stop it first, or the two would save over each other's progress.`);
  if (app.reviews.has(id) || (app.loading.has(id) && !app.loading.get(id)!.error)) return id;
  app.loading.set(id, { title: resolved.title, steps, startedAt: Date.now() });
  resolved.build().then(
    (p) => {
      const s = start(p, ro);
      s.id = id; s.seenAt = Date.now();
      app.reviews.set(id, s); app.loading.delete(id);
      void noteRecent(recentOf(id, p.staticGraph.pr, p.cwd));
    },
    (e) => { app.loading.set(id, { title: resolved.title, steps, startedAt: Date.now(), error: String(e?.message ?? e) }); console.error(`  ✗ ${resolved.title}: ${e?.message ?? e}`); },
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
    if (discussion) setDiscussion(graph, discussion);
  }
  const session: Session = { cwd: values.repo ?? null, staticGraph: graph, state: loadState({ ...graph.pr }), llm: "off", refresh: values.refresh };
  void startServers(session, { ask: true, off: values["no-lsp"], log });
  const id = reviewId(graph.pr);
  session.seenAt = Infinity; // a graph file can't be built again: it stays loaded
  app.reviews.set(id, session);
  path = `/r/${id}`;
} else if (!toHome) {
  // a bare `bobby` in a repo with nothing to review (on main, say) still starts: on the home page
  const id = await app.open(arg, { repo: values.repo, base: values.base }).catch(async (e) => {
    const gh = await ghStatus();
    if (arg && !(gh.installed && gh.loggedIn)) { // the page sets gh up, then opens the PR
      console.log(`  ${e.message}\n  GitHub's CLI isn't set up: the page sets it up, then opens the PR`);
      app.waiting = { arg, o: { repo: values.repo, base: values.base } };
      path = `/?open=${encodeURIComponent(arg)}`;
      return null;
    }
    if (arg) throw e;
    console.log(`  ${e.message}\n  opening the home page instead`);
    return null;
  });
  if (id) path = `/r/${id}`;
}
await serve(app, path);

// A review no page has asked about for 15 minutes (an open page polls every 10 s) is unloaded: its language servers and
// watchers stop, and it's built again (from the cache) when opened. Its progress is saved as you go.
const IDLE = 15 * 60_000;
setInterval(() => {
  for (const [id, s] of app.reviews) {
    if (Date.now() - (s.seenAt ?? 0) < IDLE) continue;
    app.reviews.delete(id);
    s.stopWatching?.();
    void stopServers(s);
    log(`  ▸ closed ${id}: no page open on it for 15 minutes (reopen it from the home page)`);
  }
}, 60_000);

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
  const hostname = values.host!, open = !["127.0.0.1", "localhost", "::1"].includes(hostname);
  const allow = [...(values["allow-host"] ?? []), ...(process.env.BOBBY_ALLOW_HOSTS ?? "").split(",")].flatMap((h) => h.split(",")).map((h) => h.trim()).filter(Boolean);
  if (open && !["0.0.0.0", "::"].includes(hostname)) allow.push(hostname); // listening on one address: its own name is fine
  try { server = startServer(app, Number(values.port), { hostname, allow }); }
  catch (e) {
    if (!/EADDRINUSE|in use/i.test(String((e as Error).message ?? e))) throw e;
    server = startServer(app, 0, { hostname, allow });
    console.log(`  port ${values.port} is in use, using ${server.port}`);
  }
  const here = open && !hostname.includes(":") && hostname !== "0.0.0.0" ? hostname : "127.0.0.1"; // on one address only, loopback doesn't reach it
  const url = `http://${here}:${server.port}${path}`;
  if (open) { // reachable from elsewhere, with no sign-in: say so, every time
    console.log(`\n  ⚠ Listening on ${hostname}:${server.port}. Anyone who can reach this port can read the code under review and post\n    on GitHub as you: keep it behind a firewall, a VPN or an SSH tunnel.`);
    const names = allow.filter((h) => h !== "*").map((h) => (/:\d+$/.test(h) ? `http://${h}${path}` : `http://${h}:${server.port}${path}`));
    if (names.length) console.log(`  ▶ ${names.join("\n  ▶ ")}`);
    else if (!allow.includes("*")) console.log(`  Opening it at this machine's IP or name? Add --allow-host <that name>.`);
  }
  app.self = `http://${here.includes(":") ? `[${here}]` : here}:${server.port}`; // for Claude to reach Bobby's tools
  hold(server.port!);
  watchReleases((r) => { app.release = r; console.log(`  ▸ Bobby ${r.version} is out (you have ${pkg.version}). Update: ${r.how} (${r.url})`); });
  console.log(`\n  ▶ ${url}\n`);
  if (!values["no-open"]) await run(openCommand(url), { allowFail: true }).catch(() => console.log("  (open that link in your browser)"));
}

function openCommand(url: string) {
  if (process.platform === "darwin") return ["open", url];
  if (process.platform === "win32") return ["cmd", "/c", "start", "", url];
  return ["xdg-open", url];
}
