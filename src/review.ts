// A review, from what you asked for (a PR's URL or number, one of its commits, or the branch you're on) to a live
// Session: fetch, diff, analysis and the graph (cached per head commit), then Claude's tree, the language servers and
// the watchers in the background. Two steps, so a caller can name the review (its id, its address) before the slow part:
// resolve() asks GitHub or git what it is; build() makes it.
import { warn } from "./log.ts";
import { basename } from "node:path";
import { fetchPr, git, resolvePr, reviewComments } from "./git.ts";
import { resolveLocal } from "./local.ts";
import { pairMoves, parseDiff } from "./diff.ts";
import { analyze, heuristicTree, type Analysis } from "./analyze.ts";
import { claudeTree } from "./llm.ts";
import { buildGraph, type Discussion, VERSION, type ReviewGraph } from "./graph.ts";
import { loadCachedGraphs, loadCachedTree, loadState, saveCachedGraphs, saveCachedTree } from "./state.ts";
import { startServers, stopServers } from "./servers.ts";
import { watchLocal, watchPr } from "./watch.ts";
import type { FileDiff, PrInfo } from "./types.ts";
import type { Session } from "./server.ts";

/** The changes from base to head. git counts a file as moved only when at least half of it is unchanged, so one moved
 *  and then largely rewritten is a deletion and an addition: those of the same name are looked at again, down to a
 *  fifth unchanged, and shown as the one file moved. */
async function diffFiles(cwd: string, base: string, head: string): Promise<FileDiff[]> {
  const diff = (moves: string, paths: string[] = []) =>
    git(cwd, ["diff", "--no-color", "--no-ext-diff", "-U3", moves, base, head, ...(paths.length ? ["--", ...paths.map((p) => `:(literal)${p}`)] : [])]);
  const files = parseDiff(await diff("-M"));
  const name = (p: string) => p.slice(p.lastIndexOf("/") + 1);
  const named = (st: string) => new Set(files.filter((f) => f.status === st).map((f) => name(f.path)));
  const gone = named("deleted"), added = named("added");
  const both = files.filter((f) => (f.status === "deleted" || f.status === "added") && gone.has(name(f.path)) && added.has(name(f.path)));
  if (!both.length || both.length > 400) return files; // nothing to pair; or too many to name on the command line
  return pairMoves(files, parseDiff(await diff("-M20%", both.map((f) => f.path))));
}

export interface ReviewOptions {
  repo?: string; // a local clone, or for a local review, the repo itself
  cwd?: string; // where you ran bobby: a clone there is used for a PR (default: this process's folder)
  base?: string; // a local review: what it's compared with
  refresh?: boolean; // rebuild rather than use the caches
  noLlm?: boolean; // no Claude tree
  noLsp?: boolean; // no language servers
  ssh?: boolean; // cloning over SSH is allowed, if HTTPS (with gh's sign-in) fails
  log: (m: string) => void;
}
type Key = { owner: string; repo: string; number: number; branch?: string; headSha: string; baseSha?: string; baseRef?: string; commit?: PrInfo["commit"] };

/** Where a review lives in the app: /r/<id>. owner/repo/number for a PR (@sha, or @from..to, for commits of it);
 *  local/<repo>/<branch> for a branch. */
export function reviewId(pr: Pick<PrInfo, "owner" | "repo" | "number" | "branch" | "commit" | "provider">): string {
  if (pr.provider === "local" || pr.branch) return `local/${pr.repo}/${encodeURIComponent(pr.branch ?? "")}`;
  const c = pr.commit ? `@${pr.commit.from ? `${pr.commit.from.slice(0, 7)}..` : ""}${pr.commit.sha.slice(0, 7)}` : "";
  return `${pr.owner}/${pr.repo}/${pr.number}${c}`;
}

export interface Resolved {
  id: string;
  title: string;
  key: Key; // what names its state and caches
  build(): Promise<Prepared>;
}
export interface Prepared {
  cwd: string;
  key: Key;
  arg?: string;
  staticGraph: ReviewGraph;
  claudeGraph?: ReviewGraph;
  wantLlm: boolean;
  /** Claude's tree for this review, as a graph (cached per head commit and extraction version). */
  claude(): Promise<ReviewGraph>;
}

/** What the review is: a PR (its metadata; one commit of it is fetched now, as its full id names the review), or the
 *  branch you're on. Cheap: no diff yet. */
