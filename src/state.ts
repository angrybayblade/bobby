import { homedir } from "node:os";
import { join } from "node:path";
import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import type { ReviewGraph } from "./graph.ts";
import type { ChangeTree, PrInfo, ReviewState } from "./types.ts";

const ROOT = join(homedir(), ".bobby");
// Before the rename, everything lived in ~/.prfocus: move it over once, progress and clones included.
// Lazily, on first use, so --help and --version never touch your files.
const LEGACY = join(homedir(), ".prfocus");
let migrated = false;
export function home() {
  if (!migrated && !existsSync(ROOT) && existsSync(LEGACY)) {
    try { renameSync(LEGACY, ROOT); console.error(`  moved ${LEGACY} to ${ROOT}`); } catch { /* keep going with a fresh ~/.bobby */ }
  }
  migrated = true;
  return ROOT;
}
type PrKey = Pick<PrInfo, "owner" | "repo" | "number" | "branch">;
// A local review is keyed by its branch, so each branch keeps its own progress.
const slug = (pr: PrKey) => (pr.branch ? `${pr.owner}_${pr.repo}_branch_${pr.branch.replace(/[^\w.-]+/g, "-")}` : `${pr.owner}_${pr.repo}_${pr.number}`);

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
export function loadState(pr: PrKey & { headSha: string }): ReviewState {
  const s = readJson<ReviewState>(join(ROOT, "state", `${slug(pr)}.json`));
  return s ? { ...s, headSha: pr.headSha } : { headSha: pr.headSha, marks: {}, comments: [] };
}
export const saveState = (pr: PrKey, s: ReviewState) => writeJson(join(ROOT, "state", `${slug(pr)}.json`), s);

// A local review's diff also depends on the base it's compared with, so that's part of its cache key.
const rev = (pr: { headSha: string; baseSha?: string; branch?: string }) => pr.headSha.slice(0, 12) + (pr.branch && pr.baseSha ? `_${pr.baseSha.slice(0, 7)}` : "");
// Claude's tree names extraction's units, which another extraction version may number differently: keyed by it too.
const treePath = (pr: PrInfo, version: string) => join(ROOT, "cache", `${slug(pr)}_${rev(pr)}.tree.${version}.json`);
export const loadCachedTree = (pr: PrInfo, version: string) => readJson<ChangeTree>(treePath(pr, version));
export const saveCachedTree = (pr: PrInfo, version: string, t: ChangeTree) => writeJson(treePath(pr, version), t);

/** Built graphs per head commit, so reopening an unchanged PR skips fetching, diffing and analysis. */
export interface CachedGraphs { static: ReviewGraph; claude?: ReviewGraph }
type GraphKey = PrKey & { headSha: string; baseSha?: string };
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
