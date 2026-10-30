// The behaviour map (the Map view): Claude draws how the system behaves before and after the change, at the level of
// abstraction the change lives at: local (one function to another), module, service, the end user's or the
// infrastructure's. It's one graph whose nodes and edges are each marked same, added, removed or changed, so the view
// draws before, after and the difference from the same data, plus the behavioural changes, each pointing at the part
// of the graph it's about. Claude runs as for a review (agent.ts): in the head commit's export, read-only, with Bobby's
// tools when it has them, and what it's doing streams to the page.
import { type AgentJob, prContext, runClaude, TOOLS_NOTE } from "./agent.ts";
import type { ReviewGraph } from "./graph.ts";
import { refContext, resolveRefs } from "./refs.ts";
import type { BehaviourMap, MapChange, MapEdge, MapLevel, MapNode, MapStatus } from "./types.ts";

export const LEVELS: MapLevel[] = ["local", "module", "service", "user", "infra"];
const STATUSES: MapStatus[] = ["same", "added", "removed", "changed"];
export const KINDS = ["function", "module", "service", "actor", "screen", "store", "queue", "external", "infra"];
const MAX_NODES = 18, MAX_CHANGES = 6;

const str = { type: "string" };
const SCHEMA = {
  type: "object",
  properties: {
    level: { type: "string", enum: LEVELS },
    why: str,
    summary: str,
    nodes: { type: "array", items: { type: "object", properties: { id: str, label: str, kind: { type: "string", enum: KINDS }, status: { type: "string", enum: STATUSES }, group: str, note: str, ref: str }, required: ["id", "label", "kind", "status", "group", "note", "ref"] } },
    edges: { type: "array", items: { type: "object", properties: { from: str, to: str, label: str, status: { type: "string", enum: STATUSES }, before: str }, required: ["from", "to", "label", "status", "before"] } },
    changes: { type: "array", items: { type: "object", properties: { title: str, detail: str, nodes: { type: "array", items: str }, edges: { type: "array", items: { type: "integer" } } }, required: ["title", "detail", "nodes", "edges"] } },
  },
  required: ["level", "why", "summary", "nodes", "edges", "changes"],
};

const LEVEL_TEXT: Record<MapLevel, string> = {
  local: "local: inside a file or a few functions: one function calling another, a value passed along, a branch taken.",
  module: "module: between modules or packages of one codebase: which calls or imports which, and what passes between them.",
  service: "service: between services or processes, or the parts of one service (a handler, a worker, a database): requests, events, jobs, reads and writes.",
  user: "user: from the end user's side: who does what, on which screen or command, and what they see happen, step by step.",
  infra: "infra: how it runs: containers, jobs, queues, databases, networks, cloud resources, CI and deploys.",
};

