// Submitting a review to GitHub. Most often one REST call: the summary, the event and every draft on a line of the diff.
// GraphQL instead when it can't be: you already have a review there that isn't submitted (started on github.com, and
// GitHub allows one per person per PR), or a draft sits on a line the diff doesn't show, which goes on its file as a
// comment on the whole file (only GraphQL adds those to a review). Then each draft is added to that review (one is
// started if there's none), and the review is submitted. A draft leaves Bobby once it's on GitHub (done), so a submit
// that fails halfway can be tried again without posting anything twice: what landed is then in the pending review.
import { join } from "node:path";
import { run, whoAmI } from "./git.ts";
import { home } from "./state.ts";
import type { Comment, PrInfo } from "./types.ts";

export type ReviewEvent = "COMMENT" | "APPROVE" | "REQUEST_CHANGES";
export interface Submission {
  pr: PrInfo; event: ReviewEvent; body: string;
  drafts: Comment[]; // ready ones, unfinished left out
  inDiff: (c: Comment) => boolean; // on lines of the diff GitHub will take a comment on
  inPr: (path: string) => boolean; // a file the PR changes (a file comment needs one)
  done: (ids: string[]) => void; // these drafts are on GitHub now
}

/** Runs a GraphQL query with variables; GitHub's errors come back as a thrown Error. */
async function gql<T>(query: string, variables: Record<string, unknown>): Promise<T> {
  const out = JSON.parse(await run(["gh", "api", "graphql", "--input", "-"], { input: JSON.stringify({ query, variables }) }));
  if (out.errors?.length) throw new Error(out.errors.map((e: { message: string }) => e.message).join("; "));
  return out.data as T;
}

interface Pending { id: string; comments: Array<{ path: string; line: number | null; body: string; file: boolean }> }
/** The PR's node id, and your review there that isn't submitted yet, read now (not from the discussion: it may be
 *  minutes old, and a second review would be refused). */
async function pendingNow(pr: PrInfo): Promise<{ prId: string; pending: Pending | null }> {
  type R = { repository: { pullRequest: { id: string; reviews: { nodes: Array<{ id: string; comments: { nodes: Array<{ path: string; line: number | null; body: string; subjectType: string }> } }> } } } };
  const d = await gql<R>(`query($owner: String!, $repo: String!, $n: Int!) { repository(owner: $owner, name: $repo) { pullRequest(number: $n) { id
    reviews(states: PENDING, first: 1) { nodes { id comments(first: 100) { nodes { path line body subjectType } } } } } } }`, { owner: pr.owner, repo: pr.repo, n: pr.number });
  const p = d.repository.pullRequest, r = p.reviews.nodes[0];
  return { prId: p.id, pending: r ? { id: r.id, comments: r.comments.nodes.map((c) => ({ path: c.path, line: c.line, body: c.body, file: c.subjectType === "FILE" })) } : null };
}

/** Where a draft is, in words and as a link to those lines on GitHub: for a comment on its whole file. */
export function fileCommentBody(pr: PrInfo, c: Comment): string {
  const from = c.startLine && c.startLine !== c.line ? c.startLine : null;
  const old = c.side === "LEFT", sha = old ? pr.baseSha : pr.headSha;
  const label = `${old ? "old " : ""}L${from ? `${from}–L${c.line}` : c.line}`;
  const link = `https://github.com/${pr.owner}/${pr.repo}/blob/${sha}/${c.path.split("/").map(encodeURIComponent).join("/")}#L${from ? `${from}-L${c.line}` : c.line}`;
  return `On [${label}](${link}):\n\n${c.body}`;
}

