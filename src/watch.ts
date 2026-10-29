// Keeping an open review current. A PR's comments arrive as they're written; new commits on the PR, or new work on a
// local branch, are only announced (s.update), and the review moves to them when you ask (s.rebuild), as GitHub offers
// "refresh" rather than changing the page under you.
import { reviewComments, run, git } from "./git.ts";
import { snapshot } from "./local.ts";
import type { Session } from "./server.ts";
import { type Discussion, setDiscussion } from "./graph.ts";

export interface Update {
  headSha: string; // what the review would move to: a commit, or for uncommitted work, a tree
  detail: string; // for the UI: "new commits", "uncommitted changes"…
  refresh: boolean; // false: a change the review can't follow (you switched branches)
}

// what changed: a comment's line or text, a thread resolved or not, a thread gone outdated, a thread's id first read (a
// review built before Bobby kept them can't resolve its threads until then)
const sig = (d: Array<{ id: string; body?: string; line?: number; resolved?: boolean; comments?: number; thread?: string }>) =>
  d.map((c) => `${c.id}:${c.line ?? "o"}:${c.body?.length ?? c.comments}:${c.resolved ? "r" : ""}${c.thread ? "t" : ""}`).sort().join("|");

/** The review's comments as GitHub has them now; the page sees discussionAt move and reads them. */
export function showDiscussion(s: Session, d: Discussion) {
  for (const g of [s.staticGraph, s.claudeGraph]) if (g) setDiscussion(g, d);
  s.discussionAt = Date.now();
}
/** After a change Bobby made on GitHub (a comment, a reply, a thread resolved): read the comments again. Null when
 *  GitHub couldn't say. */
export async function refreshDiscussion(s: Session): Promise<Discussion | null> {
  const d = await reviewComments(s.staticGraph.pr, true).catch(() => null);
  if (d) showDiscussion(s, d);
  return d;
}

// No page has asked about the review lately (an open one polls every 10 s, a hidden one about once a minute): nobody would
// see what a check finds, so it waits until a page is back, rather than spending git and the GitHub rate limit.
const unseen = (s: Session) => Date.now() - (s.seenAt ?? 0) > 3 * 60_000;

/** A PR: its comments, and whether its head or base moved on. Every minute; a failed check (offline) waits for the next.
 *  Returns what stops watching. */
export function watchPr(s: Session, every = 60_000) {
  const tick = async () => {
    if (s.rebuilding || unseen(s)) return;
    const pr = s.staticGraph.pr;
    const d = await reviewComments(pr, true).catch(() => null);
    if (d && sig([...d.comments, ...d.outdated]) !== sig([...s.staticGraph.discussion ?? [], ...s.staticGraph.outdated ?? []])) {
      showDiscussion(s, d);
    }
    if (pr.commit) return; // one commit doesn't move on: only its comments are kept current
    const out = await run(["gh", "pr", "view", String(pr.number), "-R", `${pr.owner}/${pr.repo}`, "--json", "headRefOid,baseRefName"]).catch(() => "");
    if (!out.trim()) return;
    const meta = JSON.parse(out) as { headRefOid: string; baseRefName: string };
    const moved = meta.headRefOid !== pr.headSha, retargeted = !!s.baseRef && meta.baseRefName !== s.baseRef;
    s.update = moved || retargeted
      ? { headSha: meta.headRefOid, detail: retargeted ? `now based on ${meta.baseRefName}` : "new commits", refresh: true }
      : undefined;
  };
  const timer = setInterval(() => void tick().catch(() => {}), every);
  return () => clearInterval(timer);
}

/** A local review: whether the branch has new commits or the working copy changed since the review was built. */
export function watchLocal(s: Session, every = 10_000) {
  const cwd = s.cwd!;
  void git(cwd, ["rev-parse", "HEAD"]).then((h) => (s.builtHead ??= h.trim()));
  const tick = async () => {
    if (s.rebuilding || unseen(s)) return;
    const pr = s.staticGraph.pr;
    const branch = (await git(cwd, ["branch", "--show-current"], true)).trim();
    if (pr.branch && branch && branch !== pr.branch) return void (s.update = { headSha: "", detail: `you switched to ${branch}: run bobby again to review it`, refresh: false });
    const head = (await git(cwd, ["rev-parse", "HEAD"])).trim(), tree = await snapshot(cwd);
    const live = tree === (await git(cwd, ["rev-parse", "HEAD^{tree}"])).trim() ? head : tree;
    if (live === pr.headSha) return void (s.update = undefined);
    s.update = { headSha: live, detail: head !== s.builtHead ? "new commits" : "changed files", refresh: true };
  };
  const timer = setInterval(() => void tick().catch(() => {}), every);
  return () => clearInterval(timer);
}
