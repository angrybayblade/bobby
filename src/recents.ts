// The home page's data. Recents: every review you've opened, newest first, with how far you got (kept in
// ~/.bobby/recents.json, and enough to open each again). The GitHub lists: open PRs waiting on your review, yours, and
// everything GitHub lists as involving you, through gh's search API, filtered by repo, author and text.
import { join } from "node:path";
import { run } from "./git.ts";
import { home, savedPrReviews } from "./state.ts";
import type { PrInfo } from "./types.ts";

export interface Recent {
  id: string; // the review's address in the app: /r/<id>
  kind: "pr" | "commit" | "local";
  owner: string; repo: string; number: number;
  title: string; author?: string; url?: string;
  commit?: PrInfo["commit"]; branch?: string; baseRef?: string;
  // to open it again: the PR (its URL, or one commit's), and the clone it was built from
  arg?: string; repoDir?: string;
  openedAt: string;
  progress?: { done: number; total: number };
  drafts?: number;
  approved?: boolean; // as of the last time its conversation was read
}
const KEEP = 100;
const path = () => join(home(), "recents.json");

export async function loadRecents(): Promise<Recent[]> {
  const f = Bun.file(path());
  if (await f.exists()) return (await f.json().catch(() => [])) as Recent[];
  return seedFromState();
}
// TODO(0.1.0): remove with the other rc compatibility guards. Recents arrived after 0.1.0-rc6: on the first run after
// upgrading there's no recents.json, though the PRs you reviewed kept their progress in state/. Seed recents from those
// (titles come when each is next opened); written once, so it never runs again.
async function seedFromState(): Promise<Recent[]> {
  const seeded = savedPrReviews().sort((a, b) => b.savedAt - a.savedAt).slice(0, KEEP).map((r): Recent => ({
    id: `${r.owner}/${r.repo}/${r.number}`, kind: "pr", owner: r.owner, repo: r.repo, number: r.number,
    title: `${r.owner}/${r.repo}#${r.number}`, url: `https://github.com/${r.owner}/${r.repo}/pull/${r.number}`,
    arg: `https://github.com/${r.owner}/${r.repo}/pull/${r.number}`, openedAt: new Date(r.savedAt || Date.now()).toISOString(),
  }));
  await Bun.write(path(), JSON.stringify(seeded, null, 1)).catch(() => {});
  return seeded;
}
let writing = Promise.resolve();
/** Adds or updates a review in recents, at the top when it's an open (openedAt given). */
export function noteRecent(r: Partial<Recent> & { id: string }) {
  writing = writing.then(async () => {
    const all = await loadRecents(), at = all.findIndex((x) => x.id === r.id);
    const next = { ...(at >= 0 ? all[at] : {}), ...r } as Recent;
    if (at >= 0) all.splice(at, 1);
    if (r.openedAt || at < 0) all.unshift(next); else all.splice(at, 0, next);
    const tmp = `${path()}.${process.pid}.tmp`;
    await Bun.write(tmp, JSON.stringify(all.slice(0, KEEP), null, 1));
    (await import("node:fs")).renameSync(tmp, path());
  }).catch(() => {});
  return writing;
}
/** A review just opened, as recents knows it. */
export function recentOf(id: string, pr: PrInfo, repoDir: string): Recent {
  const kind = pr.provider === "local" ? "local" : pr.commit ? "commit" : "pr";
  const arg = kind === "local" ? undefined : `${pr.url}${pr.commit ? `/changes/${pr.commit.from ? `${pr.commit.from}..` : ""}${pr.commit.sha}` : ""}`;
  return {
    id, kind, owner: pr.owner, repo: pr.repo, number: pr.number, title: pr.commit ? pr.commit.subject : pr.title, author: pr.author, url: pr.url || undefined,
    ...(pr.commit ? { commit: pr.commit } : {}), ...(pr.branch ? { branch: pr.branch, baseRef: pr.baseRef } : {}),
    ...(arg ? { arg } : {}), repoDir, openedAt: new Date().toISOString(),
  };
}

export interface ListedPr { owner: string; repo: string; number: number; title: string; author: string; url: string; updatedAt: string; draft: boolean; comments: number; approved: boolean }
export interface PrLists { review: ListedPr[]; mine: ListedPr[]; all: ListedPr[]; error?: string }

/** Approved: GitHub says so (its review rules are met), or, in a repo with no rules, someone approved and no one asked
 *  for changes. An approval that still needs another (a code owner's, a second one) isn't. */
export function approvedOf(decision: string | null | undefined, verdicts: string[]): boolean {
  if (decision) return decision === "APPROVED";
  return verdicts.includes("APPROVED") && !verdicts.includes("CHANGES_REQUESTED");
}

const lists = new Map<string, { at: number; value: Promise<PrLists> }>();
/** Open PRs: waiting on your review, yours, and all that involve you; each narrowed by repo, author and text. Cached a minute. */
export function prLists(f: { repo?: string; author?: string; q?: string }, fresh = false): Promise<PrLists> {
  const filters = [f.repo && `repo:${f.repo.replace(/^https:\/\/github\.com\//, "").replace(/\/$/, "")}`, f.author && `author:${f.author.replace(/^@/, "")}`, f.q && f.q.replace(/[^\w\s.#/-]/g, " ")]
    .filter(Boolean).join(" ");
  const key = filters;
  const hit = lists.get(key);
  if (hit && !fresh && Date.now() - hit.at < 60_000) return hit.value;
  const search = (scope: string) => `search(query: ${JSON.stringify(`is:pr is:open archived:false ${scope} ${filters} sort:updated-desc`.replace(/\s+/g, " "))}, type: ISSUE, first: 50) { nodes { ...pr } }`;
  const query = `query { review: ${search("review-requested:@me")} mine: ${search("author:@me")} all: ${search("involves:@me")} }
    fragment pr on PullRequest { url number title author { login } updatedAt isDraft comments { totalCount } reviewDecision latestOpinionatedReviews(first: 50) { nodes { state } } }`;
  type Raw = { url: string; number: number; title: string; author: { login: string } | null; updatedAt: string; isDraft: boolean; comments: { totalCount: number }; reviewDecision: string | null; latestOpinionatedReviews: { nodes: Array<{ state: string }> } };
  const listed = (x: Raw): ListedPr => {
    const [, owner, repo] = x.url.match(/github\.com\/([^/]+)\/([^/]+)\/pull/) ?? [];
    return { owner, repo, number: x.number, title: x.title, author: x.author?.login ?? "ghost", url: x.url, updatedAt: x.updatedAt, draft: x.isDraft,
      comments: x.comments.totalCount, approved: approvedOf(x.reviewDecision, x.latestOpinionatedReviews.nodes.map((r) => r.state)) };
  };
  const value = run(["gh", "api", "graphql", "-f", `query=${query}`])
    .then((out) => {
      const d = (JSON.parse(out) as { data: Record<"review" | "mine" | "all", { nodes: Raw[] }> }).data;
      const of = (k: "review" | "mine" | "all") => d[k].nodes.filter((x) => x?.url).map(listed); // an issue matches as {}
      return { review: of("review"), mine: of("mine"), all: of("all") };
    })
    .catch((e) => { lists.delete(key); return { review: [], mine: [], all: [], error: String((e as Error).message ?? e) }; });
  lists.delete(key); // to the back: the oldest is first
  lists.set(key, { at: Date.now(), value });
  if (lists.size > 20) lists.delete(lists.keys().next().value!); // each search typed is a key
  return value;
}
