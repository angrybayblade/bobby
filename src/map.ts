// The behaviour map (the Map view): Claude scopes the change (what it changes, what that affects), then draws it at the
// layers of abstraction this PR is best understood at, which it defines for the PR: an overview in plain words, then
// each layer opening up the part of the one above where the change is, down to functions and data where that helps.
// Each layer is one graph whose nodes and edges are marked same, added, removed or changed, so the view draws it
// before and after from the same data. Claude runs as
// for a review (agent.ts): in the head commit's export, read-only, with Bobby's tools when it has them, and what it's
// doing streams to the page.
import { type AgentJob, prContext, runClaude, TOOLS_NOTE } from "./agent.ts";
import type { ReviewGraph } from "./graph.ts";
import { refContext, resolveRefs } from "./refs.ts";
import type { BehaviourMap, MapEdge, MapLayer, MapNode, MapStatus } from "./types.ts";

const STATUSES: MapStatus[] = ["same", "added", "removed", "changed"];
export const KINDS = ["step", "outcome", "actor", "function", "module", "service", "screen", "store", "queue", "external", "infra"];
const MAX_LAYERS = 4, MAX_NODES = 14, MAX_POINTS = 3;

const str = { type: "string" }, strs = { type: "array", items: str };
const NODE = { type: "object", properties: { id: str, label: str, kind: { type: "string", enum: KINDS }, status: { type: "string", enum: STATUSES }, group: str, note: str, points: strs, before: strs, ref: str }, required: ["id", "label", "kind", "status", "group", "note", "points", "before", "ref"] };
const EDGE = { type: "object", properties: { from: str, to: str, label: str, status: { type: "string", enum: STATUSES }, before: str }, required: ["from", "to", "label", "status", "before"] };
const SCHEMA = {
  type: "object",
  properties: {
    scope: str,
    effect: str,
    summary: str,
    layers: { type: "array", items: { type: "object", properties: { name: str, about: str, nodes: { type: "array", items: NODE }, edges: { type: "array", items: EDGE } }, required: ["name", "about", "nodes", "edges"] } },
  },
  required: ["scope", "effect", "summary", "layers"],
};

function instructions(tools = false) {
  return `You are drawing a behaviour map of a pull request for a human reviewer: diagrams of how the system behaves before the change and after it, so they understand what the PR does before they read its code. Your working directory is the repository at the PR's head commit, and you have Read, Grep and Glob.

# SCOPE IT FIRST
Read the code until you can say, in plain words:
- scope: what the PR changes, in one sentence of at most 25 words ("where the org rate limit runs, and how it counts requests").
- effect: who or what behaves differently because of it, and how far that reaches (callers, users, other services, stored data, operations), in at most 25 words ("every org API request; clients that burst across a minute boundary now get 429s").
Find this out from the code: who calls what changed, what it calls, what it did before. Don't guess from names.

# THE LAYERS
Then choose the layers of abstraction this PR is best understood at, from the highest down, 1 to ${MAX_LAYERS}. They're yours to define for this PR: a layer is a level of detail, not a fixed category. For instance: the path a request takes, then the steps inside one middleware, then the data it keeps; or a user's way through some screens, then the calls behind one of them; or a deploy pipeline, then one job's steps. Only as many as the change needs: a small fix may need one; a change that reaches across a system, three or four.
- The first layer is the overview: the change in its simplest form, readable by someone who doesn't know this code. 3 to 8 nodes, named in plain words ("request", "auth", "early rate limit", "route limiter", "handler"), not identifiers. Leave out everything that isn't needed to see what changes.
- Each next layer opens up the part of the layer above where the change is, in more detail, down to functions, data and their names in the code where that helps.
- A layer: name (2 to 4 words: "Request path", "Inside the limiter"), about (one sentence: what this layer shows), nodes and edges.

# A LAYER'S DIAGRAM
One graph, its nodes and edges each marked:
- same: there before and after, unchanged. Only what's needed to follow the change.
- added: the PR adds it.
- removed: the PR removes it.
- changed: there before and after, but it behaves differently.
Before is same + removed + changed; after is same + added + changed. Each must read on its own as the story of what happens, in the order it happens.
Nodes, 3 to ${MAX_NODES} per layer:
- id: short, kebab-case, unique across the whole map (the same part on two layers gets two ids).
- label: what it is; 1 to 4 plain words on the overview.
- kind: step (a stage something passes through), outcome (where it ends, such as "429 + Retry-After" or "404 / 400", often an early answer), actor (a person or client), function, module, service, screen, store, queue, external (an outside system) or infra.
- group: the boundary it's in when that helps on a detailed layer (a service, a package), else "".
- note: at most 15 words, why it's there or what it does, shown when the reviewer points at it; else "".
- points: 0 to ${MAX_POINTS} short lines for the cases inside it, at most 8 words each ("routed: pass through", "unrouted: count under default").
- before: for a changed node whose points differ, its points before the PR; else [].
- ref: where it's defined on a detailed layer, as path#L12, or path#base-L12 for removed code; "" on the overview and for people and outside systems.
Edges: from and to (ids on the same layer), label (a short verb phrase, "POST /charges", "retries ×3"; usually "" on the overview, where an arrow between steps says enough), status, before (what a changed edge's label was; else ""). Point each the way control or data flows.

# THE SUMMARY
summary: one sentence, the change in behaviour as a reviewer would say it.

# HOW TO WORK
Read the diff, then the code around it${tools ? " (read_file with side: base for what it did before; references for who calls it)" : ""}. Use as many tool calls as the PR needs (usually 5 to 25). Don't draw code the PR doesn't touch or depend on, and don't invent parts you haven't seen in the code.`;
}

