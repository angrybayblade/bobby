import { join, normalize } from "node:path";
import { embeddedAsset } from "./assets.ts";
import { cancelLogin, claudeStatus, dismiss, INSTALL_TEXT, installClaude, startLogin, submitCode } from "./claude.ts";
import { fileLines, fileLinesMany, forgetUnknownMe, git, parsePrArg, reactionsOf, reviewComments, run, whoAmI } from "./git.ts";
import { type AgentJob, draftOf, runAgentReview } from "./agent.ts";
import { runAsk } from "./ask.ts";
import { handleMcp, mcpConfig, openMcp } from "./mcp.ts";
import { catalog, parseSpec, resolveSpec, runWith, type Connected, type Selection } from "./connected.ts";
import { refsForGitHub } from "./refs.ts";
import { cancelGhLogin, dismissGh, ghStatus, installGh, startGhLogin } from "./github.ts";
import { REACTION_KINDS, type ReviewGraph, setDiscussion } from "./graph.ts";
import { home, loadSettings, saveSettings, saveState } from "./state.ts";
import type { Ask, Comment, Definition, PrivateNote, ReviewState } from "./types.ts";
import { type Inspector, insideRepo, inspectSyntax, referencesSyntax, type Uses } from "./inspect.ts";
import { declineServer, inspectorFor, installServer, recheckServer, type ServerInfo, serverInfoFor } from "./servers.ts";
import { Repo } from "./resolve.ts";
import type { Update } from "./watch.ts";
import { approvedOf, loadRecents, noteRecent, prLists } from "./recents.ts";
import { type Conversation, conversation } from "./conversation.ts";
import { type ReviewEvent, submitReview } from "./submit.ts";
import * as log from "./log.ts";
import pkg from "../package.json" with { type: "json" };
import type { Release } from "./updates.ts";

export interface Session {
  cwd: string | null; // local clone; null when viewing a graph file without one
  staticGraph: ReviewGraph;
  claudeGraph?: ReviewGraph;
  state: ReviewState;
  llm: "pending" | "done" | "failed" | "off";
  llmError?: string;
  askClaude?: () => void; // asks Claude for the tree again (once it's set up, after it failed)
  // Language servers, one per language in the review (servers.ts): where each stands, the running ones, and the
  // definitions with their answers merged in. root: the tree they read; log: where they report.
  servers?: Record<string, ServerInfo>;
  inspectors?: Record<string, Inspector>;
  root?: Promise<string>;
  log?: (m: string) => void;
  definitions?: Record<string, Definition[]>;
  repo?: Promise<Repo>; // the head commit's syntax, for the inspector without a language server
  refresh?: boolean; // --refresh: language servers answer afresh rather than from their cache
  // Keeping it current (watch.ts): when the PR's comments last changed; new work to move to, if any; moving to it.
  discussionAt?: number;
  conversation?: { at: number; value: Promise<Conversation> }; // the Conversation view's, read at most every 15 s
  update?: Update;
  rebuild?: () => Promise<void>;
  rebuilding?: boolean;
  baseRef?: string; // a PR's base branch, to notice it being retargeted
  builtHead?: string; // a local review: HEAD when it was built
  id?: string; // its address in the app (/r/<id>), and its key in recents
  seenAt?: number; // its page's last request: a review no page has asked about for a while is unloaded
  stopWatching?: () => void;
  agentJob?: AgentJob; // an agent-assisted review running, or the last one's end (agent.ts)
  askJobs?: Map<string, AgentJob & { text?: string }>; // questions being answered, by ask id (ask.ts)
  prNode?: string; // the PR's GraphQL node id, once asked (for its Viewed checkboxes)
  since?: { head: string; value: { sha: string; at: string; commits: number; arg: string } | null }; // your last review, for this head
}

const PUBLIC = join(import.meta.dir, "..", "public");
const json = (v: unknown, status = 200) => Response.json(v, { status });

/** Where a line sits, outer › inner: the blocks around it, by indentation, which reads anonymous callbacks too
 *  (describe/it, route handlers) in any language. "" at the top of the file. */
