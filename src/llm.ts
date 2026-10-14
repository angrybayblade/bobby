import { tmpdir } from "node:os";
import { run } from "./git.ts";
import { emptyBands, finalize, refNode, type Analysis } from "./analyze.ts";
import type { ChangeTree, Core, FileDiff, PrInfo, TreeNode } from "./types.ts";

const unitEdge = {
  type: "object",
  properties: {
    unit: { type: "string" }, label: { type: "string" }, why: { type: "string" },
    attachTo: { type: "string" }, relation: { type: "string" },
  },
  required: ["unit", "label", "why", "attachTo", "relation"],
};
const refEdge = {
  type: "object",
  properties: {
    ref: { type: "string" }, label: { type: "string" }, why: { type: "string" },
    risk: { type: "string", enum: ["high", "med", "low"] }, attachTo: { type: "string" }, relation: { type: "string" },
  },
  required: ["ref", "label", "why", "risk", "attachTo", "relation"],
};
const SCHEMA = {
  type: "object",
  properties: {
    intent: { type: "string" },
    cores: {
      type: "array",
      items: {
        type: "object",
        properties: {
          title: { type: "string" },
          summary: { type: "string" },
          hook: { type: "string" },
          coreUnits: { type: "array", items: unitEdge },
          upstreamUnchanged: { type: "array", items: refEdge },
          upstreamChanged: { type: "array", items: unitEdge },
          downstreamChanged: { type: "array", items: unitEdge },
          downstreamUnchanged: { type: "array", items: refEdge },
        },
        required: ["title", "summary", "hook", "coreUnits", "upstreamUnchanged", "upstreamChanged", "downstreamChanged", "downstreamUnchanged"],
      },
    },
  },
  required: ["intent", "cores"],
};

const INSTRUCTIONS = `You are organising a pull request for a reviewer with ADHD who reviews one focused page at a time.

Build a forest of CORE CHANGES. Each core is one cohesive idea (one or more units that change together). Around each core, place related code in four bands; the reviewer walks them in this order:

  1. upstreamUnchanged   – existing, untouched code the core relies on (ref ids). Only include what is needed to understand the core.
  2. upstreamChanged     – other changed units the core depends on or reacts to (unit ids).
  3. coreUnits           – the core change itself (unit ids).
  4. downstreamChanged   – other changed units that exist because of / are affected by the core (unit ids).
  5. downstreamUnchanged – untouched code affected by the core (ref ids). This is where bugs hide: pick callers whose behaviour could change, mark risk "high" when they likely break or silently change behaviour.

Rules:
- Every unit must appear in exactly one core's coreUnits, upstreamChanged or downstreamChanged lists. A unit may be repeated in another core's bands only if the link genuinely matters there (it will be shown as "already seen").
- Order cores so foundational changes come first and the reviewer never meets something before what it depends on.
- Prefer fewer, meaningful cores (typically 1–7) over one core per unit; tests belong downstream of what they test.
- At most 4 upstreamUnchanged and 6 downstreamUnchanged per core. Drop irrelevant refs.
- "why" is one short, concrete sentence about the relationship ("now awaits validateToken", "still passes a string id"). No filler.
- attachTo: the unit id this item connects to, one step closer to the core. Upstream items attach to what consumes them; downstream items attach to what they consume. An upstreamUnchanged ref may attach to an upstreamChanged unit; a downstreamUnchanged ref may attach to a downstreamChanged unit (e.g. an untouched helper used by a changed test). Otherwise attach to one of this core's coreUnits. For coreUnits use "".
- relation: 1–4 words naming the edge from the upstream side to the downstream side, e.g. "now awaits", "type widened", "tests", "default read by". For coreUnits use "".
- label (refs): the function/type at that location, e.g. "normalizeRetryOptions()".
- label (units): what this unit changes, as a short code-ish name (e.g. "retryMethods default", "ky.query() type"); don't just repeat the file name.
- title: 2–6 words. summary: one sentence. intent: one sentence describing what the whole PR does.
- hook: one short question (at most ~14 words) that gives the reviewer something specific to look for in this core, grounded in the code and usually about what could break, e.g. "Can retry() now loop forever when limit is 0?" or "Do untouched callers still pass a string id?". Not a summary, and no filler like "Let's look at…".
- Use only the ids given below, and only in the id fields. Never mention ids like "u3" or "r12" in labels, why, title, summary or intent; name the code instead.`;

export async function claudeTree(pr: PrInfo, a: Analysis, files: FileDiff[]): Promise<ChangeTree> {
  const prompt = buildPrompt(pr, a);
  const cmd = ["claude", "-p", "--output-format", "json", "--tools", "", "--no-session-persistence", "--json-schema", JSON.stringify(SCHEMA)];
  const model = process.env.BOBBY_MODEL ?? process.env.PRFOCUS_MODEL; // PRFOCUS_MODEL: the old name
  if (model) cmd.push("--model", model);
  const out = JSON.parse(await run(cmd, { cwd: tmpdir(), input: prompt, timeoutMs: 15 * 60_000 })); // a stuck claude mustn't leave the review "organising" forever
  if (out.is_error || !out.structured_output) throw new Error(`claude returned no structured output: ${String(out.result).slice(0, 300)}`);
  return toTree(out.structured_output, a, files);
}