/** Posts the review; answers its URL. */
export async function submitReview(s: Submission): Promise<string> {
  const lines = s.drafts.filter(s.inDiff), files = s.drafts.filter((c) => !s.inDiff(c) && s.inPr(c.path));
  const untouched = s.drafts.filter((c) => !s.inDiff(c) && !s.inPr(c.path)); // GitHub takes no comment on a file outside the PR
  const body = [
    s.body.trim(),
    untouched.length ? "**Notes on code this PR doesn't touch**\n" + untouched.map((c) => `- \`${c.path}:${c.startLine ? `${c.startLine}-` : ""}${c.line}\`: ${c.body}`).join("\n") : "",
  ].filter(Boolean).join("\n\n");
  const { prId, pending } = await pendingNow(s.pr);
  if (!pending && !files.length) {
    const url = await restReview(s.pr, s.event, body, lines);
    s.done(s.drafts.map((c) => c.id));
    return url;
  }
  const there = (path: string, line: number | null, text: string, file: boolean) =>
    pending?.comments.some((c) => c.path === path && c.file === file && (file || c.line === line) && c.body.trim() === text.trim());
  let reviewId = pending?.id, todo = lines;
  if (!reviewId) { // start one with the comments on lines in it, as one call
    type R = { addPullRequestReview: { pullRequestReview: { id: string } } };
    const d = await gql<R>(`mutation($pr: ID!, $commit: GitObjectID!, $threads: [DraftPullRequestReviewThread]) { addPullRequestReview(input: { pullRequestId: $pr, commitOID: $commit, threads: $threads }) { pullRequestReview { id } } }`,
      { pr: prId, commit: s.pr.headSha, threads: lines.map(thread) });
    reviewId = d.addPullRequestReview.pullRequestReview.id;
    s.done(lines.map((c) => c.id));
    todo = [];
  }
  const add = `mutation($review: ID!, $path: String!, $body: String!, $line: Int, $side: DiffSide, $startLine: Int, $startSide: DiffSide, $subject: PullRequestReviewThreadSubjectType) {
    addPullRequestReviewThread(input: { pullRequestReviewId: $review, path: $path, body: $body, line: $line, side: $side, startLine: $startLine, startSide: $startSide, subjectType: $subject }) { thread { id } } }`;
  for (const c of todo) {
    if (!there(c.path, c.line, c.body, false)) await gql(add, { review: reviewId, ...thread(c), subject: "LINE" });
    s.done([c.id]);
  }
  for (const c of files) {
    const text = fileCommentBody(s.pr, c);
    if (!there(c.path, null, text, true)) await gql(add, { review: reviewId, path: c.path, body: text, subject: "FILE" });
    s.done([c.id]);
  }
  type R = { submitPullRequestReview: { pullRequestReview: { url: string } } };
  const d = await gql<R>(`mutation($review: ID!, $event: PullRequestReviewEvent!, $body: String) { submitPullRequestReview(input: { pullRequestReviewId: $review, event: $event, body: $body }) { pullRequestReview { url } } }`,
    { review: reviewId, event: s.event, body });
  s.done(untouched.map((c) => c.id));
  return d.submitPullRequestReview.pullRequestReview.url;
}

/** A draft as a review thread: a range goes as startLine/startSide to line/side, as GitHub's multi-line comments do. */
const thread = (c: Comment) => ({ path: c.path, body: c.body, line: c.line, side: c.side, ...(c.startLine ? { startLine: c.startLine, startSide: c.startSide ?? c.side } : {}) });

/** The review in one REST call. The connection can fail after GitHub took it: if it's there (yours, on this commit, the
 *  same summary, just now), that was a success, and posting again would post it twice. */
async function restReview(pr: PrInfo, event: ReviewEvent, body: string, lines: Comment[]): Promise<string> {
  const payload = {
    commit_id: pr.headSha, event, body,
    comments: lines.map(({ path, line, side, body, startLine, startSide }) => ({ path, line, side, body, ...(startLine ? { start_line: startLine, start_side: startSide ?? side } : {}) })),
  };
  const reviews = `repos/${pr.owner}/${pr.repo}/pulls/${pr.number}/reviews`;
  const out = await run(["gh", "api", "--method", "POST", reviews, "--input", "-"], { input: JSON.stringify(payload) }).catch(async (e) => {
    const me = await whoAmI(join(home(), "cache", "me.json"));
    const recent = await run(["gh", "api", `${reviews}?per_page=100`, "--jq", `[.[] | select(.user.login == "${me?.login ?? ""}" and .commit_id == "${payload.commit_id}")] | last`]).catch(() => "");
    const r = recent.trim() && recent.trim() !== "null" ? JSON.parse(recent) : null;
    if (r && r.body === payload.body && Date.now() - Date.parse(r.submitted_at) < 10 * 60_000) return JSON.stringify(r);
    throw e;
  });
  return JSON.parse(out).html_url;
}
