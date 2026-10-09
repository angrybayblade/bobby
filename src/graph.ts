/**
 * Focus Bobby's review graph v1: the contract between extraction and views.
 * Extractors (this repo's static + Claude pipeline, or anything else) emit a ReviewGraph;
 * views only ever read a ReviewGraph. See SPEC.md and schema/review-graph.v1.schema.json.
 */
import { fileLines } from "./git.ts";
import type { Analysis } from "./analyze.ts";
import type { Band, ChangeTree, DiffLine, FileDiff, PrInfo, TreeNode } from "./types.ts";
import { BANDS } from "./types.ts";

export const GRAPH_SCHEMA = "bobby.review-graph/v1" as const;
export const LEGACY_SCHEMAS = ["prfocus.review-graph/v1"]; // the same contract under its old name; still opens
export const VERSION = "0.4.0"; // bump when extraction output changes: cached graphs from other versions are rebuilt
const SNIPPET_RADIUS = 10;

export interface ReviewGraph {
  schema: typeof GRAPH_SCHEMA;
  generatedAt: string;
  generator: { name: string; version: string; tree: "static" | "claude" };
  pr: {
    provider: "github" | "local";
    branch?: string; baseRef?: string;
    owner: string; repo: string; number: number; url: string;
    title: string; body: string; author: string;
    baseSha: string; headSha: string;
  };
  intent: string;
  files: GFile[];
  hunks: GHunk[];
  nodes: GNode[];
  cores: GCore[];
  edges: GEdge[];
  walk: string[];
  lowSignal: string[];
  discussion?: GDiscussion[];
}

/** An existing inline review comment on GitHub, anchored to a line of the diff. */
export interface GDiscussion {
  id: string; path: string; line: number; side: "LEFT" | "RIGHT";
  author: string; body: string; url: string; createdAt: string;
  replyTo?: string;
}

export interface GFile {
  path: string; oldPath: string;
  status: "added" | "deleted" | "modified" | "renamed";
  binary: boolean; additions: number; deletions: number;
  lowSignal?: string;
}

export interface GHunk {
  id: string; file: string; header: string; context: string;
  oldStart: number; newStart: number; hash: string;
  lines: DiffLine[];
  lowSignal?: string;
}

export type GNode =
  | { id: string; kind: "change"; name: string; file: string; symbols: string[]; hunkIds: string[] }
  | { id: string; kind: "context"; name: string; symbol: string; location: { path: string; line: number }; snippet: { start: number; lines: string[] } };

export interface GPlacement {
  id: string;
  node: string;
  band: Band;
  title: string;
  why: string;
  risk?: "high" | "med" | "low";
  repeatOf?: string;
}

export interface GCore {
  id: string;
  title: string;
  summary: string;
  hook?: string; // a question or risk to lead with
  bands: Record<Band, GPlacement[]>;
}

export interface GEdge {
  core: string;
  from: string; // placement id, upstream side
  to: string;   // placement id, downstream side
  label?: string;
}

const changeId = (file: string, symbol: string) => `chg:${file}#${symbol}`;
const contextId = (path: string, line: number) => `ctx:${path}:${line}`;