function buildPrompt(pr: PrInfo, a: Analysis): string {
  let budget = 160_000;
  const parts = [INSTRUCTIONS, "", `# PR #${pr.number}: ${pr.title}`, pr.body.slice(0, 3000), "", "# UNITS (changed code)"];
  for (const u of a.units) {
    parts.push(`## ${u.id} — ${u.file} — symbols: ${u.symbols.join(", ")}`);
    for (const hid of u.hunkIds) {
      const h = a.hunkById.get(hid)!;
      const body = h.lines.slice(0, 120).map((l) => l.t + l.s).join("\n");
      if (budget > 0) { parts.push(h.header, body); budget -= body.length; }
      else parts.push(`${h.header} (${h.lines.length} lines, omitted for size)`);
    }
  }
  parts.push("", "# STATIC EDGES (upstream unit -> downstream unit; may be incomplete)");
  for (const e of a.edges) parts.push(`${e.from} -> ${e.to} via ${e.symbol}`);
  parts.push("", "# UNCHANGED CODE REFS");
  let shown = 0;
  for (const r of a.refs) {
    if (budget <= 0) break; // the same budget as the code: a huge reference list can't blow up the prompt
    const line = `${r.id} [${r.dir === "up" ? "definition used by" : "usage of symbol from"} ${r.forUnit}] ${r.path}:${r.line} \`${r.symbol}\`: ${r.text.slice(0, 160)}`;
    parts.push(line); budget -= line.length; shown++;
  }
  if (shown < a.refs.length) parts.push(`(${a.refs.length - shown} more refs omitted for size)`);
  return parts.join("\n");
}

interface UnitEdge { unit: string; label?: string; why: string; attachTo?: string; relation?: string }
interface RefEdge { ref: string; label?: string; why: string; risk: TreeNode["risk"]; attachTo?: string; relation?: string }
const link = (e: { attachTo?: string; relation?: string }) => ({ attachTo: e.attachTo || undefined, relation: e.relation || undefined });

interface Raw {
  intent: string;
  cores: Array<{
    title: string; summary: string; hook?: string;
    coreUnits: Array<UnitEdge>;
    upstreamChanged: Array<UnitEdge>;
    downstreamChanged: Array<UnitEdge>;
    upstreamUnchanged: Array<RefEdge>;
    downstreamUnchanged: Array<RefEdge>;
  }>;
}

function toTree(raw: Raw, a: Analysis, files: FileDiff[]): ChangeTree {
  const units = new Map(a.units.map((u) => [u.id, u]));
  const refs = new Map(a.refs.map((r) => [r.id, r]));
  // Belt and braces: swap any leaked internal ids in prose for the code they refer to.
  const names = new Map<string, string>([...a.units.map((u) => [u.id, u.symbols[0]] as const), ...a.refs.map((r) => [r.id, r.symbol] as const)]);
  const scrub = (text: string) => text.replace(/\b[ur]\d+\b/g, (id) => (names.has(id) ? `\`${names.get(id)}\`` : id));
  raw = JSON.parse(JSON.stringify(raw), (k, v) => (typeof v === "string" && ["why", "title", "summary", "intent", "label", "hook"].includes(k) ? scrub(v) : v));
  const cores: Core[] = [];
  for (const rc of raw.cores) {
    const bands = emptyBands();
    const unitNodes = (list: UnitEdge[], band: "core" | "upChanged" | "downChanged") => {
      for (const e of list ?? []) {
        const u = units.get(e.unit);
        if (u) bands[band].push({ id: "", band, title: e.label?.trim() || u.symbols[0], why: e.why, unitIds: [u.id], ...link(e) });
      }
    };
    unitNodes(rc.coreUnits, "core");
    if (!bands.core.length) continue;
    unitNodes(rc.upstreamChanged, "upChanged");
    unitNodes(rc.downstreamChanged, "downChanged");
    for (const e of rc.upstreamUnchanged ?? []) { const r = refs.get(e.ref); if (r) bands.upUnchanged.push({ ...refNode(r, "upUnchanged", e.why, e.risk, e.label), ...link(e) }); }
    for (const e of rc.downstreamUnchanged ?? []) { const r = refs.get(e.ref); if (r) bands.downUnchanged.push({ ...refNode(r, "downUnchanged", e.why, e.risk, e.label), ...link(e) }); }
    cores.push({ id: "", title: rc.title, summary: rc.summary, hook: rc.hook?.trim() || undefined, bands });
  }
  return finalize({ source: "claude", intent: raw.intent, cores, noiseHunkIds: [] }, a, files);
}
