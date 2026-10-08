#!/usr/bin/env bun
import { parseArgs } from "node:util";
import { readFileSync, writeFileSync } from "node:fs";
import { git, preparePr, run } from "./git.ts";
import { parseDiff } from "./diff.ts";
import { analyze, heuristicTree } from "./analyze.ts";
import { claudeTree } from "./llm.ts";
import { buildGraph, GRAPH_SCHEMA, type ReviewGraph } from "./graph.ts";
import { loadCachedTree, loadState, saveCachedTree } from "./state.ts";
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
  --refresh      ignore the cached Claude tree for this commit
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
  log("▸ fetching PR…");
  const { pr, cwd } = await preparePr(arg, values.repo);
  log(`  #${pr.number} ${pr.title}`);

  log("▸ diffing & tracing references…");
  const files = parseDiff(await git(cwd, ["diff", "--no-color", "--no-ext-diff", "-M", "-U3", pr.baseSha, pr.headSha]));
  const analysis = await analyze(cwd, pr, files);
  const hunks = files.reduce((n, f) => n + f.hunks.length, 0);
  log(`  ${files.length} files · ${hunks} hunks · ${analysis.units.length} units · ${analysis.refs.length} untouched refs (${((Date.now() - t0) / 1000).toFixed(1)}s)`);

  const cached = values.refresh ? null : loadCachedTree(pr);
  const staticGraph = await buildGraph(cwd, pr, files, analysis, heuristicTree(pr, analysis, files));
  const claudeGraph = cached?.source === "claude" ? await buildGraph(cwd, pr, files, analysis, cached) : undefined;
  const wantLlm = !values["no-llm"] && !claudeGraph;

  const claude = async () => {
    const tree = await claudeTree(pr, analysis, files);
    saveCachedTree(pr, tree);
    return buildGraph(cwd, pr, files, analysis, tree);
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
