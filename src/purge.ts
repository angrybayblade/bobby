// `bobby clean --stale`: everything Bobby keeps for reviews you're done with. A review is stale once its PR is merged or
// closed, or you haven't opened it in a while (30 days unless --days says otherwise). Its state, cached graphs and
// answers, exported trees and recents entry go; then each clone in ~/.bobby/repos that no remaining review uses. A
// review that still holds your unsent drafts or private notes is kept, whatever its age, and said so.
import { existsSync, readdirSync, readFileSync, rmdirSync, statSync } from "node:fs";
import { join } from "node:path";
import { run } from "./git.ts";
import { loadRecents, type Recent } from "./recents.ts";
import { home, reviewSlug } from "./state.ts";
import type { ReviewState } from "./types.ts";
import { sizeOf } from "./prune.ts";

export interface OnDisk {
  key: string; // a PR (owner/repo#n, its commit reviews included), or one local branch's review (its slug)
  owner: string; repo: string; number?: number; branch?: string;
  label: string; // what the list shows: owner/repo#n, or owner/repo (branch)
  states: string[]; // its state files' names, under ~/.bobby/state
  lastUsed: number; // when it was last opened or changed (ms)
  work: number; // unsent drafts and private notes in it
  shas: string[]; // its head commits, as their first 12 characters, for its cache files and trees
}

const DAY = 86_400_000;
const esc = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
const ls = (dir: string) => { try { return readdirSync(dir); } catch { return []; } };
const mtime = (p: string) => { try { return statSync(p).mtimeMs; } catch { return 0; } };
const prKey = (owner: string, repo: string, n: number) => `${owner}/${repo}#${n}`.toLowerCase();

/** A state file's name (without .json), read back: a PR's (owner_repo_n, or one commit of it), or a branch's. GitHub
 *  owners have no underscores, so the first one ends the owner; a repo may have them. */
export function parseSlug(name: string): Pick<OnDisk, "owner" | "repo" | "number" | "branch"> | null {
  const b = /^([^_]+)_(.+?)_branch_(.+)$/.exec(name);
  if (b) return { owner: b[1], repo: b[2], branch: b[3] };
  const p = /^([^_]+)_(.+)_(\d+)(?:_c[0-9a-f]{12}(?:-[0-9a-f]{7})?)?$/.exec(name);
  return p ? { owner: p[1], repo: p[2], number: Number(p[3]) } : null;
}

/** Whether a cache file belongs to a review, and if so its head commit's first 12 characters. A PR's covers its commit
 *  reviews; the name must go on as a commit does, so repo x's #13 doesn't take repo x_13's files. */
export function cacheMatch(file: string, r: Pick<OnDisk, "owner" | "repo" | "number" | "states">): string | null {
  const bases = r.number !== undefined ? [`${r.owner}_${r.repo}_${r.number}`] : r.states.map((s) => s.replace(/\.json$/, ""));
  for (const base of bases) {
    const m = new RegExp(`^${esc(base)}${r.number !== undefined ? "(?:_c[0-9a-f]{12}(?:-[0-9a-f]{7})?)?" : ""}_([0-9a-f]{12})[_.]`, "i").exec(file);
    if (m) return m[1];
  }
  return null;
}

/** Every review Bobby keeps anything for: from its state files, and from recents (opened, never marked). */
export async function reviewsOnDisk(): Promise<OnDisk[]> {
  const root = home(), all = new Map<string, OnDisk>();
  const keyOf = (x: { owner: string; repo: string; number?: number; branch?: string }, name: string) =>
    x.number !== undefined && !x.branch ? prKey(x.owner, x.repo, x.number) : name.toLowerCase();
  const entry = (x: Pick<OnDisk, "owner" | "repo" | "number" | "branch">, name: string): OnDisk => {
    const key = keyOf(x, name);
    return all.get(key) ?? all.set(key, { key, ...x, label: x.branch ? `${x.owner}/${x.repo} (${x.branch})` : `${x.owner}/${x.repo}#${x.number}`, states: [], lastUsed: 0, work: 0, shas: [] }).get(key)!;
  };
  for (const f of ls(join(root, "state"))) {
    if (!f.endsWith(".json")) continue; // locks, and state set aside as unreadable (prune.ts ages those out)
    const x = parseSlug(f.slice(0, -5));
    if (!x) continue;
    const r = entry(x, f.slice(0, -5)), path = join(root, "state", f);
    r.states.push(f);
    r.lastUsed = Math.max(r.lastUsed, mtime(path));
    try {
      const s = JSON.parse(readFileSync(path, "utf8")) as ReviewState;
      r.work += (s.comments?.length ?? 0) + (s.notes?.length ?? 0) + (s.note?.trim() ? 1 : 0);
      if (s.headSha) r.shas.push(s.headSha.slice(0, 12));
    } catch { r.work += 1; } // can't tell what's in it: keep it
  }
  for (const rc of await loadRecents()) {
    const local = rc.kind === "local";
    const x = { owner: rc.owner, repo: rc.repo, ...(local ? { branch: rc.branch ?? "" } : { number: rc.number }) };
    const r = entry(x, local ? reviewSlug({ owner: rc.owner, repo: rc.repo, number: 0, branch: rc.branch }) : "");
    r.lastUsed = Math.max(r.lastUsed, Date.parse(rc.openedAt) || 0);
    if (rc.commit?.sha) r.shas.push(rc.commit.sha.slice(0, 12));
  }
  for (const f of ls(join(root, "cache"))) for (const r of all.values()) { const sha = cacheMatch(f, r); if (sha) r.shas.push(sha); }
  for (const r of all.values()) r.shas = [...new Set(r.shas)];
  return [...all.values()];
}

