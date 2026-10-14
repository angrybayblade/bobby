#!/usr/bin/env bun
import { parseArgs } from "node:util";
import { readFileSync, statSync, writeFileSync } from "node:fs";
import { fetchPr, git, resolvePr, reviewComments, run } from "./git.ts";
import { resolveLocal } from "./local.ts";
import { parseDiff } from "./diff.ts";
import { analyze, heuristicTree, type Analysis } from "./analyze.ts";
import { claudeTree } from "./llm.ts";
import { buildGraph, GRAPH_SCHEMA, LEGACY_SCHEMAS, VERSION, type ReviewGraph } from "./graph.ts";
import { clean, prune } from "./prune.ts";
import { hold, holder, home, loadCachedGraphs, loadCachedTree, loadSettings, loadState, saveCachedGraphs, saveCachedTree } from "./state.ts";
import { allow, SERVERS, serverById, startServers, stopServers } from "./servers.ts";
import type { FileDiff, PrInfo } from "./types.ts";
import { startServer, type Session } from "./server.ts";
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

if (cmd === "open") {
  const graph = JSON.parse(readFileSync(arg, "utf8")) as ReviewGraph;
  if (graph.schema !== GRAPH_SCHEMA && !LEGACY_SCHEMAS.includes(graph.schema)) throw new Error(`Unsupported graph schema: ${graph.schema}`);
  // The file's comments are as of its extraction: read the PR's current ones, keeping the file's if GitHub can't be reached.
  if (graph.pr.provider !== "local" && graph.pr.number) {
    const discussion = await reviewComments(graph.pr, true).catch(() => null);
    if (discussion) graph.discussion = discussion;
  }
  if (await alreadyOpen(graph.pr)) process.exit(0);
  const session: Session = { cwd: values.repo ?? null, staticGraph: graph, state: loadState({ ...graph.pr }), llm: "off", refresh: values.refresh };
  void startServers(session, { ask: true, off: values["no-lsp"], log });
  await serve(session, graph.pr);
} else {
  const t0 = Date.now();
  const secs = () => `${((Date.now() - t0) / 1000).toFixed(1)}s`;
  // Where the change comes from: a PR (fetched), or with no PR argument, the branch you're on.
  let cwd: string, key: { owner: string; repo: string; number: number; branch?: string; headSha: string; baseSha?: string; baseRef?: string };
  let getPr: () => Promise<PrInfo>, discussion: Awaited<ReturnType<typeof reviewComments>> = [];
  if (arg) {
    log("▸ fetching PR…");
    const resolved = await resolvePr(arg, values.repo);
    cwd = resolved.cwd;
    key = { owner: resolved.owner, repo: resolved.repo, number: resolved.meta.number, headSha: resolved.meta.headRefOid, baseRef: resolved.meta.baseRefName };
    log(`  #${key.number} ${resolved.meta.title}`);
    getPr = () => fetchPr(resolved);
  } else {
    const local = await resolveLocal(values.repo ?? process.cwd(), values.base).catch((e) => { console.error(`✗ ${e.message}\n\n${USAGE}`); process.exit(1); });
    cwd = local.cwd;
    const { pr } = local;
    key = { ...pr };
    log(`▸ ${pr.branch} vs ${pr.baseRef} (${local.why})${local.dirty ? ", with uncommitted changes" : ""}`);
    if (local.untracked) log(`  ${local.untracked} untracked file(s) left out: \`git add -N <file>\` to include one`);
    getPr = async () => pr;
  }
  if (cmd !== "extract" && await alreadyOpen(key)) process.exit(0);

  // Same head commit as last time → reuse the built graphs. Comments still change, so they're always re-read.
  const hit = values.refresh ? null : loadCachedGraphs(key);
  const cached = hit?.static.generator.extraction === VERSION ? hit : null;
  if (arg) discussion = await reviewComments(key);
  if (discussion.length) log(`  ${discussion.length} existing review comment(s)`);

  // Fetch + diff + analysis, only when something needs it (a new head, or Claude's tree still missing).
  let built: Promise<{ pr: PrInfo; files: FileDiff[]; analysis: Analysis }> | null = null;
  const extract = () => (built ??= (async () => {
    const pr = await getPr();
    log("▸ diffing & tracing references…");
    const files = parseDiff(await git(cwd, ["diff", "--no-color", "--no-ext-diff", "-M", "-U3", pr.baseSha, pr.headSha]));
    const analysis = await analyze(cwd, pr, files);
    const hunks = files.reduce((n, f) => n + f.hunks.length, 0);
    log(`  ${files.length} files · ${hunks} hunks · ${analysis.units.length} units · ${analysis.refs.length} untouched refs (${secs()})`);
    return { pr, files, analysis };
  })());

  // The clone may lack the cached graph's commits (a fresh clone, a fork's PR, refs/bobby deleted and collected): the
  // UI reads files at both, and the language server exports head. Fetch them as a miss would.
  if (cached && arg) {
    const has = async (sha: string) => (await Bun.spawn(["git", "cat-file", "-e", `${sha}^{commit}`], { cwd, stderr: "ignore" }).exited) === 0;
    if (!(await has(cached.static.pr.headSha)) || !(await has(cached.static.pr.baseSha))) { log("▸ fetching PR…"); await getPr(); }
  }

  let staticGraph: ReviewGraph, claudeGraph: ReviewGraph | undefined;
  if (cached) {
    log(`  ✓ unchanged since last time (${key.headSha.slice(0, 7)}), using cached graphs (${secs()})`);
    staticGraph = { ...cached.static, discussion };
    claudeGraph = values["no-llm"] ? undefined : cached.claude && { ...cached.claude, discussion }; // --no-llm: not even a cached one
  } else {
    const { pr, files, analysis } = await extract();
    staticGraph = await buildGraph(cwd, pr, files, analysis, heuristicTree(pr, analysis, files), discussion);
    const tree = values.refresh || values["no-llm"] ? null : loadCachedTree(pr, VERSION);
    claudeGraph = tree?.source === "claude" ? await buildGraph(cwd, pr, files, analysis, tree, discussion) : undefined;
    saveCachedGraphs(key, { static: staticGraph, claude: claudeGraph });
  }
  const pr: PrInfo = { ...staticGraph.pr };
  const wantLlm = !values["no-llm"] && !claudeGraph;

  const claude = async () => {
    const { pr, files, analysis } = await extract();
    // Claude's tree may be cached when the graphs aren't (built with --no-llm): it isn't asked twice
    const cachedTree = values.refresh ? null : loadCachedTree(pr, VERSION);
    const tree = cachedTree?.source === "claude" ? cachedTree : await claudeTree(pr, analysis, files);
    saveCachedTree(pr, VERSION, tree);
    const g = await buildGraph(cwd, pr, files, analysis, tree, discussion);
    saveCachedGraphs(key, { static: staticGraph, claude: g });
    return g;
  };

  if (cmd === "extract") {
    let graph = claudeGraph ?? staticGraph;
    if (wantLlm) {
      log("▸ asking Claude to build the change tree…");
      graph = await claude().catch((e) => (log(`  ✗ Claude failed, writing static graph: ${e.message}`), staticGraph));
    }
    if (values.lsp) { // the servers that are installed; none is installed without asking
      const s: Session = { cwd, staticGraph: graph, state: { headSha: graph.pr.headSha, marks: {}, comments: [] }, llm: "off", refresh: values.refresh };
      await startServers(s, { ask: false, log });
      await stopServers(s);
      if (s.definitions) graph = { ...graph, definitions: s.definitions };
    }
    const text = JSON.stringify(graph, null, 1);
    if (values.out) { writeFileSync(values.out, text); log(`  ✓ wrote ${values.out}`); }
    else console.log(text);
  } else {
    const session: Session = {
      cwd, staticGraph, claudeGraph, state: loadState(pr),
      llm: claudeGraph ? "done" : wantLlm ? "pending" : "off", refresh: values.refresh,
    };
    void startServers(session, { ask: true, off: values["no-lsp"], log });
    if (wantLlm) {
      log("▸ asking Claude to build the change tree (UI is usable meanwhile)…");
      claude()
        .then((g) => { session.claudeGraph = g; session.llm = "done"; log(`  ✓ Claude tree ready: ${g.cores.length} cores`); })
        .catch((e) => { session.llm = "failed"; session.llmError = String(e.message ?? e); console.error(`  ✗ Claude tree failed, keeping static tree: ${session.llmError}`); });
    }
    await serve(session, pr);
  }
}

