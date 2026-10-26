// Bobby's own tools for Claude (agent.ts, ask.ts), over MCP: what the reviewer sees in Bobby, which a plain checkout
// doesn't give it. The PR at a glance and its diff, any file before or after the PR with the PR's changes marked,
// where a name is defined and where it's used (the language servers, as the inspector), the review threads, and a
// line's history. All read-only. Served by Bobby at /mcp/<token>: each run of Claude gets its own token, gone when
// it ends, so the endpoint answers only that run, about that review. Streamable HTTP, JSON responses only.
import pkg from "../package.json" with { type: "json" };
import { git } from "./git.ts";
import type { ReviewGraph } from "./graph.ts";

/** What the tools read: the review's graph and clone, and its API (server.ts), called in process. */
export interface McpContext {
  g: ReviewGraph; cwd: string; api: (path: string) => Promise<any>;
  report?: (finding: Record<string, unknown>) => number; // a review: takes a finding, says how many so far
}
const runs = new Map<string, McpContext>();
/** A token for one run of Claude, and its end. */
export function openMcp(ctx: McpContext): { token: string; close: () => void } {
  const token = crypto.randomUUID().replace(/-/g, "");
  runs.set(token, ctx);
  return { token, close: () => runs.delete(token) };
}
export const mcpConfig = (url: string) => JSON.stringify({ mcpServers: { bobby: { type: "http", url } } });

const str = (description: string) => ({ type: "string", description });
const int = (description: string) => ({ type: "integer", description });
const TOOLS = [
  { name: "pr_overview", description: "The pull request at a glance: its title, description and what it does, its changed files (with how much changed), and its core changes when Bobby has grouped them. Start here.",
    inputSchema: { type: "object", properties: {} } },
  { name: "pr_diff", description: "What the PR changed in one file: its hunks, each line numbered R<n> (the new file) or L<n> (the old file, removed lines), with +/-.",
    inputSchema: { type: "object", properties: { path: str("The file's path from the repository root, as pr_overview lists it.") }, required: ["path"] } },
  { name: "read_file", description: "A file's lines, numbered, as they are after the PR (side: head, the default) or before it (side: base), with the lines the PR added (+) or removed (-) marked. Up to 400 lines a call.",
    inputSchema: { type: "object", properties: { path: str("Path from the repository root."), side: { type: "string", enum: ["head", "base"], description: "head: after the PR (default); base: before it." }, start: int("First line (default 1)."), end: int("Last line (default start + 399).") }, required: ["path"] } },
  { name: "definition", description: "Where a name used on a line is declared (at head), from the language server when there is one, else from imports: its location, its type when known, and its code. Better than searching for the name.",
    inputSchema: { type: "object", properties: { path: str("File the name is used in."), line: int("Line it's used on (at head)."), name: str("The name, as written on that line.") }, required: ["path", "line", "name"] } },
  { name: "references", description: "Every use of a name in the codebase (at head), grouped as in the diff, in the PR's files, or elsewhere: each with its line of code. Better than searching for the name.",
    inputSchema: { type: "object", properties: { path: str("A file the name is used or declared in."), line: int("A line with the name on it (at head)."), name: str("The name.") }, required: ["path", "line", "name"] } },
  { name: "review_threads", description: "What reviewers have already said on the PR's lines: each thread's place, author, whether it's resolved, and its comments.",
    inputSchema: { type: "object", properties: { path: str("Only this file's threads (optional).") } } },
  { name: "history", description: "Why code is the way it is: a file's recent commits, or with a line, the commit that last changed it and its message (git log and blame, before this PR's head).",
    inputSchema: { type: "object", properties: { path: str("Path from the repository root."), line: int("A line (at head): who last changed it, and why (optional).") }, required: ["path"] } },
];