export async function resolve(arg: string | undefined, o: ReviewOptions): Promise<Resolved> {
  const log = o.log;
  let cwd: string, key: Key, getPr: () => Promise<PrInfo>, title: string;
  if (arg) {
    log("▸ fetching PR…");
    const resolved = await resolvePr(arg, o.repo, o.cwd, o.ssh);
    cwd = resolved.cwd;
    key = { owner: resolved.owner, repo: resolved.repo, number: resolved.meta.number, headSha: resolved.meta.headRefOid, baseRef: resolved.meta.baseRefName };
    title = `#${key.number} ${resolved.meta.title}`;
    log(`  ${title}`);
    getPr = () => fetchPr(resolved);
    if (resolved.commit) {
      const one = await fetchPr(resolved);
      key = { ...key, headSha: one.headSha, commit: one.commit };
      getPr = async () => one;
      log(`  ${one.commit!.from ? `commits ${one.commit!.from.slice(0, 7)}..${one.headSha.slice(0, 7)}` : `commit ${one.headSha.slice(0, 7)}`}: ${one.commit!.subject}`);
    }
  } else {
    const local = await resolveLocal(o.repo ?? process.cwd(), o.base);
    cwd = local.cwd;
    const { pr } = local;
    key = { ...pr };
    title = `${pr.branch} vs ${pr.baseRef}`;
    log(`▸ ${title} (${local.why})${local.dirty ? ", with uncommitted changes" : ""}`);
    if (local.untracked) log(`  ${local.untracked} untracked file(s) left out: \`git add -N <file>\` to include one`);
    getPr = async () => pr;
  }
  const id = reviewId({ ...key, provider: arg ? "github" : "local", repo: arg ? key.repo : basename(cwd) });
  return { id, title, key, build: () => build(arg, cwd, key, getPr, o) };
}

async function build(arg: string | undefined, cwd: string, key: Key, getPr: () => Promise<PrInfo>, o: ReviewOptions): Promise<Prepared> {
  const log = o.log, t0 = Date.now(), secs = () => `${((Date.now() - t0) / 1000).toFixed(1)}s`;
  // Same head commit as last time → reuse the built graphs. Comments still change, so they're always re-read.
  const hit = o.refresh ? null : loadCachedGraphs(key);
  const cached = hit?.static.generator.extraction === VERSION ? hit : null;
  const comments: Promise<Discussion> = arg ? reviewComments(key) : Promise.resolve({ comments: [], outdated: [] });

  // Fetch + diff + analysis, only when something needs it (a new head, or Claude's tree still missing).
  let built: Promise<{ pr: PrInfo; files: FileDiff[]; analysis: Analysis }> | null = null;
  const extract = () => (built ??= (async () => {
    const pr = await getPr();
    log("▸ diffing & tracing references…");
    const files = await diffFiles(cwd, pr.baseSha, pr.headSha);
    const analysis = await analyze(cwd, pr, files);
    const hunks = files.reduce((n, f) => n + f.hunks.length, 0);
    log(`  ${files.length} files · ${hunks} hunks · ${analysis.units.length} units · ${analysis.refs.length} untouched refs (${secs()})`);
    return { pr, files, analysis };
  })());
  if (!cached) extract().catch(() => {}); // alongside reading the comments; its failure is met where it's awaited
  const discussion = await comments;
  if (discussion.comments.length) log(`  ${discussion.comments.length} existing review comment(s)`);

  // The clone may lack the cached graph's commits (a fresh clone, a fork's PR, refs/bobby deleted and collected): the
  // UI reads files at both, and the language server exports head. Fetch them as a miss would.
  if (cached && arg) {
    const has = async (sha: string) => (await Bun.spawn(["git", "cat-file", "-e", `${sha}^{commit}`], { cwd, stderr: "ignore" }).exited) === 0;
    if (!(await has(cached.static.pr.headSha)) || !(await has(cached.static.pr.baseSha))) { log("▸ fetching PR…"); await getPr(); }
  }

  let staticGraph: ReviewGraph, claudeGraph: ReviewGraph | undefined;
  if (cached) {
    log(`  ✓ unchanged since last time (${key.headSha.slice(0, 7)}), using cached graphs (${secs()})`);
    const fresh = { discussion: discussion.comments, outdated: discussion.outdated };
    staticGraph = { ...cached.static, ...fresh };
    claudeGraph = o.noLlm ? undefined : cached.claude && { ...cached.claude, ...fresh }; // --no-llm: not even a cached one
  } else {
    const { pr, files, analysis } = await extract();
    staticGraph = await buildGraph(cwd, pr, files, analysis, heuristicTree(pr, analysis, files), discussion);
    const tree = o.refresh || o.noLlm ? null : loadCachedTree(pr, VERSION);
    claudeGraph = tree?.source === "claude" ? await buildGraph(cwd, pr, files, analysis, tree, discussion) : undefined;
    saveCachedGraphs(key, { static: staticGraph, claude: claudeGraph });
  }

  const claude = async () => {
    const { pr, files, analysis } = await extract();
    // Claude's tree may be cached when the graphs aren't (built with --no-llm): it isn't asked twice
    const cachedTree = o.refresh ? null : loadCachedTree(pr, VERSION);
    const tree = cachedTree?.source === "claude" ? cachedTree : await claudeTree(pr, analysis, files);
    saveCachedTree(pr, VERSION, tree);
    const g = await buildGraph(cwd, pr, files, analysis, tree, discussion);
    saveCachedGraphs(key, { static: staticGraph, claude: g });
    return g;
  };
  return { cwd, key, arg, staticGraph, claudeGraph, wantLlm: !o.noLlm && !claudeGraph, claude };
}

