import { join, normalize } from "node:path";
import { embeddedAsset } from "./assets.ts";
import { fileLines, reviewComments, run, whoAmI } from "./git.ts";
import type { ReviewGraph } from "./graph.ts";
import { home, loadSettings, saveSettings, saveState } from "./state.ts";
import type { Comment, Definition, PrivateNote, ReviewState } from "./types.ts";
import { type Inspector, insideRepo, inspectSyntax, referencesSyntax, type Uses } from "./inspect.ts";
import { declineServer, inspectorFor, installServer, recheckServer, type ServerInfo, serverInfoFor } from "./servers.ts";
import { Repo } from "./resolve.ts";

export interface Session {
  cwd: string | null; // local clone; null when viewing a graph file without one
  staticGraph: ReviewGraph;
  claudeGraph?: ReviewGraph;
  state: ReviewState;
  llm: "pending" | "done" | "failed" | "off";
  llmError?: string;
  // Language servers, one per language in the review (servers.ts): where each stands, the running ones, and the
  // definitions with their answers merged in. root: the tree they read; log: where they report.
  servers?: Record<string, ServerInfo>;
  inspectors?: Record<string, Inspector>;
  root?: Promise<string>;
  log?: (m: string) => void;
  definitions?: Record<string, Definition[]>;
  repo?: Promise<Repo>; // the head commit's syntax, for the inspector without a language server
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

/** Whether a file in your working copy differs from the snapshot a local review was built from. */
async function changedSince(cwd: string, snapshot: string, path: string) {
  const live = await Bun.file(join(cwd, path)).text().catch(() => null);
  return live !== (await fileLines(cwd, snapshot, path)).join("\n");
}

/** Only Bobby's own page may use the server. A website you have open could otherwise post a review as you (a no-cors
 *  POST needs no preflight), and one that rebinds its name to 127.0.0.1 could read your code. So: the Host must be this
 *  server's own (defeats DNS rebinding), a request that changes something must come from this page's own Origin, and a
 *  POST must be JSON (which a foreign page can't send without a preflight, and the server answers none). */
function guard(req: Request, port: number): Response | null {
  const here = [`127.0.0.1:${port}`, `localhost:${port}`], host = req.headers.get("host") ?? "";
  if (!here.includes(host)) return new Response("Bobby only answers its own page (unexpected Host).", { status: 403 });
  if (req.method === "GET" || req.method === "HEAD") return null;
  const origin = req.headers.get("origin");
  if (origin && !here.some((h) => origin === `http://${h}`)) return new Response("Bobby only answers its own page (foreign Origin).", { status: 403 });
  if (req.method === "POST" && !(req.headers.get("content-type") ?? "").toLowerCase().startsWith("application/json"))
    return new Response("Bobby only takes JSON.", { status: 415 });
  return null;
}

export function startServer(s: Session, port: number) {
  const pr = () => s.staticGraph.pr;
  const persist = () => saveState({ owner: pr().owner, repo: pr().repo, number: pr().number, branch: pr().branch }, s.state);

  return Bun.serve({
    port,
    hostname: "127.0.0.1",
    async fetch(req, server) {
      const url = new URL(req.url);
      const p = url.pathname;
      const refused = guard(req, server.port);
      if (refused) return refused;

      if (!p.startsWith("/api/")) {
        const rel = normalize(p === "/" ? "index.html" : p.slice(1));
        if (rel.startsWith("..")) return new Response("Not found", { status: 404 });
        const asset = embeddedAsset(rel.split("\\").join("/"));
        if (asset) return new Response(asset.body, { headers: { "content-type": asset.type } });
        const file = Bun.file(join(PUBLIC, rel));
        return (await file.exists()) ? new Response(file) : new Response("Not found", { status: 404 });
      }

      if (p === "/api/graph") {
        const want = url.searchParams.get("tree");
        const g = want === "static" ? s.staticGraph : (s.claudeGraph ?? s.staticGraph);
        return json(s.definitions ? { ...g, definitions: s.definitions } : g); // the language server's, once it has answered
      }
      if (p === "/api/session")
        return json({ state: s.state, settings: loadSettings(), llm: s.llm, llmError: s.llmError, servers: Object.values(s.servers ?? {}), me: await whoAmI(join(home(), "cache", "me.json")), caps: { files: !!s.cwd, inspect: !!s.cwd } });
      // A GitHub avatar, fetched once and kept a week in ~/.bobby/cache/avatars. Only GitHub's own avatar hosts.
      if (p === "/api/avatar") return avatar(url.searchParams.get("u") ?? "");
      if (p === "/api/status") return json({ llm: s.llm, llmError: s.llmError, claudeReady: !!s.claudeGraph, servers: Object.values(s.servers ?? {}) });
      // A language server: yes, install it; look again for what you installed yourself; not now, or never.
      if (req.method === "POST" && p.startsWith("/api/servers/")) {
        const { id, never } = (await req.json()) as { id: string; never?: boolean };
        if (!s.servers?.[id]) return json({ error: "no such server in this review" }, 404);
        const act = p.slice("/api/servers/".length);
        if (act === "install") void installServer(s, id); // in the background: its state says how it's going
        else if (act === "check") await recheckServer(s, id);
        else if (act === "decline") declineServer(s, id, !!never);
        else return json({ error: "not found" }, 404);
        return json({ servers: Object.values(s.servers) });
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
        const { event, body } = (await req.json()) as { event: "COMMENT" | "APPROVE" | "REQUEST_CHANGES"; body: string };
        if (pr().provider === "local") return json({ ok: false, error: "This is a local review with no PR, so there's nowhere to post. Your drafts stay here." }, 400);
        const ready = s.state.comments.filter((c) => !c.wip && c.kind !== "note"); // unfinished drafts stay behind
        const outside = ready.filter((c) => !c.inDiff);
        const fullBody = [
          body.trim(),
          outside.length ? "**Notes on code this PR doesn't touch**\n" + outside.map((c) => `- \`${c.path}:${c.startLine ? `${c.startLine}-` : ""}${c.line}\`: ${c.body}`).join("\n") : "",
        ].filter(Boolean).join("\n\n");
        const payload = {
          commit_id: pr().headSha,
          event,
          body: fullBody,
          // A range goes as start_line/start_side to line/side, as GitHub's multi-line review comments do.
          comments: ready.filter((c) => c.inDiff).map(({ path, line, side, body, startLine, startSide }) => ({ path, line, side, body, ...(startLine ? { start_line: startLine, start_side: startSide ?? side } : {}) })),
        };
        try {
          const out = await run(
            ["gh", "api", "--method", "POST", `repos/${pr().owner}/${pr().repo}/pulls/${pr().number}/reviews`, "--input", "-"],
            { input: JSON.stringify(payload) },
          );
          s.state.comments = s.state.comments.filter((c) => c.wip); // what was posted is gone; unfinished drafts remain
          persist();
          // Re-read the PR's comments so what was just posted shows on its lines; if that fails they show next start.
          const discussion = await reviewComments(pr(), true).catch(() => null);
          if (discussion) for (const g of [s.staticGraph, s.claudeGraph]) if (g) g.discussion = discussion;
          return json({ ok: true, url: JSON.parse(out).html_url, ...(discussion ? { discussion } : {}) });
        } catch (e) {
          return json({ ok: false, error: String((e as Error).message) }, 400);
        }
      }

      return json({ error: "not found" }, 404);
    },
  });
}