/** For a review: each finding, reported as soon as it's checked (agent.ts takes them). */
const REPORT = { name: "report_finding", description: "Report one finding of your review, once you've checked it against the code. One call per finding.",
  inputSchema: { type: "object", properties: {
    path: str("The file, from the repository root."), side: { type: "string", enum: ["RIGHT", "LEFT"], description: "RIGHT with an R<n> line of the diff, LEFT with an L<n> one." },
    line: int("The line it's on (its last line, for a range)."), startLine: int("The first line, for a range on the same side; else 0."),
    severity: { type: "string", enum: ["bug", "risk", "question", "nit"] }, title: str("At most 10 words, stating the problem."), body: str("The review comment to the PR's author, in Markdown, citing the code you checked."),
  }, required: ["path", "side", "line", "severity", "title", "body"] } };
const toolsOf = (ctx: McpContext) => (ctx.report ? [...TOOLS, REPORT] : TOOLS);

/** One JSON-RPC request (or a batch) to the endpoint. */
export async function handleMcp(req: Request, token: string): Promise<Response> {
  const ctx = runs.get(token);
  if (!ctx) return new Response("Not found", { status: 404 });
  if (req.method !== "POST") return new Response("Method not allowed", { status: 405, headers: { allow: "POST" } });
  const body = await req.json().catch(() => null);
  if (!body) return Response.json({ jsonrpc: "2.0", id: null, error: { code: -32700, message: "Parse error" } }, { status: 400 });
  const one = async (m: { id?: string | number; method: string; params?: any }) => {
    if (m.id === undefined) return null; // a notification: nothing to say
    try { return { jsonrpc: "2.0", id: m.id, result: await call(ctx, m.method, m.params ?? {}) }; }
    catch (e) { return { jsonrpc: "2.0", id: m.id, error: { code: (e as { code?: number }).code ?? -32603, message: (e as Error).message } }; }
  };
  const out = Array.isArray(body) ? (await Promise.all(body.map(one))).filter(Boolean) : await one(body);
  return out && (!Array.isArray(out) || out.length) ? Response.json(out) : new Response(null, { status: 202 });
}

async function call(ctx: McpContext, method: string, params: any) {
  if (method === "initialize") return { protocolVersion: params.protocolVersion ?? "2025-06-18", capabilities: { tools: {} }, serverInfo: { name: "bobby", version: pkg.version } };
  if (method === "ping") return {};
  if (method === "tools/list") return { tools: toolsOf(ctx) };
  if (method === "tools/call") {
    const tool = toolsOf(ctx).find((t) => t.name === params.name);
    if (!tool) throw Object.assign(new Error(`no tool ${params.name}`), { code: -32602 });
    try { return { content: [{ type: "text", text: await run(ctx, params.name, params.arguments ?? {}) }] }; }
    catch (e) { return { content: [{ type: "text", text: (e as Error).message }], isError: true }; }
  }
  throw Object.assign(new Error(`no method ${method}`), { code: -32601 });
}

const MAX_LINES = 400;
const insideRepo = (p: unknown): p is string => typeof p === "string" && !!p && !p.startsWith("/") && !p.split(/[\\/]/).includes("..");
const need = (p: unknown, what = "path") => { if (!insideRepo(p)) throw new Error(`${what}: a path from the repository root`); return p; };
const lineOf = (n: unknown) => { const x = Number(n); if (!Number.isInteger(x) || x < 1) throw new Error("line: a line number from 1"); return x; };

