// A PR's conversation, as GitHub's Conversation tab shows it: the description, then comments, reviews (with their
// threads on code) and commits in time order, then where it stands: approvals, requested reviewers and CI checks.
// Read live from GitHub in one GraphQL query, not kept in the review graph: it moves while you review. Text comes with
// GitHub's own rendering (html), so bots' HTML, tables, images and reference links read as they do on github.com.
import { run } from "./git.ts";
import type { PrInfo } from "./types.ts";

export interface Person { login: string; avatar?: string }
export interface ThreadComment { id: string; author: Person; body: string; html: string; createdAt: string; url: string }
export interface Thread {
  id: string; // GitHub's node id, for resolving
  path: string; line: number | null; startLine: number | null; side: "LEFT" | "RIGHT";
  resolved: boolean; outdated: boolean;
  reviewId: string | null; // the review it was started in
  hunk: string; // the diff up to the line it's on, as GitHub shows above a thread ("@@ … @@" first)
  comments: ThreadComment[];
}
export type TimelineItem =
  | { kind: "comment"; id: string; author: Person; body: string; html: string; createdAt: string; url: string }
  | { kind: "review"; id: string; author: Person; state: "APPROVED" | "CHANGES_REQUESTED" | "COMMENTED" | "DISMISSED" | "PENDING"; body: string; html: string; createdAt: string; url: string }
  | { kind: "commit"; sha: string; subject: string; author: Person; createdAt: string; url: string };
export interface Check {
  name: string; workflow?: string;
  status: "queued" | "running" | "success" | "failure" | "neutral" | "skipped" | "cancelled";
  url?: string; description?: string; startedAt?: string; completedAt?: string;
}
export interface Conversation {
  author: Person; body: string; html: string; createdAt: string; url: string; base: string; head: string; // branch names
  state: "OPEN" | "CLOSED" | "MERGED"; draft: boolean;
  mergeable: "MERGEABLE" | "CONFLICTING" | "UNKNOWN";
  decision: "APPROVED" | "CHANGES_REQUESTED" | "REVIEW_REQUIRED" | null;
  timeline: TimelineItem[];
  threads: Thread[];
  verdicts: Array<{ author: Person; state: string }>; // each reviewer's latest approval or change request
  requested: Person[]; // reviewers (or teams) asked and not yet reviewed
  checks: Check[];
  fetchedAt: number;
}

const WHO = "author { login avatarUrl }";
const TIMELINE = `timelineItems(first: 100, after: $after, itemTypes: [ISSUE_COMMENT, PULL_REQUEST_REVIEW, PULL_REQUEST_COMMIT]) {
    pageInfo { hasNextPage endCursor } nodes { __typename
    ... on IssueComment { databaseId body bodyHTML createdAt url ${WHO} }
    ... on PullRequestReview { databaseId state body bodyHTML submittedAt createdAt url ${WHO} }
    ... on PullRequestCommit { url commit { oid messageHeadline committedDate author { name user { login avatarUrl } } } } } }`;
const PR = (fields: string) => `query($owner: String!, $repo: String!, $n: Int!, $after: String) { repository(owner: $owner, name: $repo) { pullRequest(number: $n) { ${fields} } } }`;
// The rest of the timeline, a page at a time, for a long-running PR.
const MORE = PR(TIMELINE);
const QUERY = PR(`
  body bodyHTML createdAt url baseRefName headRefName state isDraft mergeable reviewDecision ${WHO}
  ${TIMELINE}
  reviewThreads(first: 100) { nodes { id isResolved isOutdated path line startLine diffSide
    comments(first: 100) { nodes { databaseId body bodyHTML diffHunk createdAt url ${WHO} pullRequestReview { databaseId } } } } }
  latestOpinionatedReviews(first: 50) { nodes { state ${WHO} } }
  reviewRequests(first: 50) { nodes { requestedReviewer { ... on User { login avatarUrl } ... on Team { slug } } } }
  commits(last: 1) { nodes { commit { statusCheckRollup { contexts(first: 100) { nodes { __typename
    ... on CheckRun { name status conclusion detailsUrl startedAt completedAt checkSuite { workflowRun { workflow { name } } } }
    ... on StatusContext { context state targetUrl description createdAt } } } } } } }`);

type Raw = any;
const person = (a: Raw): Person => a ? { login: a.login ?? a.slug ?? "ghost", ...(a.avatarUrl ? { avatar: a.avatarUrl } : {}) } : { login: "ghost" };