/** Which PRs are merged or closed, by owner/repo#n, asked of GitHub in batches. Null when gh can't say. */
export async function closedPrs(prs: Array<{ owner: string; repo: string; number: number }>): Promise<Set<string> | null> {
  const out = new Set<string>();
  for (let i = 0; i < prs.length; i += 50) {
    const batch = prs.slice(i, i + 50);
    const q = `query { ${batch.map((p, j) => `p${j}: repository(owner: ${JSON.stringify(p.owner)}, name: ${JSON.stringify(p.repo)}) { pullRequest(number: ${p.number}) { state } }`).join(" ")} }`;
    const raw = await run(["gh", "api", "graphql", "-f", `query=${q}`], { allowFail: true, timeoutMs: 30_000 });
    let d: Record<string, { pullRequest?: { state?: string } } | null> | undefined;
    try { d = (JSON.parse(raw) as { data?: typeof d }).data; } catch { /* not signed in, offline */ }
    if (!d) return null;
    batch.forEach((p, j) => { const st = d![`p${j}`]?.pullRequest?.state; if (st === "MERGED" || st === "CLOSED") out.add(prKey(p.owner, p.repo, p.number)); });
  }
  return out;
}

export interface Plan {
  remove: Array<OnDisk & { why: string }>;
  kept: Array<OnDisk & { why: string }>; // stale, but holding your drafts or notes
}
/** Which reviews are stale: merged or closed, or not opened in `days`. Those with drafts or notes are kept. */
export function planStale(reviews: OnDisk[], { now = Date.now(), days = 30, closed = new Set<string>() } = {}): Plan {
  const plan: Plan = { remove: [], kept: [] };
  for (const r of reviews) {
    const idle = Math.floor((now - r.lastUsed) / DAY);
    const why = closed.has(r.key) ? "merged or closed" : idle >= days ? `not opened in ${idle} days` : "";
    if (!why) continue;
    if (r.work) plan.kept.push({ ...r, why: `${why}, but has ${r.work} unsent draft${r.work === 1 ? "" : "s"} or note${r.work === 1 ? "" : "s"}` });
    else plan.remove.push({ ...r, why });
  }
  plan.remove.sort((a, b) => a.label.localeCompare(b.label, undefined, { numeric: true }));
  plan.kept.sort((a, b) => a.label.localeCompare(b.label, undefined, { numeric: true }));
  return plan;
}

/** What removing the plan's reviews takes off the disk: paths and their size. Clones go once no review left uses them;
 *  trees once no review left is on the same commit. */
export function pathsOf(plan: Plan, reviews: OnDisk[]): Array<{ path: string; what: string; bytes: number }> {
  const root = home(), going = new Set(plan.remove.map((r) => r.key)), staying = reviews.filter((r) => !going.has(r.key));
  const out: Array<{ path: string; what: string }> = [];
  const cache = ls(join(root, "cache"));
  for (const r of plan.remove) {
    for (const s of r.states) out.push({ path: join(root, "state", s), what: "state" });
    for (const f of cache) if (cacheMatch(f, r)) out.push({ path: join(root, "cache", f), what: "cache" });
    const repoTrees = join(root, "trees", `${r.owner}_${r.repo}`);
    const shared = new Set(staying.filter((x) => `${x.owner}_${x.repo}` === `${r.owner}_${r.repo}`).flatMap((x) => x.shas));
    for (const sha of r.shas) if (!shared.has(sha)) for (const t of [sha, `${sha}-src`]) if (existsSync(join(repoTrees, t))) out.push({ path: join(repoTrees, t), what: "trees" });
  }
  // a clone Bobby made, once no PR review left is of that repo (a branch's review is of your own checkout): one a review
  // being removed used, or one no review uses at all; it's cloned again if a PR of that repo is opened
  const used = new Set(staying.filter((x) => x.number !== undefined).map((x) => `${x.owner}/${x.repo}`.toLowerCase()));
  for (const owner of ls(join(root, "repos"))) for (const repo of ls(join(root, "repos", owner))) {
    const name = `${owner}/${repo}`.toLowerCase();
    if (!used.has(name)) out.push({ path: join(root, "repos", owner, repo), what: "clones" });
  }
  return [...new Map(out.map((o) => [o.path, o])).values()].map((o) => ({ ...o, bytes: sizeOf(o.path) }));
}

/** Removes the paths, and the plan's reviews from recents. */
export async function purge(plan: Plan, paths: Array<{ path: string }>) {
  const { rmSync } = await import("node:fs");
  for (const { path } of paths) rmSync(path, { recursive: true, force: true });
  const root = home();
  for (const d of [join(root, "repos"), join(root, "trees")]) for (const sub of ls(d)) { try { rmdirSync(join(d, sub)); } catch { /* not empty */ } }
  const going = new Set(plan.remove.map((r) => r.key));
  const keyOfRecent = (rc: Recent) => rc.kind === "local" ? reviewSlug({ owner: rc.owner, repo: rc.repo, number: 0, branch: rc.branch }).toLowerCase() : prKey(rc.owner, rc.repo, rc.number);
  const recents = await loadRecents(), left = recents.filter((rc) => !going.has(keyOfRecent(rc)));
  if (left.length !== recents.length) await Bun.write(join(root, "recents.json"), JSON.stringify(left, null, 1));
}
