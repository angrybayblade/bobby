// Keeping an open review current. A PR's comments arrive as they're written; new commits on the PR, or new work on a
// local branch, are only announced (s.update), and the review moves to them when you ask (s.rebuild), as GitHub offers
// "refresh" rather than changing the page under you.
import { reviewComments, run, git } from "./git.ts";
import { snapshot } from "./local.ts";
import type { Session } from "./server.ts";

export interface Update {
  headSha: string; // what the review would move to: a commit, or for uncommitted work, a tree
  detail: string; // for the UI: "new commits", "uncommitted changes"…
  refresh: boolean; // false: a change the review can't follow (you switched branches)
}

const sig = (d: Array<{ id: string; body: string; line: number }>) => d.map((c) => `${c.id}:${c.line}:${c.body.length}`).sort().join("|");

/** A PR: its comments, and whether its head or base moved on. Every minute; a failed check (offline) waits for the next. */
export function watchPr(s: Session, every = 60_000) {
  const tick = async () => {
    if (s.rebuilding) return;
    const pr = s.staticGraph.pr;
    const d = await reviewComments(pr, true).catch(() => null);
    if (d && sig(d) !== sig(s.staticGraph.discussion ?? [])) {
      for (const g of [s.staticGraph, s.claudeGraph]) if (g) g.discussion = d;
      s.discussionAt = Date.now();
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
  setInterval(() => void tick().catch(() => {}), every);
}

/** A local review: whether the branch has new commits or the working copy changed since the review was built. */
export function watchLocal(s: Session, every = 10_000) {
  const cwd = s.cwd!;
  void git(cwd, ["rev-parse", "HEAD"]).then((h) => (s.builtHead ??= h.trim()));
  const tick = async () => {
    if (s.rebuilding) return;
    const pr = s.staticGraph.pr;
    const branch = (await git(cwd, ["branch", "--show-current"], true)).trim();
    if (pr.branch && branch && branch !== pr.branch) return void (s.update = { headSha: "", detail: `you switched to ${branch}: run bobby again to review it`, refresh: false });
    const head = (await git(cwd, ["rev-parse", "HEAD"])).trim(), tree = await snapshot(cwd);
    const live = tree === (await git(cwd, ["rev-parse", "HEAD^{tree}"])).trim() ? head : tree;
    if (live === pr.headSha) return void (s.update = undefined);
    s.update = { headSha: live, detail: head !== s.builtHead ? "new commits" : "changed files", refresh: true };
  };
  setInterval(() => void tick().catch(() => {}), every);
}
