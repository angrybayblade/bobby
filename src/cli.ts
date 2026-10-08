#!/usr/bin/env bun
import { parseArgs } from "node:util";
import { readFileSync, writeFileSync } from "node:fs";
import { fetchPr, git, resolvePr, reviewComments, run } from "./git.ts";
import { parseDiff } from "./diff.ts";
import { analyze, heuristicTree, type Analysis } from "./analyze.ts";
import { claudeTree } from "./llm.ts";
import { buildGraph, GRAPH_SCHEMA, VERSION, type ReviewGraph } from "./graph.ts";
import { loadCachedGraphs, loadCachedTree, loadState, saveCachedGraphs, saveCachedTree } from "./state.ts";
import type { FileDiff, PrInfo } from "./types.ts";
import { startServer, type Session } from "./server.ts";

const { values, positionals } = parseArgs({
  args: Bun.argv.slice(2),
  allowPositionals: true,
  options: {
    repo: { type: "string" },
    port: { type: "string", default: "4173" },
    out: { type: "string", short: "o" },
    "no-llm": { type: "boolean", default: false },
    refresh: { type: "boolean", default: false },
    "no-open": { type: "boolean", default: false },
    help: { type: "boolean", short: "h", default: false },
  },
});

const USAGE = `prfocus: review a PR one focused page at a time

  prfocus <pr-url | number>            extract + open the review UI
  prfocus extract <pr> [-o file.json]  write the review graph (${GRAPH_SCHEMA}) and exit
  prfocus open <graph.json>            open the UI on an existing graph file

  --repo <dir>   local clone (default: cwd, else auto-clone to ~/.prfocus/repos)
  --port <n>     UI port (default 4173)
  --no-llm       static analysis only; skip Claude
  --refresh      rebuild everything for this commit (ignore cached graphs and Claude tree)
  --no-open      don't open the browser`;

const [cmd, arg] = ["extract", "open"].includes(positionals[0]) ? [positionals[0], positionals[1]] : ["review", positionals[0]];
if (values.help || !arg) {
  console.log(USAGE);
  process.exit(values.help ? 0 : 1);
}
const log = (m: string) => (cmd === "extract" && !values.out ? console.error(m) : console.log(m));

if (cmd === "open") {
  const graph = JSON.parse(readFileSync(arg, "utf8")) as ReviewGraph;
  if (graph.schema !== GRAPH_SCHEMA) throw new Error(`Unsupported graph schema: ${graph.schema}`);
  await serve({ cwd: values.repo ?? null, staticGraph: graph, state: loadState({ ...graph.pr }), llm: "off" });
} else {
  const t0 = Date.now();
  const secs = () => `${((Date.now() - t0) / 1000).toFixed(1)}s`;
  log("▸ fetching PR…");
  const resolved = await resolvePr(arg, values.repo);
  const { cwd } = resolved;
  const key = { owner: resolved.owner, repo: resolved.repo, number: resolved.meta.number, headSha: resolved.meta.headRefOid };
  log(`  #${key.number} ${resolved.meta.title}`);

  // Same head commit as last time → reuse the built graphs. Comments still change, so they're always re-read.
  const hit = values.refresh ? null : loadCachedGraphs(key);
  const cached = hit?.static.generator.version === VERSION ? hit : null;
  const discussion = await reviewComments(key);
  if (discussion.length) log(`  ${discussion.length} existing review comment(s)`);

  // Fetch + diff + analysis, only when something needs it (a new head, or Claude's tree still missing).
  let built: Promise<{ pr: PrInfo; files: FileDiff[]; analysis: Analysis }> | null = null;
  const extract = () => (built ??= (async () => {
    const pr = await fetchPr(resolved);
    log("▸ diffing & tracing references…");
    const files = parseDiff(await git(cwd, ["diff", "--no-color", "--no-ext-diff", "-M", "-U3", pr.baseSha, pr.headSha]));
    const analysis = await analyze(cwd, pr, files);
    const hunks = files.reduce((n, f) => n + f.hunks.length, 0);
    log(`  ${files.length} files · ${hunks} hunks · ${analysis.units.length} units · ${analysis.refs.length} untouched refs (${secs()})`);
    return { pr, files, analysis };
  })());

  let staticGraph: ReviewGraph, claudeGraph: ReviewGraph | undefined;
  if (cached) {
    log(`  ✓ unchanged since last time (${key.headSha.slice(0, 7)}), using cached graphs (${secs()})`);
    staticGraph = { ...cached.static, discussion };
    claudeGraph = cached.claude && { ...cached.claude, discussion };
  } else {
    const { pr, files, analysis } = await extract();
    staticGraph = await buildGraph(cwd, pr, files, analysis, heuristicTree(pr, analysis, files), discussion);
    const tree = values.refresh ? null : loadCachedTree(pr);
    claudeGraph = tree?.source === "claude" ? await buildGraph(cwd, pr, files, analysis, tree, discussion) : undefined;
    saveCachedGraphs(key, { static: staticGraph, claude: claudeGraph });
  }
  const pr: PrInfo = { ...staticGraph.pr };
  const wantLlm = !values["no-llm"] && !claudeGraph;

  const claude = async () => {
    const { pr, files, analysis } = await extract();
    const tree = await claudeTree(pr, analysis, files);
    saveCachedTree(pr, tree);
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
    const text = JSON.stringify(graph, null, 1);
    if (values.out) { writeFileSync(values.out, text); log(`  ✓ wrote ${values.out}`); }
    else console.log(text);
  } else {
    const session: Session = {
      cwd, staticGraph, claudeGraph, state: loadState(pr),
      llm: claudeGraph ? "done" : wantLlm ? "pending" : "off",
    };
    if (wantLlm) {
      log("▸ asking Claude to build the change tree (UI is usable meanwhile)…");
      claude()
        .then((g) => { session.claudeGraph = g; session.llm = "done"; log(`  ✓ Claude tree ready: ${g.cores.length} cores`); })
        .catch((e) => { session.llm = "failed"; session.llmError = String(e.message ?? e); console.error(`  ✗ Claude tree failed, keeping static tree: ${session.llmError}`); });
    }
    await serve(session);
  }
}

async function serve(session: Session) {
  const server = startServer(session, Number(values.port));
  const url = `http://127.0.0.1:${server.port}`;
  console.log(`\n  ▶ ${url}\n`);
  if (!values["no-open"]) await run(["open", url], { allowFail: true });
}