function scopeAt(lines: string[], line: number): string {
  const indent = (t: string) => t.replace(/\t/g, "    ").match(/^ */)![0].length;
  let cur = indent(lines[line - 1] ?? "");
  const chain: string[] = [];
  for (let i = line - 2; i >= 0 && cur > 0 && chain.length < 2; i--) {
    const t = lines[i];
    if (!t.trim() || indent(t) >= cur) continue;
    cur = indent(t);
    const label = opener(t.trim());
    if (label) chain.unshift(label);
  }
  return chain.join(" › ");
}
/** A line that opens a block, named: a test, a function, a method, a class; or null for one that doesn't (an object). */
function opener(t: string): string | null {
  let m;
  if (/^(import\b|export\s*\{[^}]*$|from\s+\S+\s+import\s*\($)/.test(t)) return "import"; // a name on its own line in a multi-line import
  if ((m = /^(describe|it|test|context|suite)(?:\.\w+)?\(\s*(['"`])(.{1,60}?)\2/.exec(t))) return `${m[1]} "${m[3]}"`;
  if ((m = /^func\s+\(\s*\w*\s*\*?(\w+)[^)]*\)\s*(\w+)/.exec(t))) return `${m[1]}.${m[2]}()`; // Go method
  if ((m = /^(?:export\s+)?(?:default\s+)?(?:async\s+)?(?:function\*?|func|def|fn)\s+(\w+)/.exec(t))) return `${m[1]}()`;
  if ((m = /^(?:export\s+)?(?:default\s+)?(?:abstract\s+)?(?:class|interface|struct|impl|type)\s+(\w+)/.exec(t))) return m[1];
  if ((m = /^(?:export\s+)?(?:const|let|var)\s+(\w+)\s*[:=]/.exec(t))) return /=>|function|\($/.test(t) || /[({[]\s*$/.test(t) ? m[1] : null;
  if ((m = /^(?:(?:public|private|protected|static|async|override|readonly|get|set)\s+)*(\w+)\s*(?:<[^>]*>)?\([^)]*\)?\s*(?::[^={]+)?\{?\s*$/.exec(t)) && !/^(if|for|while|switch|catch|return|else)$/.test(m[1])) return `${m[1]}()`; // a method
  if ((m = /^\w[\w.]*\.(get|post|put|patch|delete|use|on|route)\(\s*(['"`])(.{1,50}?)\2/.exec(t))) return `${m[1]} "${m[3]}"`; // a route or a handler
  if ((m = /^(?:await\s+|return\s+)?([\w.]+)\((?:.*,\s*)?(?:async\s+)?(?:\([^)]*\)|\w+)\s*=>\s*\{\s*$/.exec(t))) return `${m[1].split(".").pop()}(…)`; // a callback: beforeEach, map, router.use
  return null;
}

const AVATAR_HOSTS = /^https:\/\/(avatars\.githubusercontent\.com|github\.com)\//;
async function avatar(u: string): Promise<Response> {
  const src = /^[\w.-]+(\[bot\])?$/.test(u) ? `https://github.com/${u.replace(/\[bot\]$/, "")}.png` : u; // a login, or the URL the API gave
  if (!AVATAR_HOSTS.test(src)) return new Response("not a GitHub avatar", { status: 400 });
  const sized = src + (src.includes("?") ? "&" : "?") + "s=64";
  const file = join(home(), "cache", "avatars", new Bun.CryptoHasher("sha1").update(sized).digest("hex"));
  const headers = { "cache-control": "max-age=604800" };
  const cached = Bun.file(file);
  if ((await cached.exists()) && Date.now() - cached.lastModified < 604_800_000) return new Response(cached, { headers: { ...headers, "content-type": (await Bun.file(file + ".type").text().catch(() => "image/png")) } });
  try {
    const r = await fetch(sized, { redirect: "follow" });
    const type = r.headers.get("content-type") ?? "";
    if (!r.ok || !type.startsWith("image/") || !AVATAR_HOSTS.test(r.url)) throw new Error(`${r.status}`);
    const body = new Uint8Array(await r.arrayBuffer());
    await Bun.write(file, body);
    await Bun.write(file + ".type", type);
    return new Response(body, { headers: { ...headers, "content-type": type } });
  } catch {
    return (await cached.exists()) ? new Response(cached, { headers }) : new Response("no avatar", { status: 404 }); // offline: an old one beats none
  }
}

/** Whether a file in your working copy differs from the snapshot a local review was built from. Compared as git
 *  stores them (hash-object runs the same filters as git add: line endings under autocrlf, LFS), so a checkout's CRLFs
 *  aren't a change. */
async function changedSince(cwd: string, snapshot: string, path: string) {
  const [live, then] = await Promise.all([
    run(["git", "hash-object", `--path=${path}`, "--", join(cwd, path)], { cwd, allowFail: true }),
    run(["git", "rev-parse", "--verify", "--quiet", `${snapshot}:${path}`], { cwd, allowFail: true }),
  ]);
  return live.trim() !== then.trim();
}

/** Whether Bobby's page may be opened at this Host. A loopback name, at any port (an SSH tunnel's port is its own); else
 *  only a name you allowed (--allow-host): "name" at any port, "name:port" at that one, "*" any name at all. A website
 *  that rebinds its own name to this machine sends that name, which isn't on the list. */
export function hostAllowed(host: string, allow: string[] = []): boolean {
  host = host.toLowerCase();
  const name = host.replace(/:\d+$/, "");
  if (["127.0.0.1", "localhost", "[::1]"].includes(name)) return true;
  return allow.some((a) => (a = a.toLowerCase()) === "*" || a === host || a === name);
}

/** Only Bobby's own page may use the server. A website you have open could otherwise post a review as you (a no-cors
 *  POST needs no preflight), and one that rebinds its name to 127.0.0.1 could read your code. So: the Host must be one
 *  Bobby answers at (defeats DNS rebinding), a request that changes something must come from the page at that same
 *  Host (its Origin), and a POST must be JSON (which a foreign page can't send without a preflight, and the server
 *  answers none). */
function guard(req: Request, allow: string[]): Response | null {
  const host = (req.headers.get("host") ?? "").toLowerCase();
  if (!hostAllowed(host, allow)) return new Response(`Bobby only answers its own page (unexpected Host "${host}"). Opening it at another name, as on a remote machine? Start Bobby with --allow-host ${host.replace(/:\d+$/, "") || "<name>"}`, { status: 403 });
  if (req.method === "GET" || req.method === "HEAD") return null;
  const origin = req.headers.get("origin");
  if (origin && origin.toLowerCase().replace(/^https?:\/\//, "") !== host) return new Response("Bobby only answers its own page (foreign Origin).", { status: 403 });
  if (req.method === "POST" && !(req.headers.get("content-type") ?? "").toLowerCase().startsWith("application/json"))
    return new Response("Bobby only takes JSON.", { status: 415 });
  return null;
}

/** The app: every review open in it, by id (review.ts), and the ones still being built. One server holds them all, each
 *  at /r/<id> with its API under /r/<id>/api/. */
/** A review being built: what it is, the steps so far (what it logs), and when it started; or why it failed. */
export interface Loading { title: string; steps: string[]; startedAt: number; error?: string }
export interface App {
  reviews: Map<string, Session>;
  loading: Map<string, Loading>;
  release?: Release; // a newer Bobby, if one is out (updates.ts)
  /** Opens a review (a PR's URL or number, or with repo and no arg, a local branch): its id at once, built meanwhile. */
  open?: (arg: string | undefined, o: OpenOptions) => Promise<string>;
  /** A PR asked for before gh was set up, with what it was asked with (a PR number means one in that cwd's repo): the
   *  page sets gh up, then opens it. */
  waiting?: { arg: string; o: OpenOptions };
  self?: string; // where this server answers on this machine (cli.ts), for Claude to reach Bobby's tools (mcp.ts)
  agentTools?: string; // --agent-tools: your own tools Claude may use in every review, unless a PR says otherwise (connected.ts)
}
export type OpenOptions = { repo?: string; cwd?: string; base?: string; refresh?: boolean; noLlm?: boolean; noLsp?: boolean; ssh?: boolean };

async function staticFile(p: string): Promise<Response> {
  const rel = normalize(p.slice(1));
  if (rel.startsWith("..")) return new Response("Not found", { status: 404 });
  const asset = embeddedAsset(rel.split("\\").join("/"));
  if (asset) return new Response(asset.body, { headers: { "content-type": asset.type } });
  const file = Bun.file(join(PUBLIC, rel));
  return (await file.exists()) ? new Response(file) : new Response("Not found", { status: 404 });
}

/** hostname: the address to listen on (127.0.0.1 unless you're opening Bobby from elsewhere); allow: the other names
 *  its page may be opened at (hostAllowed). */
export function startServer(app: App, port: number, { hostname = "127.0.0.1", allow = [] as string[] } = {}) {
  return Bun.serve({
    port,
    hostname,
    fetch: (req) => logged(req, async () => {
      const url = new URL(req.url);
      const p = url.pathname;
      const refused = guard(req, allow);
      if (refused) return refused;
      if (p.startsWith("/mcp/")) return handleMcp(req, p.slice(5)); // Bobby's tools, for one run of Claude (mcp.ts)

      // A review: its page, or its API. An id is three segments (owner/repo/number, or local/repo/branch); after it,
      // /api/… is its API, and anything else is the page, at a view and what it's on (/diff/src/api/x.ts is a page).
      if (p.startsWith("/r/")) {
        const seg = p.slice(3).split("/"), rest = `/${seg.slice(3).join("/")}`;
        if (!rest.startsWith("/api/")) return staticFile("/index.html");
        const id = decodeURIComponent(seg.slice(0, 3).join("/")), s = app.reviews.get(id);
        if (s) return reviewApi(s, app, req, url, rest);
        // not open, but opened before (a reload after Bobby restarted, a bookmark): open it again, from what recents kept;
        // never opened, a PR's address (owner/repo/123, or @sha, @from..to): open that PR, as a new tab from home does
        let failed = "";
        if (!app.loading.has(id) && app.open) {
          const r = (await loadRecents()).find((x) => x.id === id);
          const pr = /^([\w.-]+)\/([\w.-]+)\/(\d+)(?:@((?:[0-9a-f]{7,40}\.\.)?[0-9a-f]{7,40}))?$/.exec(id);
          const arg = r ? (r.kind === "local" ? undefined : r.arg) : pr && pr[1] !== "local" ? `https://github.com/${pr[1]}/${pr[2]}/pull/${pr[3]}${pr[4] ? `/changes/${pr[4]}` : ""}` : null;
          if (r || arg) await app.open(arg ?? undefined, r ? { repo: r.repoDir, ...(r.kind === "local" ? { base: r.baseRef } : {}) } : {}).catch((e) => { failed = String(e?.message ?? e); });
        }
        const l = app.loading.get(id);
        // still building (or failed): with the settings, so the page wears your theme while it waits
        if (l) return json({ loading: !l.error, title: l.title, steps: l.steps, elapsed: Date.now() - l.startedAt, settings: loadSettings(), ...(l.error ? { error: l.error } : {}) }, l.error ? 500 : 202);
        return json({ error: failed || `No review ${id} is open. Open it from the home page, or with bobby <PR URL>.` }, 404);
      }
      if (!p.startsWith("/api/")) return staticFile(p === "/" ? "/home.html" : p);
      if (p === "/api/avatar") return avatar(url.searchParams.get("u") ?? "");
      // The home page: what you've opened (and which are open now), and the GitHub lists, filtered.
      if (p === "/api/home") {
        const recents = (await loadRecents()).map((r) => ({ ...r, open: app.reviews.has(r.id), loading: app.loading.has(r.id) && !app.loading.get(r.id)!.error }));
        return json({ settings: loadSettings(), me: await whoAmI(join(home(), "cache", "me.json")), release: app.release ?? null, version: pkg.version, recents, ...(app.waiting ? { waiting: app.waiting.arg } : {}) });
      }
      if (p === "/api/home/prs") {
        const q = (k: string) => url.searchParams.get(k) ?? undefined;
        return json(await prLists({ repo: q("repo"), author: q("author"), q: q("q") }, url.searchParams.has("fresh")));
      }
      if (req.method === "POST" && p === "/api/open") {
        const { arg, repo, cwd, base, refresh, noLlm, noLsp, ssh, sshAlways } = (await req.json().catch(() => ({}))) as { arg?: string; repo?: string; cwd?: string; base?: string; refresh?: boolean; noLlm?: boolean; noLsp?: boolean; ssh?: boolean; sshAlways?: boolean };
        if (!app.open) return json({ error: "this Bobby can't open reviews" }, 400);
        if (sshAlways) saveSettings({ ...loadSettings(), cloneSsh: "always" }); // the page's "Always": from now on, without asking
        const flags = Object.fromEntries(Object.entries({ refresh, noLlm, noLsp, ssh: ssh || sshAlways || undefined }).filter(([, v]) => v !== undefined));
        const a = arg?.trim() || undefined, waited = a && !cwd && !repo && app.waiting?.arg === a; // the page, once gh is set up
        const o: OpenOptions = waited ? app.waiting!.o : { repo, base, ...(cwd ? { cwd } : {}), ...flags };
        try {
          const id = await app.open(a, o);
          if (a && app.waiting?.arg === a) app.waiting = undefined;
          return json({ id });
        } catch (e) { // without gh signed in, setting it up is the way on: the page offers it, then opens this
          const pr = !!a && (() => { try { return !!parsePrArg(a); } catch { return false; } })(); // not a PR: gh won't help
          const setup = pr && (await ghStatus().then((gh) => !(gh.installed && gh.loggedIn)));
          if (setup) app.waiting = { arg: a, o };
          // cloning over HTTPS failed: the page asks whether to try SSH, then opens it again with ssh (or sshAlways)
          return json({ error: String((e as Error).message ?? e), ...(setup ? { setup: "gh" } : (e as { askSsh?: boolean }).askSsh ? { ask: "ssh" } : {}) }, 400);
        }
      }
      // Setting up GitHub's CLI (github.ts): where it stands, install it, sign in with a one-time code on github.com
      if (p === "/api/gh" || p.startsWith("/api/gh/")) return ghApi(req, p);
      // Setting up Claude Code (claude.ts): where it stands, install it, sign in by pasting the code from its sign-in page
      if (p === "/api/claude" || p.startsWith("/api/claude/")) return claudeApi(app, req, p);
      // The page's own errors, for the log (bobby logs): a few a minute at most, so a loop can't fill the disk
      if (p === "/api/log" && req.method === "POST") {
        const b = (await req.json().catch(() => ({}))) as { level?: unknown; message?: unknown; detail?: unknown; where?: unknown };
        if (pageLogs.push(Date.now()) > 30) pageLogs.splice(0, pageLogs.length - 30);
        if (pageLogs.length < 30 || Date.now() - pageLogs[0] > 60_000)
          log.toFile(b.level === "error" ? "error" : "warn", `page: ${String(b.message ?? "").slice(0, 500)}${b.where ? ` (${String(b.where).slice(0, 200)})` : ""}`, typeof b.detail === "string" ? b.detail.slice(0, 4000) : undefined);
        return json({ ok: true });
      }
      return json({ error: "not found" }, 404);
    }),
  });
}

const pageLogs: number[] = []; // when the page last logged, for its limit
/** Answers a request, and logs what went wrong: an error from the API (4xx, 5xx) with what it said, and anything thrown,
 *  which answers 500 instead of dropping the connection. */
async function logged(req: Request, answer: () => Promise<Response>): Promise<Response> {
  const { pathname } = new URL(req.url);
  try {
    const res = await answer();
    if (res.status >= 400 && pathname.includes("/api/") && pathname !== "/api/avatar") {
      const said = await res.clone().json().then((j: { error?: string }) => j.error ?? "", () => "");
      (res.status >= 500 ? log.error : log.warn)(`  ${req.method} ${pathname} → ${res.status}${said ? `: ${said}` : ""}`);
    }
    return res;
  } catch (e) {
    log.error(`  ${req.method} ${pathname} failed: ${(e as Error)?.message ?? e}`, (e as Error)?.stack);
    return json({ ok: false, error: String((e as Error)?.message ?? e) }, 500);
  }
}

/** Claude's setup, for the page. Once it's ready (just installed and signed in), the open reviews whose Claude tree
 *  failed ask again. */
let claudeWasReady: boolean | undefined;
async function claudeApi(app: App, req: Request, p: string): Promise<Response> {
  const status = async () => {
    const st = await claudeStatus(), ready = st.installed && st.loggedIn;
    if (ready && claudeWasReady === false) for (const s of app.reviews.values()) if (s.llm === "failed") s.askClaude?.();
    claudeWasReady = ready;
    return { ...st, ask: !ready && !st.dismissed && loadSettings().claude !== "never", install: INSTALL_TEXT };
  };
  if (req.method === "GET" && p === "/api/claude") return json(await status());
  if (req.method !== "POST") return json({ error: "not found" }, 404);
  try {
    if (p === "/api/claude/install") installClaude();
    else if (p === "/api/claude/login") await startLogin();
    else if (p === "/api/claude/code") {
      const { code } = (await req.json().catch(() => ({}))) as { code?: unknown };
      if (typeof code !== "string" || !code.trim()) return json({ ok: false, error: "Paste the code from the sign-in page" }, 400);
      claudeWasReady = false; // signing in now: what failed for want of it asks again
      await submitCode(code);
    } else if (p === "/api/claude/cancel") cancelLogin();
    else if (p === "/api/claude/dismiss") { // not now (this run), or never: saved, as settings.claude
      const { never } = (await req.json().catch(() => ({}))) as { never?: boolean };
      dismiss();
      if (never) saveSettings({ ...loadSettings(), claude: "never" });
    }
    else return json({ error: "not found" }, 404);
    return json({ ok: true, ...(await status()) });
  } catch (e) {
    return json({ ok: false, error: String((e as Error).message ?? e), ...(await status()) }, 400);
  }
}

/** gh's setup, for the page. */
let ghWasReady: boolean | undefined;
async function ghApi(req: Request, p: string): Promise<Response> {
  const status = async () => {
    const st = await ghStatus(), ready = st.installed && st.loggedIn;
    if (ready && ghWasReady === false) forgetUnknownMe(); // just set up: who you are on GitHub, ask again
    ghWasReady = ready;
    return { ...st, ask: !ready && !st.dismissed && loadSettings().gh !== "never" };
  };
  if (req.method === "GET" && p === "/api/gh") return json(await status());
  if (req.method !== "POST") return json({ error: "not found" }, 404);
  try {
    if (p === "/api/gh/install") installGh();
    else if (p === "/api/gh/login") await startGhLogin();
    else if (p === "/api/gh/cancel") cancelGhLogin();
    else if (p === "/api/gh/dismiss") { // not now (this run), or never: saved, as settings.gh
      const { never } = (await req.json().catch(() => ({}))) as { never?: boolean };
      dismissGh();
      if (never) saveSettings({ ...loadSettings(), gh: "never" });
    }
    else return json({ error: "not found" }, 404);
    return json({ ok: true, ...(await status()) });
  } catch (e) {
    return json({ ok: false, error: String((e as Error).message ?? e), ...(await status()) }, 400);
  }
}

/** One review's API: p is the path from /api/. */
async function reviewApi(s: Session, app: App, req: Request, url: URL, p: string): Promise<Response> {
  s.seenAt = Date.now();
  const pr = () => s.staticGraph.pr;
  const persist = () => saveState(pr(), s.state); // the PR, or its branch, or one commit of it: each its own file
  {
    {

      if (p === "/api/graph") {
        const want = url.searchParams.get("tree");
        const g = want === "static" ? s.staticGraph : (s.claudeGraph ?? s.staticGraph);
        return json(s.definitions ? { ...g, definitions: s.definitions } : g); // the language server's, once it has answered
      }
      if (p === "/api/session")
        return json({ state: s.state, settings: loadSettings(), llm: s.llm, llmError: s.llmError, servers: Object.values(s.servers ?? {}), me: await whoAmI(join(home(), "cache", "me.json")), caps: { files: !!s.cwd, inspect: !!s.cwd } });
      // A GitHub avatar, fetched once and kept a week in ~/.bobby/cache/avatars. Only GitHub's own avatar hosts.
      if (p === "/api/avatar") return avatar(url.searchParams.get("u") ?? "");
      if (p === "/api/status") return json({ agent: agentStatus(s), asking: [...(s.askJobs?.values() ?? [])].filter((j) => !j.done).length, llm: s.llm, llmError: s.llmError, claudeReady: !!s.claudeGraph, servers: Object.values(s.servers ?? {}), discussionAt: s.discussionAt ?? 0, release: app.release ?? null, update: s.rebuilding ? { ...s.update, rebuilding: true } : s.update ?? null });
      if (p === "/api/discussion") return json({ comments: s.staticGraph.discussion ?? [], outdated: s.staticGraph.outdated ?? [] });
      if (p === "/api/conversation") {
        if (pr().provider === "local") return json({ error: "A local review has no PR, so no conversation." }, 404);
        if (!s.conversation || url.searchParams.has("fresh") || Date.now() - s.conversation.at > 15_000) {
          const value = conversation(pr());
          s.conversation = { at: Date.now(), value };
          value.then((c) => { if (s.id) void noteRecent({ id: s.id, approved: approvedOf(c.decision, c.verdicts.map((v) => v.state)) }); }, () => {});
          value.catch(() => { if (s.conversation?.value === value) s.conversation = undefined; }); // a failure isn't kept
        }
        try { return json(await s.conversation.value); } catch (e) { return json({ error: String((e as Error).message) }, 502); }
      }
      // Writing in the conversation: a comment on the PR, or a reply in a review thread. Each posts at once, as GitHub's
      // Comment and Reply buttons do (a review, with its drafts on lines, still goes through /api/submit).
      if (req.method === "POST" && (p === "/api/conversation/comment" || p === "/api/conversation/reply")) {
        const { body, to } = (await req.json().catch(() => ({}))) as { body?: unknown; to?: unknown };
        if (typeof body !== "string" || !body.trim()) return json({ ok: false, error: "Nothing to post" }, 400);
        if (p.endsWith("/reply") && (typeof to !== "string" || !/^\d+$/.test(to))) return json({ ok: false, error: "to must be the id of a review comment" }, 400);
        if (pr().provider === "local") return json({ ok: false, error: "This is a local review with no PR, so there's nowhere to post." }, 400);
        const { owner, repo, number } = pr();
        const where = p.endsWith("/reply") ? `repos/${owner}/${repo}/pulls/${number}/comments/${to}/replies` : `repos/${owner}/${repo}/issues/${number}/comments`;
        try {
          // --input, not -f body=…: gh reads a value starting with @ as a file
          const posted = JSON.parse(await run(["gh", "api", "--method", "POST", where, "--input", "-"], { input: JSON.stringify({ body }) }));
          s.conversation = undefined;
          if (p.endsWith("/reply")) { // a reply is a review comment too: it shows on its line in the other views
            const discussion = await reviewComments(pr(), true).catch(() => null);
            if (discussion) { for (const g of [s.staticGraph, s.claudeGraph]) if (g) setDiscussion(g, discussion); s.discussionAt = Date.now(); }
          }
          return json({ ok: true, url: posted.html_url });
        } catch (e) {
          return json({ ok: false, error: String((e as Error).message) }, 400);
        }
      }
      // Edit or delete a comment already on GitHub (yours, as GitHub allows): a review comment on a line ("review") or
      // a comment on the PR ("issue"). At once, as on GitHub; the inline discussion is then read again.
      if (req.method === "POST" && (p === "/api/posted/edit" || p === "/api/posted/delete")) {
        const { kind, id, body } = (await req.json().catch(() => ({}))) as { kind?: unknown; id?: unknown; body?: unknown };
        const edit = p.endsWith("/edit");
        if ((kind !== "review" && kind !== "issue") || typeof id !== "string" || !/^\d+$/.test(id)) return json({ ok: false, error: "kind must be review or issue, and id a comment's id" }, 400);
        if (edit && (typeof body !== "string" || !body.trim())) return json({ ok: false, error: "Nothing to save: delete it instead" }, 400);
        if (pr().provider === "local") return json({ ok: false, error: "This is a local review with no PR." }, 400);
        const { owner, repo } = pr();
        const where = `repos/${owner}/${repo}/${kind === "review" ? "pulls" : "issues"}/comments/${id}`;
        try {
          await run(["gh", "api", "--method", edit ? "PATCH" : "DELETE", where, ...(edit ? ["--input", "-"] : [])], edit ? { input: JSON.stringify({ body }) } : {});
          s.conversation = undefined;
          if (kind === "review") {
            const discussion = await reviewComments(pr(), true).catch(() => null);
            if (discussion) { for (const g of [s.staticGraph, s.claudeGraph]) if (g) setDiscussion(g, discussion); s.discussionAt = Date.now(); }
          }
          return json({ ok: true, comments: s.staticGraph.discussion ?? [], outdated: s.staticGraph.outdated ?? [] });
        } catch (e) {
          const msg = String((e as Error).message);
          if (/\b(403|404)\b|not accessible|forbidden/i.test(msg)) return json({ ok: false, error: `GitHub won't let you ${edit ? "edit" : "delete"} it: only its author (or a repo admin) can` }, 403);
          return json({ ok: false, error: msg }, 400);
        }
      }
      // What changed since your last review of this PR: its commit, if the head has moved on from it and it's still in
      // the PR's history (a force-push can drop it), how many commits since, and the review of just those to open.
      if (p === "/api/since" && req.method === "GET") {
        const { owner, repo, number, headSha, url: prUrl } = pr();
        if (pr().provider === "local" || pr().commit || !s.cwd) return json({ ok: true, since: null });
        if (s.since?.head === headSha) return json({ ok: true, since: s.since.value });
        try {
          const me = await whoAmI(join(home(), "cache", "me.json"));
          if (!me) return json({ ok: true, since: null });
          const out = await run(["gh", "api", "--paginate", `repos/${owner}/${repo}/pulls/${number}/reviews?per_page=100`, "--jq", `.[] | select(.user.login == "${me.login}" and .state != "PENDING") | {sha: .commit_id, at: .submitted_at}`]);
          const last = out.split("\n").filter((l) => l.startsWith("{")).map((l) => JSON.parse(l) as { sha: string; at: string }).sort((a, b) => a.at.localeCompare(b.at)).at(-1);
          let value: { sha: string; at: string; commits: number; arg: string } | null = null;
          if (last && last.sha !== headSha && (await Bun.spawn(["git", "merge-base", "--is-ancestor", last.sha, headSha], { cwd: s.cwd, stderr: "ignore" }).exited) === 0) {
            const commits = Number((await git(s.cwd, ["rev-list", "--count", `${last.sha}..${headSha}`], true)).trim()) || 0;
            if (commits) value = { sha: last.sha, at: last.at, commits, arg: `${prUrl}/changes/${last.sha}..${headSha}` };
          }
          s.since = { head: headSha, value };
          return json({ ok: true, since: value });
        } catch (e) {
          return json({ ok: false, error: String((e as Error).message) }, 400);
        }
      }
      // GitHub's Viewed checkboxes on the PR's files: read them (VIEWED, UNVIEWED, or DISMISSED: viewed, then changed),
      // or tick or clear one, at once. The page keeps them in step with its own viewed files.
      if (p === "/api/viewed") {
        if (pr().provider === "local" || pr().commit) return json({ ok: false, error: "Only a whole PR has GitHub's Viewed checkboxes." }, 400);
        const { owner, repo, number } = pr();
        try {
          if (req.method === "GET") {
            const files: Record<string, string> = {};
            for (let after = "", k = 0; k < 30; k++) {
              const out = JSON.parse(await run(["gh", "api", "graphql", "-f", `query=query($owner: String!, $repo: String!, $n: Int!, $after: String) { repository(owner: $owner, name: $repo) { pullRequest(number: $n) { id files(first: 100, after: $after) { pageInfo { hasNextPage endCursor } nodes { path viewerViewedState } } } } }`,
                "-F", `owner=${owner}`, "-F", `repo=${repo}`, "-F", `n=${number}`, ...(after ? ["-f", `after=${after}`] : [])]));
              const pull = out.data.repository.pullRequest;
              s.prNode = pull.id;
              for (const f of pull.files.nodes) files[f.path] = f.viewerViewedState;
              if (!pull.files.pageInfo.hasNextPage) break;
              after = pull.files.pageInfo.endCursor;
            }
            return json({ ok: true, files });
          }
          const { path, viewed } = (await req.json().catch(() => ({}))) as { path?: unknown; viewed?: unknown };
          if (typeof path !== "string" || !path || typeof viewed !== "boolean") return json({ ok: false, error: "path must be a file's path, and viewed true or false" }, 400);
          s.prNode ??= (await run(["gh", "api", `repos/${owner}/${repo}/pulls/${number}`, "--jq", ".node_id"])).trim();
          const op = viewed ? "markFileAsViewed" : "unmarkFileAsViewed";
          await run(["gh", "api", "graphql", "-f", `query=mutation($id: ID!, $path: String!) { ${op}(input: { pullRequestId: $id, path: $path }) { clientMutationId } }`, "-f", `id=${s.prNode}`, "-f", `path=${path}`]);
          return json({ ok: true });
        } catch (e) {
          return json({ ok: false, error: String((e as Error).message) }, 400);
        }
      }
      // React to a comment (or the description, or a review), or take your reaction back, at once, as on GitHub. Answers
      // that thing's reactions now; an inline comment's are updated in the discussion too, so every view agrees.
      if (req.method === "POST" && p === "/api/react") {
        const { subject, content, on } = (await req.json().catch(() => ({}))) as { subject?: unknown; content?: unknown; on?: unknown };
        if (typeof subject !== "string" || !/^[\w-]+$/.test(subject) || typeof content !== "string" || !REACTION_KINDS.includes(content) || typeof on !== "boolean")
          return json({ ok: false, error: `subject must be a node id, content one of ${REACTION_KINDS.join(", ")}, and on true or false` }, 400);
        if (pr().provider === "local") return json({ ok: false, error: "This is a local review with no PR." }, 400);
        const op = on ? "addReaction" : "removeReaction";
        try {
          const out = JSON.parse(await run(["gh", "api", "graphql", "-f", `query=mutation($id: ID!, $c: ReactionContent!) { ${op}(input: { subjectId: $id, content: $c }) { subject { reactionGroups { content viewerHasReacted reactors { totalCount } } } } }`, "-f", `id=${subject}`, "-f", `c=${content}`]));
          const reactions = reactionsOf(out.data?.[op]?.subject?.reactionGroups);
          for (const g of [s.staticGraph, s.claudeGraph]) for (const c of g?.discussion ?? []) if (c.node === subject) { if (reactions.length) c.reactions = reactions; else delete c.reactions; }
          s.conversation = undefined;
          return json({ ok: true, reactions });
        } catch (e) {
          return json({ ok: false, error: String((e as Error).message) }, 400);
        }
      }
      // Resolve or unresolve a review thread, at once, as GitHub's button does; every view then reads it from the graph
      if (req.method === "POST" && p === "/api/thread") {
        const { thread, resolved } = (await req.json().catch(() => ({}))) as { thread?: unknown; resolved?: unknown };
        if (typeof thread !== "string" || !/^[\w-]+$/.test(thread) || typeof resolved !== "boolean") return json({ ok: false, error: "thread must be a review thread's node id, and resolved true or false" }, 400);
        if (pr().provider === "local") return json({ ok: false, error: "This is a local review with no PR, so no threads to resolve." }, 400);
        const op = resolved ? "resolveReviewThread" : "unresolveReviewThread";
        try {
          await run(["gh", "api", "graphql", "-f", `query=mutation($id: ID!) { ${op}(input: { threadId: $id }) { thread { isResolved } } }`, "-f", `id=${thread}`]);
          s.conversation = undefined;
          const discussion = await reviewComments(pr(), true).catch(() => null);
          if (discussion) { for (const g of [s.staticGraph, s.claudeGraph]) if (g) setDiscussion(g, discussion); s.discussionAt = Date.now(); }
          return json({ ok: true, comments: s.staticGraph.discussion ?? [], outdated: s.staticGraph.outdated ?? [] });
        } catch (e) {
          const msg = String((e as Error).message);
          // GitHub lets the PR's author and anyone with write access resolve
          if (/not accessible|permission|forbidden/i.test(msg)) return json({ ok: false, error: `only the PR's author or someone with write access to ${pr().owner}/${pr().repo} can resolve its threads` }, 403);
          return json({ ok: false, error: msg }, 400);
        }
      }
      // How far you've got, for recents on the home page (the page counts pages; drafts are counted here)
      if (req.method === "POST" && p === "/api/progress") {
        const { done, total } = (await req.json()) as { done: number; total: number };
        if (s.id && Number.isInteger(done) && Number.isInteger(total)) void noteRecent({ id: s.id, progress: { done, total }, drafts: s.state.comments.filter((c) => !c.wip && c.kind !== "note").length });
        return json({ ok: true });
      }
      // Move the review to the new work watch.ts noticed; the page then reads the new graph
      if (req.method === "POST" && p === "/api/refresh") {
        if (!s.rebuild || !s.update?.refresh) return json({ ok: false, error: "nothing new to refresh to" }, 400);
        if (s.rebuilding) return json({ ok: false, error: "already refreshing" }, 409);
        s.rebuilding = true;
        try { await s.rebuild(); s.update = undefined; return json({ ok: true, headSha: s.staticGraph.pr.headSha }); }
        catch (e) { return json({ ok: false, error: String((e as Error).message ?? e) }, 500); }
        finally { s.rebuilding = false; }
      }
      // A language server: yes, install it; look again for what you installed yourself; not now, or never.
      if (req.method === "POST" && p.startsWith("/api/servers/")) {
        const { id, never } = (await req.json()) as { id: string; never?: boolean };
        if (!s.servers?.[id]) return json({ error: "no such server in this review" }, 404);
        const act = p.slice("/api/servers/".length);
        if (act === "install") void installServer(s, id); // in the background: its state says how it's going
        // looking again is quick, but a server found then starts and loads: answer once it's past the looking
        else if (act === "check") await Promise.race([recheckServer(s, id), Bun.sleep(2000)]);
        else if (act === "decline") declineServer(s, id, !!never);
        else return json({ error: "not found" }, 404);
        return json({ servers: Object.values(s.servers) });
      }
      // Agent-assisted review: Claude's findings, on the diff's lines, until you draft or dismiss each one.
      if (p === "/api/agent" && req.method === "GET") return json({ ...agentStatus(s), review: s.state.agent?.headSha === pr().headSha ? s.state.agent : null });
      if (req.method === "POST" && p === "/api/agent/start") {
        if (!s.cwd) return json({ ok: false, error: "There's no local clone to read the code from" }, 400);
        if (s.agentJob && !s.agentJob.done) return json({ ok: true });
        const { focus } = (await req.json().catch(() => ({}))) as { focus?: unknown }; // what you asked Claude to look at
        const job: AgentJob = (s.agentJob = { steps: [], startedAt: Date.now(), ...(typeof focus === "string" && focus.trim() ? { focus: focus.trim().slice(0, 2000) } : {}) });
        const g = s.claudeGraph ?? s.staticGraph, found: Array<Record<string, unknown>> = [];
        const tools = bobbyTools(s, app, g, (f) => found.push(f)), cwd = s.cwd; // each finding as Claude reports it
        void connectedFor(s, app, job).then((connected) => runAgentReview(cwd, g, job, (r) => { s.state.agent = r; persist(); }, job.focus, tools.config ? { config: tools.config, found: found as never } : undefined, connected)).finally(tools.close);
        return json({ ok: true });
      }
      if (req.method === "POST" && p === "/api/agent/cancel") {
        if (s.agentJob && !s.agentJob.done) { s.agentJob.error = "Stopped"; s.agentJob.proc?.kill(); }
        return json({ ok: true });
      }
      if (req.method === "POST" && p === "/api/agent/finding") {
        const { id, act, body } = (await req.json()) as { id: string; act: "draft" | "dismiss" | "restore"; body?: string }; // body: as you edited it
        const f = s.state.agent?.findings.find((x) => x.id === id);
        if (!f) return json({ ok: false, error: "no such finding" }, 404);
        let comment: Comment | undefined;
        if (act === "draft" && f.status === "open") {
          comment = { ...draftOf(f, pr()), ...(typeof body === "string" && body.trim() ? { body: refsForGitHub(body.trim(), pr()) } : {}), id: crypto.randomUUID().slice(0, 8) };
          s.state.comments.push(comment);
          Object.assign(f, { status: "drafted", draftId: comment.id });
        } else if (act === "dismiss") f.status = "dismissed";
        else if (act === "restore" && f.status === "dismissed") f.status = "open";
        persist();
        return json({ ok: true, review: s.state.agent, ...(comment ? { comment } : {}) });
      }

      // Asking Claude about some lines: the questions on this head, with the answer so far of one being answered.
      if (p === "/api/asks" && req.method === "GET") return json({ asks: (s.state.asks ?? []).filter((a) => a.headSha === pr().headSha).map((a) => askView(s, a)) });
      if (req.method === "POST" && p === "/api/ask") {
        if (!s.cwd) return json({ ok: false, error: "There's no local clone to read the code from" }, 400);
        const b = (await req.json()) as Partial<Ask> & { id?: string; question?: string };
        const q = typeof b.question === "string" ? b.question.trim().slice(0, 4000) : "";
        if (!q) return json({ ok: false, error: "Ask something" }, 400);
        let ask = b.id ? s.state.asks?.find((a) => a.id === b.id) : undefined;
        if (b.id && !ask) return json({ ok: false, error: "no such question" }, 404);
        if (ask && s.askJobs?.get(ask.id)?.done === false) return json({ ok: false, error: "Claude is still answering" }, 409);
        if (!ask) {
          if (typeof b.path !== "string" || !Number.isInteger(b.line)) return json({ ok: false, error: "path and line are needed" }, 400);
          ask = { id: crypto.randomUUID().slice(0, 8), headSha: pr().headSha, path: b.path, side: b.side === "LEFT" ? "LEFT" : "RIGHT", line: b.line!, ...(b.startLine && b.startLine < b.line! ? { startLine: b.startLine } : {}), turns: [] };
          (s.state.asks ??= []).push(ask);
        }
        ask.turns.push({ q, at: new Date().toISOString() });
        persist();
        const job = { steps: [], startedAt: Date.now() } as AgentJob & { text?: string };
        (s.askJobs ??= new Map()).set(ask.id, job);
        const g = s.claudeGraph ?? s.staticGraph, tools = bobbyTools(s, app, g), cwd = s.cwd, asked = ask;
        void connectedFor(s, app, job).then((connected) => runAsk(cwd, g, asked, job, persist, tools.config, connected)).finally(tools.close);
        return json({ ok: true, ask: askView(s, ask) });
      }
      if (req.method === "POST" && p === "/api/ask/stop") {
        const { id } = (await req.json()) as { id: string };
        const job = s.askJobs?.get(id);
        if (job && !job.done) { job.error = "Stopped"; job.proc?.kill(); }
        return json({ ok: true });
      }
      if (req.method === "DELETE" && p.startsWith("/api/ask/")) {
        const id = p.split("/").pop()!;
        const job = s.askJobs?.get(id);
        if (job && !job.done) { job.error = "Stopped"; job.proc?.kill(); }
        s.askJobs?.delete(id);
        s.state.asks = (s.state.asks ?? []).filter((a) => a.id !== id);
        persist();
        return json({ ok: true });
      }

      // Your own tools for Claude (connected.ts): what you have, and what this PR lets it use.
      if (p === "/api/agent/tools" && req.method === "GET") {
        const servers = await catalog(url.searchParams.has("fresh")).catch((e) => ({ error: String((e as Error).message ?? e) }));
        if ("error" in servers) return json({ ok: false, error: `Couldn't read your Claude Code setup: ${servers.error}` }, 500);
        const launch = resolveSpec(parseSpec(app.agentTools), servers);
        return json({ ok: true, servers: servers.map((v) => ({ name: v.name, status: v.status, read: v.read.length, write: v.write.length })),
          selection: s.state.agentTools ?? launch, source: s.state.agentTools ? "pr" : "launch", launch, spec: app.agentTools ?? "" });
      }
      if (req.method === "POST" && p === "/api/agent/tools") {
        const { selection } = (await req.json()) as { selection: Selection | null }; // null: back to the launch default
        if (selection === null) delete s.state.agentTools;
        else if (selection && typeof selection === "object") s.state.agentTools = Object.fromEntries(Object.entries(selection).filter(([, v]) => v === "read" || v === "all")) as Selection;
        persist();
        return json({ ok: true });
      }

      if (p === "/api/definitions") return json(s.definitions ?? s.staticGraph.definitions ?? {});

      // The inspector: where the name at path:line:col (head side) is declared. The language server once it's loaded;
      // until then, or without one, what extraction stored and the syntax tree at head.
      // Every use of the name at path:line:col (head side), each with its line, for the inspector's list. The file's
      // language server once it's loaded; until then, or without one, the syntax tree and imports.
      if (p === "/api/references") {
        const path = url.searchParams.get("path") ?? "", line = Number(url.searchParams.get("line")), col = Number(url.searchParams.get("col"));
        if (!insideRepo(path) || !Number.isInteger(line) || !Number.isInteger(col)) return json({ error: "a repo-relative path, a line and a column" }, 400);
        const server = serverInfoFor(s, path), state = { pending: server?.state === "pending" || server?.state === "installing", ...(server ? { server } : {}) };
        const changed = pr().provider === "local" && !!s.cwd && (await changedSince(s.cwd, pr().headSha, path));
        const insp = inspectorFor(s, path);
        let uses: Uses | null = insp && !changed ? await insp.references(path, line, col).catch(() => null) : null;
        if (!uses && s.cwd) {
          s.repo ??= Repo.open(s.cwd, pr().headSha);
          uses = await referencesSyntax(await s.repo, s.cwd, pr().headSha, path, line, col).catch(() => null);
        }
        if (!uses) return json({ refs: [], total: 0, via: "none", ...state });
        const MAX = 500, refs = uses.refs.slice(0, MAX), lines = new Map<string, string[]>();
        if (s.cwd) await fileLinesMany(s.cwd, pr().headSha, refs.map((r) => r.path)).catch(() => {}); // in one git process
        for (const r of refs) if (!lines.has(r.path)) lines.set(r.path, s.cwd ? await fileLines(s.cwd, pr().headSha, r.path).catch(() => []) : []);
        const out = refs.map((r) => ({ ...r, text: (lines.get(r.path)?.[r.line - 1] ?? "").slice(0, 400), scope: scopeAt(lines.get(r.path) ?? [], r.line) }));
        return json({ name: uses.name, refs: out, total: uses.refs.length, via: uses.via, ...state, ...(changed ? { changed } : {}) });
      }
      if (p === "/api/inspect") {
        const path = url.searchParams.get("path") ?? "", line = Number(url.searchParams.get("line")), col = Number(url.searchParams.get("col"));
        if (!insideRepo(path) || !Number.isInteger(line) || !Number.isInteger(col)) return json({ error: "a repo-relative path, a line and a column" }, 400);
        const server = serverInfoFor(s, path), state = { pending: server?.state === "pending" || server?.state === "installing", ...(server ? { server } : {}) };
        // A local review's diff is a snapshot of your working copy; the server reads the live files. Once a file has
        // changed, its lines no longer match what you're reading, so the server isn't asked about it.
        const changed = pr().provider === "local" && !!s.cwd && (await changedSince(s.cwd, pr().headSha, path));
        // Where it's declared, without the server: what extraction stored, else the syntax tree at head.
        const syntax = async () => {
          const d = (s.definitions ?? s.staticGraph.definitions ?? {})[path]?.find((x) => x.line === line && col >= x.col && col < x.col + x.len);
          if (d?.to || d?.ext) return { name: d.name, to: d.to, ext: d.ext, via: d.via ?? ("syntax" as const) };
          if (!s.cwd) return null;
          s.repo ??= Repo.open(s.cwd, pr().headSha);
          return inspectSyntax(await s.repo, path, line, col).catch(() => null);
        };
        const insp = inspectorFor(s, path);
        if (insp && !changed) {
          const r = await insp.inspect(path, line, col).catch(() => null);
          if (r?.to || r?.ext) return json({ ...r, ...state });
          if (r?.hover) { const d = await syntax(); return json({ ...(d?.to || d?.ext ? d : {}), ...r, via: d?.to || d?.ext ? d.via : r.via, ...state }); } // a type, and where imports say it is
        }
        return json({ ...((await syntax()) ?? { via: "none" }), ...state, ...(changed ? { changed } : {}) });
      }

      if (p === "/api/settings" && req.method === "POST") {
        const next = { ...loadSettings(), ...((await req.json()) as object) };
        saveSettings(next);
        return json(next);
      }

      if (p === "/api/file") {
        if (!s.cwd) return json({ error: "no local clone" }, 404);
        const sha = url.searchParams.get("side") === "base" ? pr().baseSha : pr().headSha;
        const lines = await fileLines(s.cwd, sha, url.searchParams.get("path") ?? "");
        return json({ lines });
      }

      if (req.method === "POST" && p === "/api/mark") {
        const { keys, mark } = (await req.json()) as { keys: string[]; mark: "reviewed" | "flagged" | null };
        for (const k of keys) mark ? (s.state.marks[k] = mark) : delete s.state.marks[k];
        persist();
        return json({ ok: true });
      }
      if (req.method === "POST" && p === "/api/position") {
        const pos = (await req.json()) as { nodeId: string; level?: number };
        s.state.lastNodeId = pos.nodeId;
        if (typeof pos.level === "number") s.state.lastLevel = pos.level;
        s.state.lastSeenAt = new Date().toISOString();
        persist();
        return json({ ok: true });
      }
      if (req.method === "POST" && p === "/api/note") {
        s.state.note = ((await req.json()) as { note: string }).note;
        persist();
        return json({ ok: true });
      }
      if (req.method === "POST" && p === "/api/comment") {
        const c = { ...((await req.json()) as Omit<Comment, "id">), id: crypto.randomUUID().slice(0, 8) };
        s.state.comments.push(c);
        persist();
        return json(c);
      }
      if (req.method === "DELETE" && p.startsWith("/api/comment/")) {
        const id = p.split("/").pop();
        s.state.comments = s.state.comments.filter((c) => c.id !== id);
        persist();
        return json({ ok: true });
      }

      // Private notes: kept in the state file only, never sent to GitHub.
      if (req.method === "POST" && p === "/api/notes") {
        const { body, path, line, side, startLine, startSide } = (await req.json()) as Omit<PrivateNote, "id" | "createdAt">;
        const n: PrivateNote = { id: crypto.randomUUID().slice(0, 8), body, createdAt: new Date().toISOString(), ...(path ? { path } : {}), ...(line ? { line, side } : {}), ...(line && startLine ? { startLine, startSide } : {}) };
        (s.state.notes ??= []).push(n);
        persist();
        return json(n);
      }
      if (req.method === "DELETE" && p.startsWith("/api/notes/")) {
        const id = p.split("/").pop();
        s.state.notes = (s.state.notes ?? []).filter((n) => n.id !== id);
        persist();
        return json({ ok: true });
      }

      if (req.method === "POST" && p === "/api/submit") {
        const { event, body = "" } = (await req.json().catch(() => ({}))) as { event?: string; body?: unknown };
        if (!["COMMENT", "APPROVE", "REQUEST_CHANGES"].includes(event ?? "") || typeof body !== "string") return json({ ok: false, error: "event must be COMMENT, APPROVE or REQUEST_CHANGES, and body a string" }, 400);
        if (pr().provider === "local") return json({ ok: false, error: "This is a local review with no PR, so there's nowhere to post. Your drafts stay here." }, 400);
        const ready = s.state.comments.filter((c) => !c.wip && c.kind !== "note"); // unfinished drafts stay behind
        // A draft made on an earlier head may sit on a line the diff no longer has; GitHub would refuse the whole
        // review for it. Lines of the current diff, by side: those that aren't go into the summary instead.
        // Reviewing one commit, GitHub still anchors comments to the PR's diff at that commit (merge-base to it), not to
        // the commit's own: only lines the commit added are sure to be in both, so only those go inline.
        const one = !!pr().commit;
        const lines = new Set(s.staticGraph.hunks.flatMap((h) => h.lines.flatMap((l) => one ? (l.t === "+" ? [`${h.file}:RIGHT:${l.n}`] : []) : [
          ...(l.n != null && l.t !== "-" ? [`${h.file}:RIGHT:${l.n}`] : []), ...(l.o != null && l.t !== "+" ? [`${h.file}:LEFT:${l.o}`] : []),
        ])));
        const inDiff = (c: Comment) => c.inDiff && lines.has(`${c.path}:${c.side}:${c.line}`) && (!c.startLine || lines.has(`${c.path}:${c.startSide ?? c.side}:${c.startLine}`));
        const changed = new Set(s.staticGraph.files.map((f) => f.path));
        const done = (ids: string[]) => { if (!ids.length) return; s.state.comments = s.state.comments.filter((c) => !ids.includes(c.id)); persist(); };
        // Re-read the PR's comments so what was posted shows on its lines (and, if it failed halfway, what's now in your
        // pending review on GitHub); if that fails they show next start.
        const reread = async () => {
          const discussion = await reviewComments(pr(), true).catch(() => null);
          if (discussion) { for (const g of [s.staticGraph, s.claudeGraph]) if (g) setDiscussion(g, discussion); s.discussionAt = Date.now(); }
          return discussion ? { discussion: discussion.comments, outdated: discussion.outdated, pending: discussion.pending ?? null } : {};
        };
        try {
          const url = await submitReview({ pr: pr(), event: event as ReviewEvent, body, drafts: ready, inDiff, inPr: (path) => changed.has(path), done });
          log.info(`  ✓ posted your review (${event}, ${ready.length} comment${ready.length === 1 ? "" : "s"}): ${url}`);
          return json({ ok: true, url, ...(await reread()) });
        } catch (e) {
          return json({ ok: false, error: String((e as Error).message), comments: s.state.comments, ...(await reread()) }, 400);
        }
      }

      return json({ error: "not found" }, 404);
    }
  }
}

/** Where an agent-assisted review stands, for the top bar: running (and what it's doing), or its open findings. */
function agentStatus(s: Session) {
  const job = s.agentJob, r = s.state.agent?.headSha === s.staticGraph.pr.headSha ? s.state.agent : undefined;
  return { running: !!job && !job.done, step: job && !job.done ? job.steps.at(-1) ?? "Starting" : undefined, steps: job && !job.done ? job.steps.slice(-6) : undefined, focus: job && !job.done ? job.focus : undefined,
    error: job?.done ? job.error : undefined,
    at: r?.at, open: r?.findings.filter((f) => f.status === "open").length ?? 0 };
}

/** An ask as the page shows it: while its answer is on its way, what Claude is doing and what it has written. */
function askView(s: Session, a: Ask) {
  const job = s.askJobs?.get(a.id);
  return job && !job.done ? { ...a, running: true, step: job.steps.at(-1) ?? "Starting", partial: job.text ?? "" } : a;
}

/** Bobby's tools for one run of Claude on this review (mcp.ts): the MCP config to hand it, and the end of its token.
 *  The tools call this review's API in process, so they answer as the page's inspector and viewer do. */
function bobbyTools(s: Session, app: App, g: ReviewGraph, report?: (f: Record<string, unknown>) => number): { config?: string; close: () => void } {
  if (!app.self || !s.cwd) return { close: () => {} };
  const api = async (path: string) => {
    const url = new URL(path, "http://127.0.0.1");
    return (await reviewApi(s, app, new Request(url), url, url.pathname)).json().catch(() => null);
  };
  const { token, close } = openMcp({ g, cwd: s.cwd, api, ...(report ? { report } : {}) });
  return { config: mcpConfig(`${app.self}/mcp/${token}`), close };
}

/** This PR's choice of your own tools for Claude (else the launch default), as Claude's flags: null when nothing's
 *  on, without asking Claude Code what you have. */
async function connectedFor(s: Session, app: App, job: AgentJob): Promise<Connected | null> {
  const spec = parseSpec(app.agentTools);
  if (s.state.agentTools ? !Object.keys(s.state.agentTools).length : !spec.length) return null;
  job.steps.push("Connecting your tools");
  const servers = await catalog().catch(() => null);
  if (!servers) return null;
  return runWith(s.state.agentTools ?? resolveSpec(spec, servers), servers);
}
