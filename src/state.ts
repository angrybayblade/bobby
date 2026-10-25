import { createHash } from "node:crypto";
import { homedir } from "node:os";
import { join } from "node:path";
import { existsSync, mkdirSync, readdirSync, readFileSync, renameSync, statSync, unlinkSync, writeFileSync } from "node:fs";
import type { ReviewGraph } from "./graph.ts";
import type { ChangeTree, PrInfo, ReviewState } from "./types.ts";

const ROOT = process.env.BOBBY_HOME || join(homedir(), ".bobby"); // BOBBY_HOME: elsewhere, as for a test
// Before the rename, everything lived in ~/.prfocus: move it over once, progress and clones included.
// Lazily, on first use, so --help and --version never touch your files.
const LEGACY = join(homedir(), ".prfocus");
let migrated = false;
export function home() {
  if (!migrated && !process.env.BOBBY_HOME && !existsSync(ROOT) && existsSync(LEGACY)) {
    try { renameSync(LEGACY, ROOT); console.error(`  moved ${LEGACY} to ${ROOT}`); } catch { /* keep going with a fresh ~/.bobby */ }
  }
  migrated = true;
  return ROOT;
}
type PrKey = Pick<PrInfo, "owner" | "repo" | "number" | "branch" | "commit">;
// A local review is keyed by its branch, so each branch keeps its own progress. A branch name that isn't safe as a
// file name as is gets a hash of itself too: a/b-c and a-b/c both clean to a-b-c.
const clean = (b: string) => b.replace(/[^\w.-]+/g, "-");
const slug = (pr: PrKey) => pr.branch
  ? `${pr.owner}_${pr.repo}_branch_${clean(pr.branch)}${clean(pr.branch) === pr.branch ? "" : `-${createHash("sha1").update(pr.branch).digest("hex").slice(0, 6)}`}`
  : `${pr.owner}_${pr.repo}_${pr.number}${pr.commit ? `_c${pr.commit.sha.slice(0, 12)}${pr.commit.from ? `-${pr.commit.from.slice(0, 7)}` : ""}` : ""}`; // one commit: a review of its own
const legacySlug = (pr: PrKey) => (pr.branch ? `${pr.owner}_${pr.repo}_branch_${clean(pr.branch)}` : slug(pr)); // before the hash

/** A JSON file, or null if there's none. One that won't parse is set aside as .corrupt-<time> (and said so), never
 *  silently taken for empty: the next save would otherwise overwrite what was in it. */
function readJson<T>(path: string): T | null {
  home();
  if (!existsSync(path)) return null;
  try { return JSON.parse(readFileSync(path, "utf8")); } catch (e) {
    const aside = `${path}.corrupt-${Date.now()}`;
    try { renameSync(path, aside); console.error(`  ! ${path} couldn't be read (${(e as Error).message}); kept as ${aside}`); } catch { /* read-only: leave it */ }
    return null;
  }
}
/** Written beside, then renamed into place: a crash mid-write leaves the old file whole, never half a new one. */
function writeJson(path: string, value: unknown) {
  home();
  mkdirSync(join(path, ".."), { recursive: true });
  const tmp = `${path}.${process.pid}.tmp`;
  writeFileSync(tmp, JSON.stringify(value, null, 1));
  renameSync(tmp, path);
}

/** Marks are keyed by hunk content hash, so they survive force-pushes for hunks that didn't change. */
export const STATE_VERSION = 1; // bump with a migration in loadState when ReviewState changes shape
export function loadState(pr: PrKey & { headSha: string }): ReviewState {
  const path = join(ROOT, "state", `${slug(pr)}.json`), legacy = join(ROOT, "state", `${legacySlug(pr)}.json`);
  const s = readJson<ReviewState>(existsSync(path) || !existsSync(legacy) ? path : legacy); // saved under the new name from now on
  return s ? { ...s, version: STATE_VERSION, headSha: pr.headSha } : { version: STATE_VERSION, headSha: pr.headSha, marks: {}, comments: [] };
}
export const saveState = (pr: PrKey, s: ReviewState) => writeJson(join(ROOT, "state", `${slug(pr)}.json`), { ...s, version: STATE_VERSION });

