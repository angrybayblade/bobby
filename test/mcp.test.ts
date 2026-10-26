import { expect, test } from "bun:test";
import { handleMcp, openMcp } from "../src/mcp.ts";
import type { ReviewGraph } from "../src/graph.ts";

const g = {
  pr: { title: "Add a cap", body: "Caps retries.", headSha: "H", baseSha: "B" }, intent: "Caps retries at 3.", generator: { tree: "static" }, cores: [],
  files: [{ path: "src/retry.ts", oldPath: "src/retry.ts", status: "modified", additions: 1, deletions: 1 }],
  hunks: [{ file: "src/retry.ts", header: "@@ -1,2 +1,2 @@", lines: [{ t: " ", o: 1, n: 1, s: "export function retry(n) {" }, { t: "-", o: 2, n: null, s: "  return loop(n)" }, { t: "+", o: null, n: 2, s: "  return loop(Math.min(n, 3))" }] }],
  discussion: [{ id: "1", path: "src/retry.ts", line: 2, side: "RIGHT", author: "ana", body: "Why 3?", createdAt: "2026-01-01" }, { id: "2", replyTo: "1", path: "src/retry.ts", line: 2, side: "RIGHT", author: "bo", body: "From the SLA.", createdAt: "2026-01-02", resolved: true }],
} as unknown as ReviewGraph;
const files: Record<string, string[]> = { head: ["export function retry(n) {", "  return loop(Math.min(n, 3))", "}", ""], base: ["export function retry(n) {", "  return loop(n)", "}", ""] };
const api = async (path: string) => {
  const u = new URL(path, "http://x");
  if (u.pathname === "/api/file") return u.searchParams.get("path") === "src/retry.ts" ? { lines: files[u.searchParams.get("side") === "base" ? "base" : "head"] } : { lines: [""] };
  if (u.pathname === "/api/inspect") return { to: { path: "src/loop.ts", line: 1 }, via: "lsp" };
  return null;
};
const { token, close } = openMcp({ g, cwd: "/nowhere", api });
const rpc = async (method: string, params: object = {}, id: number | null = 1) => {
  const r = await handleMcp(new Request("http://x/mcp", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ jsonrpc: "2.0", ...(id === null ? {} : { id }), method, params }) }), token);
  return r.status === 202 ? null : r.json();
};
const tool = async (name: string, args: object) => ((await rpc("tools/call", { name, arguments: args })) as any).result;

test("speaks MCP: initialize, tools, notifications", async () => {
  expect(((await rpc("initialize", { protocolVersion: "2025-06-18" })) as any).result.serverInfo.name).toBe("bobby");
  expect(await rpc("notifications/initialized", {}, null)).toBeNull();
  expect(((await rpc("tools/list")) as any).result.tools.map((t: { name: string }) => t.name)).toEqual(["pr_overview", "pr_diff", "read_file", "definition", "references", "review_threads", "history"]);
  expect(((await rpc("nope")) as any).error.code).toBe(-32601);
});
test("answers about the PR, before and after it", async () => {
  expect((await tool("pr_overview", {})).content[0].text).toContain("- src/retry.ts (modified, +1 −1)");
  expect((await tool("pr_diff", { path: "src/retry.ts" })).content[0].text).toContain("R2\t+  return loop(Math.min(n, 3))");
  expect((await tool("read_file", { path: "src/retry.ts" })).content[0].text).toContain("    2 +   return loop(Math.min(n, 3))");
  expect((await tool("read_file", { path: "src/retry.ts", side: "base" })).content[0].text).toContain("    2 -   return loop(n)");
  const threads = (await tool("review_threads", {})).content[0].text;
  expect(threads).toContain("## src/retry.ts:2 · resolved\nana: Why 3?\nbo: From the SLA.");
  expect((await tool("definition", { path: "src/retry.ts", line: 2, name: "loop" })).content[0].text).toContain("loop is declared at src/loop.ts:1");
});
test("says what's wrong instead of failing", async () => {
  expect((await tool("read_file", { path: "../etc/passwd" })).isError).toBe(true);
  expect((await tool("pr_diff", { path: "src/other.ts" })).content[0].text).toContain("isn't in the PR's diff");
  expect((await tool("definition", { path: "src/retry.ts", line: 2, name: "nothere" })).content[0].text).toContain("isn't on src/retry.ts:2");
});
test("answers only while its run lasts", async () => {
  close();
  expect((await handleMcp(new Request("http://x/mcp", { method: "POST", body: "{}" }), token)).status).toBe(404);
});