/** The prompt: what to draw, then the PR. */
export function buildMapPrompt(g: ReviewGraph, tools = false): string {
  return [instructions(tools), ...(tools ? ["", TOOLS_NOTE] : []), "", prContext(g, tools)].join("\n");
}

type Raw = Record<string, unknown> & { layers?: Array<Record<string, unknown>> };
const text = (v: unknown, max = 400) => (typeof v === "string" ? v.trim().slice(0, max) : "");
const list = (v: unknown, max = MAX_POINTS) => (Array.isArray(v) ? v.map((x) => text(x, 100)).filter(Boolean).slice(0, max) : []);
const status = (v: unknown): MapStatus => (STATUSES.includes(v as MapStatus) ? (v as MapStatus) : "same");

/** Claude's answer, made safe to draw: known statuses and kinds, ids unique across the map, edges between nodes on
 *  their layer. Its code references are resolved to real lines (refs.ts) or dropped. */
export function normalize(raw: Raw): Omit<BehaviourMap, "headSha" | "at"> {
  const ids = new Set<string>(), layers: MapLayer[] = [];
  for (const l of (Array.isArray(raw.layers) ? raw.layers : []).slice(0, MAX_LAYERS)) {
    const nodes: MapNode[] = [], mine = new Set<string>();
    for (const n of (Array.isArray(l.nodes) ? l.nodes : []) as Array<Record<string, unknown>>) {
      const id = text(n.id, 60);
      if (!id || ids.has(id) || nodes.length >= MAX_NODES) continue;
      ids.add(id); mine.add(id);
      const st = status(n.status), group = text(n.group, 60), note = text(n.note, 160), ref = text(n.ref, 300), points = list(n.points), before = st === "changed" ? list(n.before) : [];
      nodes.push({ id, label: text(n.label, 80) || id, kind: KINDS.includes(n.kind as string) ? (n.kind as string) : "step", status: st,
        ...(group ? { group } : {}), ...(note ? { note } : {}), ...(points.length ? { points } : {}), ...(before.length && before.join() !== points.join() ? { before } : {}), ...(ref ? { ref } : {}) });
    }
    if (!nodes.length) continue;
    const edges: MapEdge[] = [];
    for (const e of (Array.isArray(l.edges) ? l.edges : []) as Array<Record<string, unknown>>) {
      const from = text(e.from, 60), to = text(e.to, 60);
      if (!mine.has(from) || !mine.has(to)) continue;
      const st = status(e.status), before = st === "changed" ? text(e.before, 80) : "";
      edges.push({ from, to, label: text(e.label, 80), status: st, ...(before ? { before } : {}) });
    }
    layers.push({ name: text(l.name, 40) || `Layer ${layers.length + 1}`, about: text(l.about, 240), nodes, edges });
  }
  return { summary: text(raw.summary, 400), scope: text(raw.scope, 300), effect: text(raw.effect, 400), layers };
}

/** Draws the map; job says how it's going, and the map is handed to done. */
export async function runMap(cwd: string, g: ReviewGraph, job: AgentJob, done: (m: BehaviourMap) => void, tools?: string): Promise<void> {
  try {
    const result = await runClaude(cwd, g, job, buildMapPrompt(g, !!tools), { schema: SCHEMA, ...(tools ? { tools } : {}), minutes: 15 });
    const m = normalize(result.structured_output as Raw), refs = refContext(cwd, g);
    if (!m.layers.length) throw new Error("Claude drew nothing to show");
    for (const n of m.layers.flatMap((l) => l.nodes)) { // a node's code: the target of its reference, once it's checked, else none
      if (!n.ref) continue;
      const to = /\]\((ref:\/\/[^)]+)\)/.exec(await resolveRefs(`[x](${n.ref.replace(/^\[.*\]\((.*)\)$/, "$1")})`, refs))?.[1];
      if (to) n.ref = to; else delete n.ref;
    }
    done({ headSha: g.pr.headSha, at: new Date().toISOString(), ...m, ...(result.total_cost_usd ? { cost: result.total_cost_usd } : {}) });
    const parts = m.layers.reduce((s, l) => s + l.nodes.length, 0);
    job.steps.push(`Done: ${m.layers.length} layer${m.layers.length === 1 ? "" : "s"}, ${parts} parts`);
  } catch (e) {
    job.error ??= (e as Error).message;
  } finally {
    job.done = true;
  }
}