function instructions(asked?: MapLevel, tools = false) {
  return `You are drawing a behaviour map of a pull request for a human reviewer: one diagram of how the system behaves before the change and after it, so they understand what the PR does before they read its code. Your working directory is the repository at the PR's head commit, and you have Read, Grep and Glob.

# THE LEVEL
Draw it at one level of abstraction:
${LEVELS.map((l) => `- ${LEVEL_TEXT[l]}`).join("\n")}
${asked ? `The reviewer asked for the ${asked} level: draw it at that level, and say in why what it shows at that level.` : `Pick the level at which the PR's change in behaviour shows and matters, and no higher: a fix inside a function is local; a new call between packages is module; a changed endpoint, event or job is service (or user, when what users see changes); a new queue or deploy step is infra. Say why in one sentence.`}

# THE GRAPH
One graph, with each node and edge marked:
- same: there before and after, unchanged. Include only the unchanged parts needed to follow the change: who triggers it, what it calls, where its data goes.
- added: the PR adds it.
- removed: the PR removes it.
- changed: there before and after, but it behaves differently. For an edge, label is what it does now and before what it did; for a node, note says what changed.
Before is same + removed + changed; after is same + added + changed. Both must read as a story on their own.

Nodes, 4 to 14: id (short, kebab-case), label (what it is: a function's or module's name, a service, "Customer", "Checkout page", "orders table"), kind, status, group (the boundary it's in, when that helps: a service, a package, a cluster; else ""), note (at most 12 words, else ""), ref (where it's defined, as path#L12, or path#base-L12 for removed code; "" for people and outside systems).
Edges: from and to (node ids), label (a short verb phrase: "POST /charges", "retries ×3", "reads balance", "clicks Pay"), status, before ("" unless changed). An edge is an interaction: a call, a request, an event, a read or a write, a user's action. Point it the way control or data flows.

# THE CHANGES
changes: the behavioural changes, 1 to ${MAX_CHANGES}, the most important first. Each: title (at most 10 words: what now behaves differently, "Failed charges retry three times before failing"), detail (two to four sentences: what happened before, what happens now, and what it means for a caller or a user; cite the code as Markdown links, [what it is](path/to/file.ts#L12), or path/to/file.ts#base-L12 for the code before the PR, only lines you've read), nodes (the ids it involves) and edges (their indexes in edges, from 0).
summary: one sentence: the change in behaviour, as a reviewer would say it.

# HOW TO WORK
Read the diff, then the code around it${tools ? " (read_file with side: base for what it did before; references for who calls it)" : ""}: who calls the changed code, what it calls, what it reads and writes, and what it did before. Use as many tool calls as the PR needs (usually 5 to 25). Don't map code the PR doesn't touch or depend on, and don't invent parts you haven't seen in the code.`;
}

/** The prompt: what to draw, then the PR. */
export function buildMapPrompt(g: ReviewGraph, asked?: MapLevel, tools = false): string {
  return [instructions(asked, tools), ...(tools ? ["", TOOLS_NOTE] : []), "", prContext(g, tools)].join("\n");
}

type Raw = { level: string; why: string; summary: string; nodes: Array<Record<string, unknown>>; edges: Array<Record<string, unknown>>; changes: Array<Record<string, unknown>> };
const text = (v: unknown, max = 400) => (typeof v === "string" ? v.trim().slice(0, max) : "");
const status = (v: unknown): MapStatus => (STATUSES.includes(v as MapStatus) ? (v as MapStatus) : "same");

/** Claude's answer, made safe to draw: known statuses and kinds, unique ids, edges between nodes that exist, changes
 *  pointing at what's left. Its code references are resolved to real lines (refs.ts) or dropped. */
export function normalize(raw: Raw, asked?: MapLevel): Omit<BehaviourMap, "headSha" | "at"> {
  const nodes: MapNode[] = [], ids = new Set<string>();
  for (const n of raw.nodes ?? []) {
    const id = text(n.id, 60);
    if (!id || ids.has(id) || nodes.length >= MAX_NODES) continue;
    ids.add(id);
    const group = text(n.group, 60), note = text(n.note, 160), ref = text(n.ref, 300);
    nodes.push({ id, label: text(n.label, 80) || id, kind: KINDS.includes(n.kind as string) ? (n.kind as string) : "module", status: status(n.status),
      ...(group ? { group } : {}), ...(note ? { note } : {}), ...(ref ? { ref } : {}) });
  }
  const index = new Map<number, number>(), edges: MapEdge[] = []; // Claude's edge indexes → ours
  (raw.edges ?? []).forEach((e, i) => {
    const from = text(e.from, 60), to = text(e.to, 60);
    if (!ids.has(from) || !ids.has(to)) return;
    const st = status(e.status), before = st === "changed" ? text(e.before, 80) : "";
    index.set(i, edges.length);
    edges.push({ from, to, label: text(e.label, 80), status: st, ...(before ? { before } : {}) });
  });
  const changes: MapChange[] = (raw.changes ?? []).slice(0, MAX_CHANGES).map((c) => ({
    title: text(c.title, 120), detail: text(c.detail, 1500),
    nodes: (Array.isArray(c.nodes) ? c.nodes : []).map((x) => text(x, 60)).filter((x) => ids.has(x)),
    edges: (Array.isArray(c.edges) ? c.edges : []).map((x) => index.get(Number(x))).filter((x): x is number => x !== undefined),
  })).filter((c) => c.title);
  const level = LEVELS.includes(raw.level as MapLevel) ? (raw.level as MapLevel) : asked ?? "module";
  return { level, ...(asked ? { asked } : {}), why: text(raw.why, 400), summary: text(raw.summary, 400), nodes, edges, changes };
}

/** Draws the map; job says how it's going, and the map is handed to done. */
export async function runMap(cwd: string, g: ReviewGraph, job: AgentJob, done: (m: BehaviourMap) => void, asked?: MapLevel, tools?: string): Promise<void> {
  try {
    const result = await runClaude(cwd, g, job, buildMapPrompt(g, asked, !!tools), { schema: SCHEMA, ...(tools ? { tools } : {}), minutes: 15 });
    const m = normalize(result.structured_output as Raw, asked), refs = refContext(cwd, g);
    for (const c of m.changes) c.detail = await resolveRefs(c.detail, refs);
    for (const n of m.nodes) { // a node's code: the target of its reference, once it's checked, else none
      if (!n.ref) continue;
      const to = /\]\((ref:\/\/[^)]+)\)/.exec(await resolveRefs(`[x](${n.ref.replace(/^\[.*\]\((.*)\)$/, "$1")})`, refs))?.[1];
      if (to) n.ref = to; else delete n.ref;
    }
    done({ headSha: g.pr.headSha, at: new Date().toISOString(), ...m, ...(result.total_cost_usd ? { cost: result.total_cost_usd } : {}) });
    job.steps.push(`Done: ${m.nodes.length} parts, ${m.changes.length} change${m.changes.length === 1 ? "" : "s"}`);
  } catch (e) {
    job.error ??= (e as Error).message;
  } finally {
    job.done = true;
  }
}
