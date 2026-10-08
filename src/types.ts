export type LineKind = " " | "+" | "-";

export interface DiffLine {
  t: LineKind;
  o: number | null; // old line number
  n: number | null; // new line number
  s: string;
}

export interface Hunk {
  id: string;
  file: string;
  oldFile: string;
  header: string;
  ctx: string; // git's funcname context after @@
  oldStart: number;
  newStart: number;
  lines: DiffLine[];
  hash: string; // stable across re-pushes if content is identical
  noise?: string; // reason this hunk is collapsed by default
}

export interface FileDiff {
  path: string;
  oldPath: string;
  status: "added" | "deleted" | "modified" | "renamed";
  binary: boolean;
  hunks: Hunk[];
  noise?: string;
}

/** A group of hunks in one file that change the same symbol. */
export interface Unit {
  id: string;
  file: string;
  symbols: string[];
  hunkIds: string[];
}

/** A location in code the PR did not touch. */
export interface CodeRef {
  id: string;
  path: string;
  line: number;
  text: string;
  dir: "up" | "down"; // up = definition the change relies on; down = usage of changed symbol
  symbol: string;
  forUnit: string; // unit this ref was found for
}

export type Band = "upUnchanged" | "upChanged" | "core" | "downChanged" | "downUnchanged";
export const BANDS: Band[] = ["upUnchanged", "upChanged", "core", "downChanged", "downUnchanged"];

export interface TreeNode {
  id: string;
  band: Band;
  title: string;
  why: string;
  risk?: "high" | "med" | "low";
  unitIds?: string[]; // changed code
  ref?: { path: string; line: number; start: number; end: number }; // unchanged code
  seenIn?: string; // node id where this content was already shown in full
  attachTo?: string; // unit id one step closer to the core (from Claude)
  relation?: string; // short edge label
}

export interface Core {
  id: string;
  title: string;
  summary: string;
  bands: Record<Band, TreeNode[]>;
}

export interface ChangeTree {
  source: "heuristic" | "claude";
  intent: string;
  cores: Core[];
  noiseHunkIds: string[];
}

export interface PrInfo {
  owner: string;
  repo: string;
  number: number;
  title: string;
  body: string;
  url: string;
  author: string;
  baseSha: string; // merge-base
  headSha: string;
}

export interface Comment {
  id: string;
  path: string;
  line: number;
  side: "LEFT" | "RIGHT";
  body: string;
  inDiff: boolean; // false → goes into the review body, GitHub rejects inline comments outside the diff
}

export interface ReviewState {
  headSha: string;
  marks: Record<string, "reviewed" | "flagged">; // keyed by hunk hash or ref key
  comments: Comment[];
  lastNodeId?: string; // graph node id (stable across tree regenerations)
  lastSeenAt?: string;
  note?: string; // "where my head was": parked thought shown on return
}