/** Another Bobby already serving this review: point at it (and open it) rather than start a second one that would
 *  save over its progress. --refresh starts anew regardless, after saying so. */
async function alreadyOpen(pr: Parameters<typeof holder>[0]) {
  const other = holder(pr);
  if (!other) return false;
  const url = `http://127.0.0.1:${other.port}`;
  const up = await fetch(`${url}/api/status`, { signal: AbortSignal.timeout(1500) }).then((r) => r.ok, () => false);
  if (!up) return false;
  if (values.refresh) { console.log(`  ! this review is also open at ${url} (pid ${other.pid}); whichever saves last keeps its progress`); return false; }
  console.log(`  already open at ${url} (pid ${other.pid}); stop that one to start anew\n\n  ▶ ${url}\n`);
  if (!values["no-open"]) await run(openCommand(url), { allowFail: true }).catch(() => {});
  return true;
}

async function serve(session: Session, pr: Parameters<typeof hold>[0]) {
  // The default port may be taken (another review, a dev server): fall back to any free one.
  let server;
  try { server = startServer(session, Number(values.port)); }
  catch (e) {
    if (!/EADDRINUSE|in use/i.test(String((e as Error).message ?? e))) throw e;
    server = startServer(session, 0);
    console.log(`  port ${values.port} is in use, using ${server.port}`);
  }
  const url = `http://127.0.0.1:${server.port}`;
  hold(pr, server.port!);
  console.log(`\n  ▶ ${url}\n`);
  if (!values["no-open"]) await run(openCommand(url), { allowFail: true }).catch(() => console.log("  (open that link in your browser)"));
}

function openCommand(url: string) {
  if (process.platform === "darwin") return ["open", url];
  if (process.platform === "win32") return ["cmd", "/c", "start", "", url];
  return ["xdg-open", url];
}