export async function buildGraph(cwd: string | null, pr: PrInfo, files: FileDiff[], a: Analysis, tree: ChangeTree, discussion: GDiscussion[] = []): Promise<ReviewGraph> {
  const nodes = new Map<string, GNode>();
  const unitNode = new Map<string, string>(); // unit id → node id

  for (const u of a.units) {
    const id = changeId(u.file, u.symbols[0]);
    unitNode.set(u.id, id);
    nodes.set(id, { id, kind: "change", name: u.symbols[0], file: u.file, symbols: u.symbols, hunkIds: u.hunkIds });
  }

  const ensureContext = async (n: TreeNode): Promise<string> => {
    const { path, line } = n.ref!;
    const id = contextId(path, line);
    if (!nodes.has(id)) {
      const ref = a.refs.find((r) => r.path === path && r.line === line);
      const all = cwd ? await fileLines(cwd, pr.headSha, path) : [];
      const start = Math.max(1, line - SNIPPET_RADIUS);
      nodes.set(id, {
        id, kind: "context", name: ref?.symbol ?? path.split("/").pop()!, symbol: ref?.symbol ?? "",
        location: { path, line },
        snippet: { start, lines: all.slice(start - 1, line + SNIPPET_RADIUS) },
      });
    }
    return id;
  };

  // Placements, in band order, with a stable id per tree.
  let p = 0;
  const treeIdToPlacement = new Map<string, string>();
  const hints = new Map<string, Hint>();
  const cores: GCore[] = [];
  for (const c of tree.cores) {
    const bands = { upUnchanged: [], upChanged: [], core: [], downChanged: [], downUnchanged: [] } as Record<Band, GPlacement[]>;
    for (const band of BANDS) {
      for (const n of c.bands[band]) {
        const node = n.ref ? await ensureContext(n) : unitNode.get(n.unitIds![0])!;
        const id = `p${++p}`;
        treeIdToPlacement.set(n.id, id);
        bands[band].push({ id, node, band, title: n.title, why: n.why, risk: n.risk });
        if (n.attachTo || n.relation) hints.set(id, { attachNode: n.attachTo ? unitNode.get(n.attachTo) : undefined, relation: n.relation });
      }
    }
    const core: GCore = { id: c.id, title: c.title, summary: c.summary, bands };
    core.hook = c.hook || staticHook(core);
    cores.push(core);
  }
  // Repeats point at the placement that shows the content in full.
  for (const c of tree.cores)
    for (const band of BANDS)
      for (const n of c.bands[band])
        if (n.seenIn) {
          const pl = findPlacement(cores, treeIdToPlacement.get(n.id)!);
          if (pl) pl.repeatOf = treeIdToPlacement.get(n.seenIn);
        }

  const edges = cores.flatMap((c) => coreEdges(c, nodes, a, unitNode, hints));
  const walk = cores.flatMap((c) => BANDS.flatMap((b) => c.bands[b].filter((pl) => !pl.repeatOf).map((pl) => pl.id)));

  const hunkCount = (f: FileDiff, t: string) => f.hunks.reduce((s, h) => s + h.lines.filter((l) => l.t === t).length, 0);
  return {
    schema: GRAPH_SCHEMA,
    generatedAt: new Date().toISOString(),
    generator: { name: "focus-bobby", version: VERSION, tree: tree.source === "claude" ? "claude" : "static" },
    pr: {
      provider: pr.provider ?? "github", ...(pr.branch ? { branch: pr.branch, baseRef: pr.baseRef } : {}), owner: pr.owner, repo: pr.repo, number: pr.number, url: pr.url,
      title: pr.title, body: pr.body, author: pr.author, baseSha: pr.baseSha, headSha: pr.headSha,
    },
    intent: tree.intent,
    files: files.map((f) => ({
      path: f.path, oldPath: f.oldPath, status: f.status, binary: f.binary,
      additions: hunkCount(f, "+"), deletions: hunkCount(f, "-"), ...(f.noise ? { lowSignal: f.noise } : {}),
    })),
    hunks: files.flatMap((f) => f.hunks.map((h) => ({
      id: h.id, file: h.file, header: h.header, context: h.ctx, oldStart: h.oldStart, newStart: h.newStart,
      hash: h.hash, lines: h.lines, ...(h.noise ? { lowSignal: h.noise } : {}),
    }))),
    nodes: [...nodes.values()],
    cores,
    edges,
    walk,
    lowSignal: tree.noiseHunkIds,
    ...(discussion.length ? { discussion } : {}),
  };
}

