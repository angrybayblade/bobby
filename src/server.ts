import { join, normalize } from "node:path";
import { fileLines, run } from "./git.ts";
import type { ReviewGraph } from "./graph.ts";
import { loadSettings, saveSettings, saveState } from "./state.ts";
import type { Comment, PrivateNote, ReviewState } from "./types.ts";

export interface Session {
  cwd: string | null; // local clone; null when viewing a graph file without one
  staticGraph: ReviewGraph;
  claudeGraph?: ReviewGraph;
  state: ReviewState;
  llm: "pending" | "done" | "failed" | "off";
  llmError?: string;
}

const PUBLIC = join(import.meta.dir, "..", "public");
const json = (v: unknown, status = 200) => Response.json(v, { status });

export function startServer(s: Session, port: number) {
  const pr = () => s.staticGraph.pr;
  const persist = () => saveState({ owner: pr().owner, repo: pr().repo, number: pr().number }, s.state);

  return Bun.serve({
    port,
    hostname: "127.0.0.1",
    async fetch(req) {
      const url = new URL(req.url);
      const p = url.pathname;

      if (!p.startsWith("/api/")) {
        const rel = normalize(p === "/" ? "index.html" : p.slice(1));
        if (rel.startsWith("..")) return new Response("Not found", { status: 404 });
        const file = Bun.file(join(PUBLIC, rel));
        return (await file.exists()) ? new Response(file) : new Response("Not found", { status: 404 });
      }

      if (p === "/api/graph") {
        const want = url.searchParams.get("tree");
        return json(want === "static" ? s.staticGraph : (s.claudeGraph ?? s.staticGraph));
      }
      if (p === "/api/session")
        return json({ state: s.state, settings: loadSettings(), llm: s.llm, llmError: s.llmError, caps: { files: !!s.cwd } });
      if (p === "/api/status") return json({ llm: s.llm, llmError: s.llmError, claudeReady: !!s.claudeGraph });

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
        const { body, path, line, side } = (await req.json()) as Omit<PrivateNote, "id" | "createdAt">;
        const n: PrivateNote = { id: crypto.randomUUID().slice(0, 8), body, createdAt: new Date().toISOString(), ...(path ? { path } : {}), ...(line ? { line, side } : {}) };
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
        const outside = s.state.comments.filter((c) => !c.inDiff);
        const fullBody = [
          body.trim(),
          outside.length ? "**Notes on code this PR doesn't touch**\n" + outside.map((c) => `- \`${c.path}:${c.line}\`: ${c.body}`).join("\n") : "",
        ].filter(Boolean).join("\n\n");
        const payload = {
          commit_id: pr().headSha,
          event,
          body: fullBody,
          comments: s.state.comments.filter((c) => c.inDiff).map(({ path, line, side, body }) => ({ path, line, side, body })),
        };
        try {
          const out = await run(
            ["gh", "api", "--method", "POST", `repos/${pr().owner}/${pr().repo}/pulls/${pr().number}/reviews`, "--input", "-"],
            { input: JSON.stringify(payload) },
          );
          s.state.comments = [];
          persist();
          return json({ ok: true, url: JSON.parse(out).html_url });
        } catch (e) {
          return json({ ok: false, error: String((e as Error).message) }, 400);
        }
      }

      return json({ error: "not found" }, 404);
    },
  });
}