/** A built review, live: its state, Claude's tree and the language servers in the background, and watching for new
 *  comments and new work, with what Refresh does (watch.ts). */
export function start(p: Prepared, o: ReviewOptions): Session {
  const { cwd, key, arg } = p, log = o.log;
  const pr: PrInfo = { ...p.staticGraph.pr };
  const session: Session = {
    cwd, staticGraph: p.staticGraph, claudeGraph: p.claudeGraph, state: loadState(pr),
    llm: p.claudeGraph ? "done" : p.wantLlm ? "pending" : "off", refresh: o.refresh,
  };
  void startServers(session, { ask: true, off: o.noLsp, log });
  // Claude's tree, in the background: now, and again if it failed once Claude is set up (claude.ts). Not with --no-llm.
  let asking = false;
  if (!o.noLlm) session.askClaude = () => {
    if (asking || session.claudeGraph) return;
    asking = true;
    Object.assign(session, { llm: "pending", llmError: undefined });
    log("▸ asking Claude to build the change tree (UI is usable meanwhile)…");
    p.claude()
      .then((g) => { session.claudeGraph = g; session.llm = "done"; log(`  ✓ Claude tree ready: ${g.cores.length} cores`); })
      .catch((e) => { session.llm = "failed"; session.llmError = String(e.message ?? e); warn(`  ✗ Claude tree failed, keeping static tree: ${session.llmError}`); })
      .finally(() => { asking = false; });
  };
  if (p.wantLlm) session.askClaude?.();

  // Moving to new work when you ask (watch.ts notices it): the same pipeline as a fresh start, on the new head. Marks
  // carry over by content, so what the push didn't touch stays reviewed; drafts stay as they are.
  session.baseRef = key.baseRef;
  session.rebuild = async () => {
    const was: Discussion = { comments: session.staticGraph.discussion ?? [], outdated: session.staticGraph.outdated ?? [] };
    let next: PrInfo, comments = Promise.resolve(was);
    if (arg) {
      const resolved = await resolvePr(arg, o.repo, o.cwd, o.ssh);
      next = await fetchPr(resolved);
      comments = reviewComments(next, true).catch(() => was); // alongside the diff and analysis
      session.baseRef = resolved.meta.baseRefName;
    } else {
      next = (await resolveLocal(cwd, session.staticGraph.pr.baseRef)).pr;
      session.builtHead = (await git(cwd, ["rev-parse", "HEAD"])).trim();
    }
    log(`▸ refreshing to ${next.headSha.slice(0, 7)}…`);
    const files = await diffFiles(cwd, next.baseSha, next.headSha);
    const analysis = await analyze(cwd, next, files);
    const disc = await comments;
    const g = await buildGraph(cwd, next, files, analysis, heuristicTree(next, analysis, files), disc);
    const nextKey = arg ? { ...key, headSha: next.headSha, baseRef: session.baseRef } : { ...next };
    saveCachedGraphs(nextKey, { static: g });
    await stopServers(session);
    Object.assign(session, { staticGraph: g, claudeGraph: undefined, definitions: undefined, repo: undefined, root: undefined, llmError: undefined });
    session.state.headSha = next.headSha;
    void startServers(session, { ask: true, off: o.noLsp, log });
    log(`  ✓ ${files.length} files · ${files.reduce((n, f) => n + f.hunks.length, 0)} hunks`);
    session.llm = o.noLlm ? "off" : "pending";
    if (session.llm === "pending") {
      void claudeTree(next, analysis, files)
        .then(async (tree) => {
          saveCachedTree(next, VERSION, tree);
          const cg = await buildGraph(cwd, next, files, analysis, tree, disc);
          if (session.staticGraph !== g) return; // refreshed again meanwhile
          session.claudeGraph = cg; session.llm = "done";
          saveCachedGraphs(nextKey, { static: g, claude: cg });
        })
        .catch((e) => { if (session.staticGraph === g) { session.llm = "failed"; session.llmError = String(e.message ?? e); } });
    }
  };
  session.stopWatching = arg ? watchPr(session) : watchLocal(session);
  return session;
}