// One Bobby app at a time: it keeps each review's state in memory and saves all of it, so a second app on the same review
// would save over the first's marks and drafts. The running one leaves its pid and port here; a second `bobby` hands
// its review to it instead.
const lockPath = (name: string) => join(ROOT, "state", `${name}.lock`);
const alive = (pid: number) => { try { process.kill(pid, 0); return true; } catch (e) { return (e as { code?: string }).code === "EPERM"; } };
/** The other Bobby app, if one is still running (a lock left by one that died is ignored). */
export function holder(name = "app"): { pid: number; port: number } | null {
  let l: { pid: number; port: number } | null = null;
  try { l = JSON.parse(readFileSync(lockPath(name), "utf8")); } catch { return null; }
  return l && l.pid !== process.pid && alive(l.pid) ? l : null;
}
// TODO(0.1.0): remove with the other rc compatibility guards. Up to 0.1.0-rc6, each Bobby served one review and locked
// it as state/<review>.lock, which an app (app.lock) doesn't see: an rc Bobby still running on a review would hold its
// progress in memory beside this one's, and the two would save over each other.
/** An older (≤ rc6) Bobby still serving this review, if any. */
export function legacyHolder(pr: PrKey): { pid: number; port: number } | null {
  let l: { pid: number; port: number } | null = null;
  try { l = JSON.parse(readFileSync(join(ROOT, "state", `${slug(pr)}.lock`), "utf8")); } catch { return null; }
  return l && l.pid !== process.pid && alive(l.pid) ? l : null;
}
/** The reviews progress was kept for, by file: owner, repo and number for a PR's (a branch's or one commit's can't be
 *  opened from its name alone). */
export function savedPrReviews(): Array<{ owner: string; repo: string; number: number; savedAt: number }> {
  let names: string[] = [];
  try { names = readdirSync(join(ROOT, "state")); } catch { return []; }
  // GitHub owners have no underscores, so the first one ends the owner; the number ends the name
  return names.flatMap((n) => {
    const m = /^([^_]+)_(.+)_(\d+)\.json$/.exec(n);
    if (!m || /_branch_/.test(n)) return [];
    let savedAt = 0;
    try { savedAt = statSync(join(ROOT, "state", n)).mtimeMs; } catch { /* gone meanwhile */ }
    return [{ owner: m[1], repo: m[2], number: Number(m[3]), savedAt }];
  });
}

/** Marks this process as the running app, until it exits. */
export function hold(port: number, name = "app") {
  const path = lockPath(name);
  writeJson(path, { pid: process.pid, port });
  // ctrl-c, a closed terminal or a kill end the process without "exit" unless something listens (the language
  // servers' handler exits for SIGINT already)
  for (const sig of ["SIGINT", "SIGTERM", "SIGHUP"] as const) if (!process.listenerCount(sig)) process.once(sig, () => process.exit(130));
  process.once("exit", () => { try { if (JSON.parse(readFileSync(path, "utf8")).pid === process.pid) unlinkSync(path); } catch { /* gone already */ } });
}

// The diff also depends on the base it's compared with, so that's part of the cache key: a local review's base commit,
// a PR's base branch (retargeting a PR changes its diff without a new push).
const rev = (pr: { headSha: string; baseSha?: string; branch?: string; baseRef?: string }) =>
  pr.headSha.slice(0, 12) + (pr.branch && pr.baseSha ? `_${pr.baseSha.slice(0, 7)}` : !pr.branch && pr.baseRef ? `_${pr.baseRef.replace(/[^\w.-]+/g, "-")}` : "");
// Claude's tree names extraction's units, which another extraction version may number differently: keyed by it too.
const treePath = (pr: PrInfo, version: string) => join(ROOT, "cache", `${slug(pr)}_${rev(pr)}.tree.${version}.json`);
export const loadCachedTree = (pr: PrInfo, version: string) => readJson<ChangeTree>(treePath(pr, version));
export const saveCachedTree = (pr: PrInfo, version: string, t: ChangeTree) => writeJson(treePath(pr, version), t);

/** Built graphs per head commit, so reopening an unchanged PR skips fetching, diffing and analysis. */
export interface CachedGraphs { static: ReviewGraph; claude?: ReviewGraph }
type GraphKey = PrKey & { headSha: string; baseSha?: string; baseRef?: string };
const graphPath = (pr: GraphKey) => join(ROOT, "cache", `${slug(pr)}_${rev(pr)}.graphs.json`);
export const loadCachedGraphs = (pr: GraphKey) => readJson<CachedGraphs>(graphPath(pr));
export const saveCachedGraphs = (pr: GraphKey, g: CachedGraphs) => writeJson(graphPath(pr), g);

/** UI preferences; free-form so views can add their own keys. */
const settingsPath = join(ROOT, "settings.json");
export const loadSettings = (): Record<string, unknown> => readJson(settingsPath) ?? {};
export const saveSettings = (s: Record<string, unknown>) => writeJson(settingsPath, s);

/** A language server's definitions per head commit and server version: asking again means loading the project again. */
type Defs = Record<string, import("./types.ts").Definition[]>;
const defsPath = (pr: GraphKey, server: string) => join(ROOT, "cache", `${slug(pr)}_${rev(pr)}.defs.${server}.json`);
export const loadCachedDefs = (pr: GraphKey, server: string) => readJson<Defs>(defsPath(pr, server));
export const saveCachedDefs = (pr: GraphKey, server: string, d: Defs) => writeJson(defsPath(pr, server), d);