/** A question to lead with when the tree didn't write one: what this core could break. */
function staticHook(c: GCore): string {
  const name = c.bands.core[0]?.title ?? c.title;
  const risky = c.bands.downUnchanged.find((p) => p.risk === "high");
  if (risky) return `Does ${risky.title} still behave now that \`${name}\` changed?`;
  const n = c.bands.downUnchanged.length, m = c.bands.downChanged.length;
  if (n) return `${n} untouched place${n > 1 ? "s" : ""} use${n > 1 ? "" : "s"} \`${name}\`. Do they still hold?`;
  if (m) return `${m} other change${m > 1 ? "s" : ""} follow${m > 1 ? "" : "s"} from \`${name}\`. Do they line up with it?`;
  return `What does \`${name}\` change, and could anything rely on the old behaviour?`;
}

function findPlacement(cores: GCore[], id: string) {
  for (const c of cores) for (const b of BANDS) for (const pl of c.bands[b]) if (pl.id === id) return pl;
}

/**
 * Wires each band to its neighbour so the chain reads
 * untouched↑ → changed↑ → core → changed↓ → untouched↓.
 * Static analysis decides which specific node connects where; otherwise it falls back to the first core node.
 */
type Hint = { attachNode?: string; relation?: string };

function coreEdges(c: GCore, nodes: Map<string, GNode>, a: Analysis, unitNode: Map<string, string>, hints: Map<string, Hint>): GEdge[] {
  const nodeUnit = new Map([...unitNode].map(([u, n]) => [n, u]));
  const edges: GEdge[] = [];
  const firstCore = c.bands.core[0];
  if (!firstCore) return edges;

  // Static relation between two nodes, as a label, or undefined.
  const relation = (upNode: string, downNode: string): string | undefined => {
    const up = nodes.get(upNode)!, down = nodes.get(downNode)!;
    if (up.kind === "change" && down.kind === "change") {
      const e = a.edges.find((e) => e.from === nodeUnit.get(upNode) && e.to === nodeUnit.get(downNode));
      return e && `uses \`${e.symbol}\``;
    }
    if (up.kind === "context" && down.kind === "change") {
      const r = a.refs.find((r) => r.dir === "up" && r.path === up.location.path && r.line === up.location.line && r.forUnit === nodeUnit.get(downNode));
      return r && `relies on \`${r.symbol}\``;
    }
    if (up.kind === "change" && down.kind === "context") {
      const r = a.refs.find((r) => r.dir === "down" && r.path === down.location.path && r.line === down.location.line && r.forUnit === nodeUnit.get(upNode));
      return r && `uses \`${r.symbol}\``;
    }
  };

  // Upstream: each upstream placement feeds the best-matching node on its right.
  const upTargets = (pl: GPlacement): GPlacement[] => (pl.band === "upUnchanged" ? [...c.bands.upChanged, ...c.bands.core] : c.bands.core);
  for (const pl of [...c.bands.upUnchanged, ...c.bands.upChanged]) {
    const targets = upTargets(pl);
    const hint = hints.get(pl.id);
    let hit = hint?.attachNode ? targets.find((t) => t.node === hint.attachNode) : undefined;
    hit ??= targets.find((t) => relation(pl.node, t.node));
    if (!hit && pl.band === "upUnchanged") hit = c.bands.core.find((t) => relation(pl.node, t.node));
    const to = hit ?? firstCore;
    edges.push({ core: c.id, from: pl.id, to: to.id, label: hint?.relation ?? relation(pl.node, to.node) });
  }
  // Downstream: each downstream placement hangs off the best-matching node on its left.
  const downSources = (pl: GPlacement): GPlacement[] => (pl.band === "downUnchanged" ? [...c.bands.downChanged, ...c.bands.core] : c.bands.core);
  for (const pl of [...c.bands.downChanged, ...c.bands.downUnchanged]) {
    const sources = downSources(pl);
    const hint = hints.get(pl.id);
    const hit = (hint?.attachNode ? sources.find((s) => s.node === hint.attachNode) : undefined) ?? sources.find((s) => relation(s.node, pl.node));
    const from = hit ?? firstCore;
    edges.push({ core: c.id, from: from.id, to: pl.id, label: hint?.relation ?? relation(from.node, pl.node) });
  }
  return edges;
}