function check(c: Raw): Check {
  if (c.__typename === "StatusContext") {
    const status = ({ SUCCESS: "success", FAILURE: "failure", ERROR: "failure", PENDING: "running", EXPECTED: "queued" } as const)[c.state as "SUCCESS"] ?? "neutral";
    return { name: c.context, status, ...(c.targetUrl ? { url: c.targetUrl } : {}), ...(c.description ? { description: c.description } : {}), ...(c.createdAt ? { startedAt: c.createdAt } : {}) };
  }
  const done = c.status === "COMPLETED";
  const status: Check["status"] = !done ? (c.status === "IN_PROGRESS" ? "running" : "queued")
    : ({ SUCCESS: "success", FAILURE: "failure", TIMED_OUT: "failure", STARTUP_FAILURE: "failure", ACTION_REQUIRED: "failure", CANCELLED: "cancelled", SKIPPED: "skipped", NEUTRAL: "neutral", STALE: "neutral" } as const)[c.conclusion as "SUCCESS"] ?? "neutral";
  const workflow = c.checkSuite?.workflowRun?.workflow?.name;
  return { name: c.name, status, ...(workflow ? { workflow } : {}), ...(c.detailsUrl ? { url: c.detailsUrl } : {}), ...(c.startedAt ? { startedAt: c.startedAt } : {}), ...(c.completedAt ? { completedAt: c.completedAt } : {}) };
}

export async function conversation(pr: Pick<PrInfo, "owner" | "repo" | "number">): Promise<Conversation> {
  const ask = async (query: string, after?: string): Promise<Raw> => JSON.parse(await run(["gh", "api", "graphql", "-f", `query=${query}`,
    "-F", `owner=${pr.owner}`, "-F", `repo=${pr.repo}`, "-F", `n=${pr.number}`, ...(after ? ["-f", `after=${after}`] : [])])).data.repository.pullRequest;
  const p: Raw = await ask(QUERY);
  const nodes: Raw[] = [...p.timelineItems.nodes];
  for (let page = p.timelineItems.pageInfo, k = 0; page.hasNextPage && k < 20; k++) {
    const next = (await ask(MORE, page.endCursor)).timelineItems;
    nodes.push(...next.nodes);
    page = next.pageInfo;
  }
  const timeline: TimelineItem[] = nodes.flatMap((n: Raw): TimelineItem[] => {
    if (n.__typename === "IssueComment") return [{ kind: "comment", id: String(n.databaseId), author: person(n.author), body: n.body, html: n.bodyHTML ?? "", createdAt: n.createdAt, url: n.url }];
    if (n.__typename === "PullRequestReview") return n.state === "PENDING" ? [] : [{ kind: "review", id: String(n.databaseId), author: person(n.author), state: n.state, body: n.body, html: n.bodyHTML ?? "", createdAt: n.submittedAt ?? n.createdAt, url: n.url }];
    if (n.__typename === "PullRequestCommit") {
      const c = n.commit, u = c.author?.user;
      return [{ kind: "commit", sha: c.oid, subject: c.messageHeadline, author: u ? person(u) : { login: c.author?.name ?? "unknown" }, createdAt: c.committedDate, url: n.url }];
    }
    return [];
  });
  const threads: Thread[] = p.reviewThreads.nodes.map((t: Raw) => ({
    id: t.id, path: t.path, line: t.line ?? null, startLine: t.startLine ?? null, side: t.diffSide === "LEFT" ? "LEFT" : "RIGHT",
    resolved: t.isResolved, outdated: t.isOutdated,
    reviewId: t.comments.nodes[0]?.pullRequestReview?.databaseId != null ? String(t.comments.nodes[0].pullRequestReview.databaseId) : null,
    hunk: t.comments.nodes[0]?.diffHunk ?? "",
    comments: t.comments.nodes.map((c: Raw) => ({ id: String(c.databaseId), author: person(c.author), body: c.body, html: c.bodyHTML ?? "", createdAt: c.createdAt, url: c.url })),
  }));
  return {
    author: person(p.author), body: p.body ?? "", html: p.bodyHTML ?? "", createdAt: p.createdAt, url: p.url, base: p.baseRefName, head: p.headRefName,
    state: p.state, draft: p.isDraft, mergeable: p.mergeable, decision: p.reviewDecision ?? null,
    timeline, threads,
    verdicts: p.latestOpinionatedReviews.nodes.map((r: Raw) => ({ author: person(r.author), state: r.state })),
    requested: p.reviewRequests.nodes.map((r: Raw) => person(r.requestedReviewer)).filter((x: Person) => x.login !== "ghost"),
    checks: (p.commits.nodes[0]?.commit.statusCheckRollup?.contexts.nodes ?? []).map(check),
    fetchedAt: Date.now(),
  };
}
