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
  hook?: string; // one question or risk to lead with, so the core starts with something to look for
  bands: Record<Band, TreeNode[]>;
}

export interface ChangeTree {
  source: "heuristic" | "claude";
  intent: string;
  cores: Core[];
  noiseHunkIds: string[];
}

export interface PrInfo {
  provider?: "github" | "local"; // local: the branch you're on, no PR (number 0, url "")
  branch?: string; // local only
  baseRef?: string; // the branch it's compared against: a PR's base branch, or a local review's base
  owner: string;
  repo: string;
  number: number;
  title: string;
  body: string;
  url: string;
  author: string;
  baseSha: string; // merge-base
  headSha: string;
  // One commit of the PR (or a range of them) rather than all of it: headSha is that commit, baseSha its parent (or the
  // range's start), so the diff is what those commits changed.
  commit?: { sha: string; from?: string; subject: string };
}

export interface Comment {
  id: string;
  path: string;
  line: number; // the last line; a range starts at startLine
  side: "LEFT" | "RIGHT";
  startLine?: number;
  startSide?: "LEFT" | "RIGHT";
  body: string;
  wip?: boolean; // unfinished: the composer was closed with text in it; never posted until you finish it
  kind?: "note"; // an unfinished private note (finished notes live in ReviewState.notes)
  inDiff: boolean; // false → goes into the review body, GitHub rejects inline comments outside the diff
}

/** A note only you see. Never posted to GitHub. On a line (path + line + side), a whole file (path only), or the PR (neither). */
export interface PrivateNote {
  id: string;
  body: string;
  createdAt: string;
  path?: string;
  line?: number;
  side?: "LEFT" | "RIGHT";
  startLine?: number;
  startSide?: "LEFT" | "RIGHT";
}

/** Something Claude found in an agent-assisted review (agent.ts), on a line of the diff: a suggestion until you add it
 *  to your drafts or dismiss it. */
export interface Finding {
  id: string;
  path: string; side: "LEFT" | "RIGHT"; line: number; startLine?: number;
  severity: "bug" | "risk" | "question" | "nit"; title: string; body: string;
  status: "open" | "drafted" | "dismissed";
  draftId?: string; // the draft it became
}
/** A finished agent review, for one head commit. left: findings on files the diff doesn't have, left out. */
export interface AgentReview { headSha: string; at: string; summary: string; findings: Finding[]; left?: number; cost?: number }

export interface ReviewState {
  version?: number; // the state file's format (STATE_VERSION in state.ts); absent before 1
  headSha: string;
  marks: Record<string, "reviewed" | "flagged">; // keyed by hunk hash or ref key
  comments: Comment[];
  notes?: PrivateNote[]; // private; /api/submit never reads them
  lastNodeId?: string; // graph node id (stable across tree regenerations)
  lastLevel?: number; // zoom level you were at: 0 overview · 1 core · 2 page
  lastSeenAt?: string;
  note?: string; // "where my head was": parked thought shown on return
  agent?: AgentReview; // the last agent-assisted review (agent.ts)
}

/** A name used on a new-side line of the change, and where it's declared: in the repo (to), outside it (ext: a
 *  package or the language's own library), or not found (neither). via: how it was found. */
export interface Definition {
  line: number; col: number; len: number; name: string; // col: 0-based, UTF-16 units
  to?: { path: string; line: number; end?: number };
  ext?: string;
  via?: "lsp" | "syntax";
}
