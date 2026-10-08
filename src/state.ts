import { homedir } from "node:os";
import { join } from "node:path";
import { mkdirSync, existsSync, readFileSync, writeFileSync } from "node:fs";
import type { ReviewGraph } from "./graph.ts";
import type { ChangeTree, PrInfo, ReviewState } from "./types.ts";

const ROOT = join(homedir(), ".prfocus");
type PrKey = Pick<PrInfo, "owner" | "repo" | "number">;
const slug = (pr: PrKey) => `${pr.owner}_${pr.repo}_${pr.number}`;

function readJson<T>(path: string): T | null {
  try { return existsSync(path) ? JSON.parse(readFileSync(path, "utf8")) : null; } catch { return null; }
}
function writeJson(path: string, value: unknown) {
  mkdirSync(join(path, ".."), { recursive: true });
  writeFileSync(path, JSON.stringify(value, null, 1));
}

/** Marks are keyed by hunk content hash, so they survive force-pushes for hunks that didn't change. */
export function loadState(pr: PrKey & { headSha: string }): ReviewState {
  const s = readJson<ReviewState>(join(ROOT, "state", `${slug(pr)}.json`));
  return s ? { ...s, headSha: pr.headSha } : { headSha: pr.headSha, marks: {}, comments: [] };
}
export const saveState = (pr: PrKey, s: ReviewState) => writeJson(join(ROOT, "state", `${slug(pr)}.json`), s);

const treePath = (pr: PrInfo) => join(ROOT, "cache", `${slug(pr)}_${pr.headSha.slice(0, 12)}.json`);
export const loadCachedTree = (pr: PrInfo) => readJson<ChangeTree>(treePath(pr));
export const saveCachedTree = (pr: PrInfo, t: ChangeTree) => writeJson(treePath(pr), t);

/** Built graphs per head commit, so reopening an unchanged PR skips fetching, diffing and analysis. */
export interface CachedGraphs { static: ReviewGraph; claude?: ReviewGraph }
const graphPath = (pr: PrKey & { headSha: string }) => join(ROOT, "cache", `${slug(pr)}_${pr.headSha.slice(0, 12)}.graphs.json`);
export const loadCachedGraphs = (pr: PrKey & { headSha: string }) => readJson<CachedGraphs>(graphPath(pr));
export const saveCachedGraphs = (pr: PrKey & { headSha: string }, g: CachedGraphs) => writeJson(graphPath(pr), g);

/** UI preferences; free-form so views can add their own keys. */
const settingsPath = join(ROOT, "settings.json");
export const loadSettings = (): Record<string, unknown> => readJson(settingsPath) ?? {};
export const saveSettings = (s: Record<string, unknown>) => writeJson(settingsPath, s);
