// The home page's data. Recents: every review you've opened, newest first, with how far you got (kept in
// ~/.bobby/recents.json, and enough to open each again). The GitHub lists: open PRs waiting on your review, yours, and
// everything GitHub lists as involving you, through gh's search API, filtered by repo, author and text.
import { join } from "node:path";
import { run } from "./git.ts";
import { home } from "./state.ts";
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
}
const KEEP = 100;
const path = () => join(home(), "recents.json");

export async function loadRecents(): Promise<Recent[]> {
  const f = Bun.file(path());
  return (await f.exists()) ? ((await f.json().catch(() => [])) as Recent[]) : [];
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

export interface ListedPr { owner: string; repo: string; number: number; title: string; author: string; url: string; updatedAt: string; draft: boolean; comments: number }
export interface PrLists { review: ListedPr[]; mine: ListedPr[]; all: ListedPr[]; error?: string }

const lists = new Map<string, { at: number; value: Promise<PrLists> }>();
/** Open PRs: waiting on your review, yours, and all that involve you; each narrowed by repo, author and text. Cached a minute. */
export function prLists(f: { repo?: string; author?: string; q?: string }, fresh = false): Promise<PrLists> {
  const filters = [f.repo && `repo:${f.repo.replace(/^https:\/\/github\.com\//, "").replace(/\/$/, "")}`, f.author && `author:${f.author.replace(/^@/, "")}`, f.q && f.q.replace(/[^\w\s.#/-]/g, " ")]
    .filter(Boolean).join(" ");
  const key = filters;
  const hit = lists.get(key);
  if (hit && !fresh && Date.now() - hit.at < 60_000) return hit.value;
  const search = async (scope: string): Promise<ListedPr[]> => {
    const q = `is:pr is:open archived:false ${scope} ${filters}`.trim();
    const out = await run(["gh", "api", "-X", "GET", "search/issues", "-f", `q=${q}`, "-f", "per_page=50", "-f", "sort=updated",
      "--jq", ".items[] | {url: .html_url, number, title, author: .user.login, updatedAt: .updated_at, draft: (.draft // false), comments}"]);
    return out.split("\n").filter((l) => l.startsWith("{")).map((l) => {
      const x = JSON.parse(l) as Omit<ListedPr, "owner" | "repo">, [, owner, repo] = x.url.match(/github\.com\/([^/]+)\/([^/]+)\/pull/) ?? [];
      return { ...x, owner, repo };
    });
  };
  const value = Promise.all([search("review-requested:@me"), search("author:@me"), search("involves:@me")])
    .then(([review, mine, all]) => ({ review, mine, all }))
    .catch((e) => { lists.delete(key); return { review: [], mine: [], all: [], error: String((e as Error).message ?? e) }; });
  lists.set(key, { at: Date.now(), value });
  return value;
}
