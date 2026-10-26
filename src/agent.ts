// Agent-assisted review (a first cut, on Claude Code): Claude reads the PR's diff and, with read-only file tools, the
// code around it at the head commit, and reports findings on the diff's lines. They show in place as suggestions;
// nothing is posted: each one is added to your drafts, or dismissed, by you. Claude runs in an export of the head
// commit (trees/<repo>/<sha>-src) with only Read, Grep and Glob, none of your settings, MCP servers or session, and
// Claude Code doesn't let it read outside that folder. What it's doing streams to the page as it goes.
import { existsSync, mkdirSync, renameSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import type { Subprocess } from "bun";
import { claudeBin, claudeStatus } from "./claude.ts";
import type { ReviewGraph } from "./graph.ts";
import { keepTree } from "./langserver.ts";
import { home } from "./state.ts";

import { refContext, refsForGitHub, resolveRefs } from "./refs.ts";
import type { AgentReview, Finding } from "./types.ts";

/** The review running now, in memory. */
export interface AgentJob { proc?: Subprocess<"pipe", "pipe", "pipe">; steps: string[]; startedAt: number; focus?: string; error?: string; done?: boolean }

const SCHEMA = {
  type: "object",
  properties: {
    summary: { type: "string" },
    findings: {
      type: "array",
      items: {
        type: "object",
        properties: {
          path: { type: "string" },
          side: { type: "string", enum: ["RIGHT", "LEFT"] },
          line: { type: "integer" },
          startLine: { type: "integer" },
          severity: { type: "string", enum: ["bug", "risk", "question", "nit"] },
          title: { type: "string" },
          body: { type: "string" },
        },
        required: ["path", "side", "line", "startLine", "severity", "title", "body"],
      },
    },
  },
  required: ["summary", "findings"],
};

const INSTRUCTIONS = `You are helping a human review a pull request. They decide what to post: each of your findings is shown on its line, and they add it to their review or dismiss it. Your working directory is the repository at the PR's head commit, and you have Read, Grep and Glob.

Investigate before you report; the diff alone hides most bugs. Work like this:
1. Read the diff below and pick out what changed in behaviour: signatures, defaults, return values, error handling, what's read or written, and in what order.
2. For each of those, Grep for its callers and other uses outside the diff, and Read the ones that could break. Read the definitions of what the changed code calls when its behaviour matters.
3. Check the tests touched or missing for what changed.
Use as many tool calls as the PR needs (usually 10 to 40); stop when you've checked what matters.

Report only what a careful senior reviewer would raise:
- bug: it's wrong: a broken caller, a missed case, an off-by-one, a race, lost data, a security hole, an API misused.
- risk: it may well break something, or does something surprising that deserves a second look.
- question: the intent isn't clear and the answer matters.
- nit: small, but worth it (a misleading name, a leftover). At most a few.
Don't praise, don't summarise what the code does, don't comment on style or formatting, and don't report what you haven't checked. Fewer, solid findings beat many weak ones: at most 12. None is a fine answer.

Each finding:
- path, side, line: where it goes, on a line of the diff below. Lines are numbered R<n> (the new file: added and unchanged lines) and L<n> (the old file: removed lines). Use side RIGHT with an R number, or LEFT with an L number. Pick the line the problem is on; if it's caused by code outside the diff, anchor it on the changed line that's affected and name the other place in the body.
- startLine: the first line, when the finding covers several lines (same side); otherwise 0.
- title: at most 10 words, stating the problem ("avg([]) returns NaN").
- body: a review comment to the PR's author, in Markdown: what's wrong, why (cite the code you checked), and what to do. Two to five sentences. A \`\`\`suggestion block only when it replaces exactly the lines from startLine (or line) to line.
summary: one or two sentences: your overall read of the PR, for the reviewer.

Cite code as Markdown links with its path from the repository's root: [what it is](path/to/file.ts#L12), or a range [what it is](path/to/file.ts#L12-L20); for the code as it was before the PR, path/to/file.ts#base-L12. Cite only lines you've read, so each link opens the right code.`;

const PER_HUNK = 400, BUDGET = 200_000;

function buildPrompt(g: ReviewGraph, focus?: string): string {
  const parts = [INSTRUCTIONS, ...(focus ? ["", "# WHAT THE REVIEWER ASKED YOU TO FOCUS ON", focus, "Spend your investigation on this first, and say in the summary what you found about it. Still report a serious bug you come across elsewhere."] : []), "", `# PR: ${g.pr.title}`, g.pr.body.slice(0, 4000), "", `What it does: ${g.intent}`];
  if (g.generator.tree === "claude" && g.cores.length) parts.push("", "Its parts:", ...g.cores.map((c) => `- ${c.title}: ${c.summary}`));
  parts.push("", "# THE DIFF");
  let budget = BUDGET;
  const low = new Set(g.lowSignal);
  for (const f of g.files) {
    const hunks = g.hunks.filter((h) => h.file === f.path);
    parts.push("", `## ${f.path} (${f.status}${f.oldPath && f.oldPath !== f.path ? ` from ${f.oldPath}` : ""})`);
    if (f.binary) { parts.push("(binary)"); continue; }
    if (f.lowSignal) { parts.push(`(left out: ${f.lowSignal})`); continue; }
    for (const h of hunks) {
      if (low.has(h.id) || h.lowSignal) { parts.push(`${h.header} (left out: ${h.lowSignal ?? "low signal"})`); continue; }
      if (budget <= 0) { parts.push(`${h.header} (${h.lines.length} lines, left out for size: Read the file)`); continue; }
      const text = h.lines.slice(0, PER_HUNK).map((l) => `${l.t === "-" ? `L${l.o}` : `R${l.n}`}\t${l.t}${l.s}`).join("\n");
      parts.push(h.header, text, ...(h.lines.length > PER_HUNK ? [`(${h.lines.length - PER_HUNK} more lines: Read the file)`] : []));
      budget -= text.length;
    }
  }
  return parts.join("\n");
}

/** The whole head commit, exported once per commit for Claude to read (beside the language servers' partial trees). */
async function sourceTree(cwd: string, g: ReviewGraph, step: (m: string) => void): Promise<string> {
  const dir = join(home(), "trees", `${g.pr.owner}_${g.pr.repo}`, `${g.pr.headSha.slice(0, 12)}-src`), done = join(dir, ".bobby-tree");
  if (existsSync(done)) { keepTree(dir); return dir; }
  step("Exporting the code at the PR's head");
  const tmp = `${dir}.${process.pid}.tmp`;
  rmSync(tmp, { recursive: true, force: true });
  mkdirSync(tmp, { recursive: true });
  const archive = Bun.spawn(["git", "archive", "--format=tar", g.pr.headSha], { cwd, stdout: "pipe", stderr: "pipe" });
  const tar = Bun.spawn(["tar", "-x", "-C", tmp], { stdin: archive.stdout, stderr: "pipe" });
  if ((await archive.exited) !== 0 || (await tar.exited) !== 0) {
    rmSync(tmp, { recursive: true, force: true });
    throw new Error(`couldn't export ${g.pr.headSha.slice(0, 7)}: ${(await new Response(archive.stderr).text()).trim()}`);
  }
  writeFileSync(join(tmp, ".bobby-tree"), "src");
  try { renameSync(tmp, dir); } catch { rmSync(tmp, { recursive: true, force: true }); } // another Bobby got there first
  return dir;
}

/** What a tool call is doing, in a few words. */
function describe(name: string, input: Record<string, unknown>, root: string): string {
  const rel = (p: unknown) => String(p ?? "").replace(`${root}/`, "").replace(root, ".");
  if (name === "Read") return `Reading ${rel(input.file_path)}`;
  if (name === "Grep") return `Searching for ${JSON.stringify(String(input.pattern ?? ""))}${input.path && rel(input.path) !== "." ? ` in ${rel(input.path)}` : ""}`;
  if (name === "Glob") return `Looking for ${String(input.pattern ?? "")}`;
  if (name === "StructuredOutput") return "Writing up its findings";
  return name;
}

type Raw = { summary: string; findings: Array<Omit<Finding, "id" | "status">> };
interface Event {
  type?: string;
  message?: { content?: Array<{ type: string; name?: string; input?: Record<string, unknown> }> };
  event?: { type?: string; delta?: { type?: string; text?: string } }; // a stream_event's, with partial messages
  structured_output?: unknown; result?: string; total_cost_usd?: number; // the result's
}

/** Runs Claude Code on a prompt, in the head commit's export with only Read, Grep and Glob, and nothing of your own
 *  setup (settings, MCP servers, sessions). job.steps says what it's doing; onText gets its answer as it's written.
 *  The result: its structured output (with a schema), else its text. */
export async function runClaude(cwd: string, g: ReviewGraph, job: AgentJob, prompt: string, o: { schema?: object; onText?: (text: string) => void; minutes?: number } = {}): Promise<Event> {
  const step = (m: string) => { job.steps.push(m); if (job.steps.length > 200) job.steps.splice(0, 100); };
  const st = await claudeStatus();
  if (!st.installed || !st.loggedIn) throw new Error(st.installed ? "Claude Code isn't signed in" : "Claude Code isn't installed");
  const root = await sourceTree(cwd, g, step);
  step("Reading the diff");
  const cmd = [claudeBin() ?? "claude", "-p", "--output-format", "stream-json", "--verbose", "--tools", "Read,Grep,Glob", "--no-session-persistence",
    "--strict-mcp-config", "--setting-sources", "", "--disable-slash-commands", ...(o.schema ? ["--json-schema", JSON.stringify(o.schema)] : []), ...(o.onText ? ["--include-partial-messages"] : [])];
  const model = process.env.BOBBY_REVIEW_MODEL ?? process.env.BOBBY_MODEL;
  if (model) cmd.push("--model", model);
  const p = Bun.spawn(cmd, { cwd: root, stdin: "pipe", stdout: "pipe", stderr: "pipe" });
  job.proc = p;
  p.stdin.write(prompt);
  p.stdin.end();
  const minutes = o.minutes ?? 20;
  const kill = setTimeout(() => { job.error = `Claude took over ${minutes} minutes; stopped`; p.kill(); }, minutes * 60_000);
  let result: Event | null = null, text = "", buf = "";
  const dec = new TextDecoder();
  try {
    for await (const chunk of p.stdout) {
      buf += dec.decode(chunk);
      let nl;
      while ((nl = buf.indexOf("\n")) >= 0) {
        const line = buf.slice(0, nl); buf = buf.slice(nl + 1);
        let e: Event;
        try { e = JSON.parse(line); } catch { continue; }
        if (e.type === "assistant") {
          for (const c of e.message?.content ?? []) {
            if (c.type === "tool_use") step(describe(c.name ?? "", c.input ?? {}, root));
            else if (c.type === "thinking" && job.steps.at(-1) !== "Thinking") step("Thinking");
          }
          text = ""; // a message ends: the answer is the last one's text
        }
        if (e.type === "stream_event" && e.event?.type === "message_start") text = "";
        if (e.type === "stream_event" && e.event?.delta?.type === "text_delta") { text += e.event.delta.text ?? ""; o.onText?.(text); }
        if (e.type === "result") result = e;
      }
    }
  } finally { clearTimeout(kill); job.proc = undefined; }
  const code = await p.exited;
  if (job.error) throw new Error(job.error);
  if (!result || (o.schema ? !result.structured_output : !result.result)) throw new Error(result?.result?.slice(0, 300) || (await new Response(p.stderr).text()).trim().split("\n").at(-1) || `claude exited ${code}`);
  return result;
}

/** Runs the review; job says how it's going, and the result is handed to done. */
export async function runAgentReview(cwd: string, g: ReviewGraph, job: AgentJob, done: (r: AgentReview) => void, focus?: string): Promise<void> {
  try {
    const result = await runClaude(cwd, g, job, buildPrompt(g, focus), { schema: SCHEMA });
    const r = place(g, result.structured_output as Raw), refs = refContext(cwd, g);
    r.summary = await resolveRefs(r.summary, refs);
    for (const f of r.findings) f.body = await resolveRefs(f.body, refs);
    done({ headSha: g.pr.headSha, at: new Date().toISOString(), ...r, ...(focus ? { focus } : {}), ...(result.total_cost_usd ? { cost: result.total_cost_usd } : {}) });
    job.steps.push(`Done: ${r.findings.length} finding${r.findings.length === 1 ? "" : "s"}`);
  } catch (e) {
    job.error ??= (e as Error).message;
  } finally {
    job.done = true;
  }
}

/** Puts each finding on a line of the diff: as given if it's there, else the nearest line on that side of its file.
 *  One on a file the diff doesn't have is left out (counted in left). */
export function place(g: ReviewGraph, raw: Raw): { summary: string; findings: Finding[]; left: number } {
  const lines = new Map<string, number[]>(); // path|side → its diff lines
  for (const h of g.hunks) for (const l of h.lines) {
    if (l.n != null && l.t !== "-") (lines.get(`${h.file}|RIGHT`) ?? lines.set(`${h.file}|RIGHT`, []).get(`${h.file}|RIGHT`)!).push(l.n);
    if (l.o != null && l.t === "-") (lines.get(`${h.file}|LEFT`) ?? lines.set(`${h.file}|LEFT`, []).get(`${h.file}|LEFT`)!).push(l.o);
  }
  const nearest = (list: number[], n: number) => list.reduce((b, x) => (Math.abs(x - n) < Math.abs(b - n) ? x : b), list[0]);
  let left = 0;
  const findings: Finding[] = [];
  for (const f of raw.findings) {
    let side: Finding["side"] = f.side === "LEFT" ? "LEFT" : "RIGHT";
    let list = lines.get(`${f.path}|${side}`);
    if (!list?.length) { side = side === "LEFT" ? "RIGHT" : "LEFT"; list = lines.get(`${f.path}|${side}`); }
    if (!list?.length) { left++; continue; }
    const line = list.includes(f.line) ? f.line : nearest(list, f.line);
    const start = f.startLine && f.startLine < line && list.includes(f.startLine) && f.side === side ? f.startLine : undefined;
    findings.push({ id: crypto.randomUUID().slice(0, 8), path: f.path, side, line, ...(start ? { startLine: start } : {}),
      severity: (["bug", "risk", "question", "nit"] as const).includes(f.severity) ? f.severity : "risk", title: f.title.trim(), body: f.body.trim(), status: "open" });
  }
  return { summary: raw.summary.trim(), findings, left };
}

/** The draft a finding becomes: its body, as you'd post it. */
export const draftOf = (f: Finding, pr: ReviewGraph["pr"]) => ({ path: f.path, line: f.line, side: f.side, ...(f.startLine ? { startLine: f.startLine, startSide: f.side } : {}), body: refsForGitHub(f.body, pr), inDiff: true });
