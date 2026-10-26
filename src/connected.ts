// What Claude can use of your own Claude Code setup, beyond Bobby's tools: your MCP servers and claude.ai connectors
// (Linear, Notion, Slack, Datadog…), and plugins' MCP servers. Off unless you turn one on, for every review (bobby
// --agent-tools) or for one PR (the Review with Claude dialog). Each is "read" (only its tools that read, by name:
// get_, list_, search_…; the PR can't get Claude to post or change anything through it) or "all".
//
// What you have is read from Claude Code itself: it's started with your settings, and stopped once it has said what
// it loaded, before it asks the model anything. With something on, Claude runs with your user settings for its
// connections, but with hooks off, skills and commands off, and every tool of a server you didn't choose (and, for
// "read", every tool that doesn't read) disallowed.
import { claudeBin } from "./claude.ts";

export type Access = "read" | "all";
export type Selection = Record<string, Access>; // server name → access; absent: off
export interface Server { name: string; status: string; prefix: string; read: string[]; write: string[] }

/** A server's tool names start mcp__<its name, with anything but letters, digits, _ and - as _>__. */
export const prefixOf = (name: string) => `mcp__${name.replace(/[^\w-]/g, "_")}__`;

const READS = /^(get|list|search|read|fetch|query|find|describe|view|lookup|retrieve|show|count|check|explain|analy[sz]e|summari[sz]e|inspect|browse|resolve|whoami|me|aggregate|extract)$/i;
const WRITES = /^(create|update|delete|remove|send|post|add|set|write|edit|archive|unarchive|move|upload|invite|assign|unassign|comment|reply|react|schedule|cancel|close|reopen|merge|publish|deploy|run|execute|trigger|start|stop|restart|mute|unmute|ack|acknowledge|approve|reject|submit|insert|upsert|patch|put|rename|duplicate|import|export|fill|click|navigate|press|type|drag|evaluate|emulate|install|enable|disable|mark|pin|unpin|star|subscribe|unsubscribe|join|leave|kick|ban|grant|revoke|share|transfer)$/i;
/** Whether a tool only reads, from its name: a reading verb among its words and no writing one. Unsure is a write. */
export function readsOnly(tool: string): boolean { // its name, without the server's prefix
  const words = tool.split(/[_\-.]|(?=[A-Z])/).filter(Boolean);
  return words.some((w) => READS.test(w)) && !words.some((w) => WRITES.test(w));
}

/** Groups the init event's tools by server. */
export function catalogOf(init: { tools?: string[]; mcp_servers?: Array<{ name: string; status: string }> }): Server[] {
  return (init.mcp_servers ?? []).map((m) => {
    const prefix = prefixOf(m.name), tools = (init.tools ?? []).filter((t) => t.startsWith(prefix));
    const reads = (t: string) => readsOnly(t.slice(prefix.length));
    return { name: m.name, status: m.status, prefix, read: tools.filter(reads), write: tools.filter((t) => !reads(t)) };
  });
}

let cached: { at: number; servers: Promise<Server[]> } | null = null;
/** What your Claude Code setup has, cached ten minutes (fresh: ask again). */
export function catalog(fresh = false): Promise<Server[]> {
  if (!fresh && cached && Date.now() - cached.at < 600_000) return cached.servers;
  const servers = settled().catch((e) => { cached = null; throw e; });
  cached = { at: Date.now(), servers };
  return servers;
}
/** A slow server is still connecting when Claude Code says what it has (no tools yet): ask again, up to three times. */
async function settled(): Promise<Server[]> {
  let best = await probe();
  for (let i = 0; i < 2 && best.some((s) => s.status === "pending"); i++) {
    const next = await probe();
    best = next.map((s) => (s.status === "pending" ? best.find((b) => b.name === s.name && b.status !== "pending") ?? s : s));
  }
  return best;
}
async function probe(): Promise<Server[]> {
  const p = Bun.spawn([claudeBin() ?? "claude", "-p", "--output-format", "stream-json", "--verbose", "--no-session-persistence", "--setting-sources", "user", "--tools", "Read", "--settings", '{"disableAllHooks":true}'],
    { cwd: (await import("node:os")).tmpdir(), stdin: "pipe", stdout: "pipe", stderr: "pipe" });
  p.stdin.write("hi"); p.stdin.end();
  const slow = setTimeout(() => p.kill(), 60_000);
  let buf = "";
  try {
    for await (const c of p.stdout) {
      buf += new TextDecoder().decode(c);
      let nl;
      while ((nl = buf.indexOf("\n")) >= 0) {
        const e = JSON.parse(buf.slice(0, nl)); buf = buf.slice(nl + 1);
        if (e.type === "system" && e.subtype === "init") { p.kill(); return catalogOf(e); } // before it asks the model anything
      }
    }
  } finally { clearTimeout(slow); p.kill(); }
  throw new Error((await new Response(p.stderr).text()).trim().split("\n").at(-1) || "Claude Code didn't say what it has");
}

/** --agent-tools / BOBBY_AGENT_TOOLS: "linear,notion,datadog:all", each a case-insensitive part of a server's name. */
export function parseSpec(spec: string | undefined): Array<{ match: string; access: Access }> {
  return (spec ?? "").split(",").map((x) => x.trim()).filter(Boolean).map((x) => {
    const [match, access] = x.split(":");
    return { match: match.toLowerCase(), access: access?.toLowerCase() === "all" ? "all" : "read" };
  });
}
export function resolveSpec(spec: Array<{ match: string; access: Access }>, servers: Server[]): Selection {
  const out: Selection = {};
  for (const s of spec) for (const v of servers) if (v.name.toLowerCase().includes(s.match)) out[v.name] = s.access;
  return out;
}

/** How Claude runs with a selection: its settings flags, the tools to disallow and allow, and what to tell it;
 *  nothing when nothing's on (it runs as before, with none of your setup). */
export interface Connected { args: string[]; disallowed: string[]; allowed: string[]; note: string }
export function runWith(sel: Selection, servers: Server[]): Connected | null {
  const on = servers.filter((s) => sel[s.name]);
  if (!on.length) return null;
  // a whole server: mcp__<name>; one on "read" whose tools aren't known yet (still connecting) too, as its writes can't be told
  const unknown = (s: Server) => sel[s.name] === "read" && !s.read.length && !s.write.length;
  const blocked = servers.filter((s) => !sel[s.name] || unknown(s)).map((s) => s.prefix.slice(0, -2));
  const writes = on.filter((s) => sel[s.name] === "read").flatMap((s) => s.write);
  const allowed = on.flatMap((s) => (sel[s.name] === "all" ? [s.prefix.slice(0, -2)] : s.read));
  const args = ["--setting-sources", "user", "--settings", JSON.stringify({ disableAllHooks: true })];
  const note = `You can also use some of the reviewer's own connected tools, for context the code doesn't have (the PR's ticket, design docs, discussions, alerts): ${on.map((s) => `${s.name} (${sel[s.name] === "read" ? "read only" : "full access"})`).join(", ")}. Their tool names start mcp__ and the server's name. Use them when the PR or the question points to something there (a ticket ID, a link, an incident); don't post, create or change anything through them unless the reviewer asks you to.`;
  return { args, disallowed: [...blocked, ...writes], allowed, note };
}