/** Runs a tool: its answer, as text for Claude. */
export async function run(ctx: McpContext, name: string, a: Record<string, unknown>): Promise<string> {
  const { g } = ctx;
  if (name === "report_finding" && ctx.report) {
    if (!insideRepo(a.path) || !Number.isInteger(Number(a.line)) || typeof a.title !== "string" || typeof a.body !== "string") throw new Error("a finding needs path, side, line, severity, title and body");
    return `Recorded (${ctx.report({ ...a, line: Number(a.line), startLine: Number(a.startLine) || 0 })} so far). Keep checking, or reply with your summary when you're done.`;
  }
  if (name === "pr_overview") {
    const files = g.files.map((f) => `- ${f.path} (${f.status}${f.oldPath && f.oldPath !== f.path ? ` from ${f.oldPath}` : ""}, +${f.additions} −${f.deletions})${f.lowSignal ? ` [low signal: ${f.lowSignal}]` : ""}`);
    const cores = g.generator.tree === "claude" ? g.cores.map((c, i) => `${i + 1}. ${c.title}: ${c.summary}`) : [];
    return [`# ${g.pr.title}`, g.pr.body.slice(0, 3000) || "(no description)", "", `What it does: ${g.intent}`, "", `## Files (${g.files.length})`, ...files,
      ...(cores.length ? ["", "## Its core changes", ...cores] : []), "", `${(g.discussion ?? []).length} review comments so far (review_threads).`].join("\n");
  }
  if (name === "pr_diff") {
    const path = need(a.path), hunks = g.hunks.filter((h) => h.file === path);
    if (!hunks.length) throw new Error(`${path} isn't in the PR's diff. Its files: ${g.files.map((f) => f.path).join(", ")}`);
    const out = hunks.map((h) => [h.header, ...h.lines.map((l) => `${l.t === "-" ? `L${l.o}` : `R${l.n}`}\t${l.t}${l.s}`)].join("\n")).join("\n");
    const lines = out.split("\n");
    return lines.length > 1500 ? `${lines.slice(0, 1500).join("\n")}\n(${lines.length - 1500} more lines: read_file the rest)` : out;
  }
  if (name === "read_file") {
    const path = need(a.path), side = a.side === "base" ? "base" : "head";
    const r = await ctx.api(`/api/file?path=${encodeURIComponent(path)}${side === "base" ? "&side=base" : ""}`);
    const all: string[] = r?.lines ?? [];
    if (!all.length || (all.length === 1 && !all[0])) throw new Error(`${path} doesn't exist ${side === "base" ? "before the PR" : "at the PR's head"}`);
    const n = all.at(-1) === "" ? all.length - 1 : all.length;
    const start = Math.max(1, Number(a.start) || 1), end = Math.min(n, Number(a.end) || start + MAX_LINES - 1, start + MAX_LINES - 1);
    const t = side === "base" ? "-" : "+", key = side === "base" ? "o" : "n";
    const changed = new Set(g.hunks.filter((h) => h.file === path).flatMap((h) => h.lines.filter((l) => l.t === t).map((l) => l[key])));
    const body = all.slice(start - 1, end).map((s, i) => `${String(start + i).padStart(5)} ${changed.has(start + i) ? t : " "} ${s}`).join("\n");
    return `${path} (${side === "base" ? "before the PR" : "after the PR"}), lines ${start}–${end} of ${n}${changed.size ? `; ${t} marks lines the PR ${side === "base" ? "removed" : "added"}` : ""}\n${body}${end < n ? `\n(… ${n - end} more lines: read_file with start=${end + 1})` : ""}`;
  }
  if (name === "definition" || name === "references") {
    const path = need(a.path), line = lineOf(a.line), word = String(a.name ?? "").trim();
    if (!/^[\w$]+$/.test(word)) throw new Error("name: one identifier, as written on the line");
    const text: string = (await ctx.api(`/api/file?path=${encodeURIComponent(path)}`))?.lines?.[line - 1] ?? "";
    const m = new RegExp(`(?<![\\w$])${word.replace(/\$/g, "\\$")}(?![\\w$])`).exec(text);
    if (!m) throw new Error(`${word} isn't on ${path}:${line} (the line reads: ${text.trim().slice(0, 200) || "nothing"})`);
    const q = `path=${encodeURIComponent(path)}&line=${line}&col=${m.index}`;
    if (name === "definition") {
      const r = await ctx.api(`/api/inspect?${q}`);
      if (r?.ext) return `${word} is declared outside this repository, in ${r.ext}.${r.hover ? `\n\n${r.hover}` : ""}`;
      if (!r?.to) return `Couldn't find where ${word} is declared${r?.pending ? " (the language server is still loading: try again shortly)" : ""}. Search for it instead.`;
      const lines: string[] = (await ctx.api(`/api/file?path=${encodeURIComponent(r.to.path)}`))?.lines ?? [];
      const to = Math.min(r.to.end ?? r.to.line + 20, r.to.line + 60);
      const code = lines.slice(r.to.line - 1, to).map((s, i) => `${String(r.to.line + i).padStart(5)}   ${s}`).join("\n");
      return `${word} is declared at ${r.to.path}:${r.to.line}${r.to.end ? `-${r.to.end}` : ""} (found ${r.via === "lsp" ? "by the language server" : "through imports"})${r.hover ? `\n\nType:\n${r.hover}` : ""}\n\n${code}`;
    }
    const r = await ctx.api(`/api/references?${q}`);
    const refs: Array<{ path: string; line: number; text: string }> = r?.refs ?? [];
    if (!refs.length) return `No uses of ${word} found${r?.pending ? " (the language server is still loading)" : r?.via === "syntax" ? " through imports (uses through a value need the language server)" : ""}.`;
    const diff = new Set(g.hunks.flatMap((h) => h.lines.filter((l) => l.t !== "-").map((l) => `${h.file}:${l.n}`))), prFiles = new Set(g.files.map((f) => f.path));
    const group = (x: { path: string; line: number }) => (diff.has(`${x.path}:${x.line}`) ? 0 : prFiles.has(x.path) ? 1 : 2);
    const shown = refs.slice(0, 150).sort((x, y) => group(x) - group(y));
    return [`${r.total} uses of ${word} (found ${r.via === "lsp" ? "by the language server" : "through imports"})${refs.length > 150 ? `, the first 150` : ""}:`,
      ...shown.map((x) => `${x.path}:${x.line} [${["in the diff", "in the PR's files", "elsewhere"][group(x)]}] ${x.text.trim().slice(0, 160)}`)].join("\n");
  }
  if (name === "review_threads") {
    const path = a.path === undefined ? null : need(a.path);
    const all = (g.discussion ?? []).filter((c) => !path || c.path === path);
    if (!all.length) return path ? `No review comments on ${path}.` : "No review comments on the PR's lines yet.";
    const ids = new Set(all.map((c) => c.id)), threads = new Map<string, typeof all>();
    for (const c of [...all].sort((x, y) => x.createdAt.localeCompare(y.createdAt))) {
      const root = c.replyTo && ids.has(c.replyTo) ? c.replyTo : c.id;
      (threads.get(root) ?? threads.set(root, []).get(root)!).push(c);
    }
    return [...threads.values()].map((t) => `## ${t[0].path}:${t[0].startLine ? `${t[0].startLine}-` : ""}${t[0].line}${t[0].side === "LEFT" ? " (old side)" : ""}${t.some((c) => c.resolved) ? " · resolved" : ""}\n${t.map((c) => `${c.author}: ${c.body.trim().slice(0, 800)}`).join("\n")}`).join("\n\n");
  }
  if (name === "history") {
    const path = need(a.path), head = g.pr.headSha;
    if (a.line !== undefined) {
      const line = lineOf(a.line);
      const blame = await git(ctx.cwd, ["blame", "-L", `${line},${line}`, "--porcelain", head, "--", path], true);
      const sha = /^([0-9a-f]{40})/.exec(blame)?.[1];
      if (!sha) throw new Error(`no history for ${path}:${line}`);
      const msg = await git(ctx.cwd, ["log", "-1", "--format=%h %ad %an%n%n%B", "--date=short", sha], true);
      return `${path}:${line} was last changed in ${sha === "0".repeat(40) ? "uncommitted changes" : `${msg.trim().slice(0, 1500)}`}`;
    }
    const log = await git(ctx.cwd, ["log", "-n", "12", "--format=%h %ad %an: %s", "--date=short", head, "--", path], true);
    return log.trim() ? `Recent commits to ${path} (newest first):\n${log.trim()}` : `No history for ${path}.`;
  }
  throw new Error(`no tool ${name}`);
}
