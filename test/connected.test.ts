import { expect, test } from "bun:test";
import { catalogOf, parseSpec, readsOnly, resolveSpec, runWith } from "../src/connected.ts";

test("tells reading tools from the rest, by name", () => {
  for (const t of ["get_issue", "list_issues", "slack_search_public", "slack_read_thread", "notion-fetch", "notion-get-comments", "search_datadog_logs", "getIssue"]) expect(readsOnly(t)).toBe(true);
  for (const t of ["save_issue", "slack_send_message", "notion-create-pages", "delete_comment", "get_and_update", "exec", "click", "merge_diff"]) expect(readsOnly(t)).toBe(false);
});

const servers = catalogOf({
  mcp_servers: [{ name: "claude.ai Linear", status: "connected" }, { name: "claude.ai Slack", status: "connected" }, { name: "chrome-devtools", status: "connected" }],
  tools: ["Read", "mcp__claude_ai_Linear__get_issue", "mcp__claude_ai_Linear__save_issue", "mcp__claude_ai_Slack__slack_read_thread", "mcp__claude_ai_Slack__slack_send_message", "mcp__chrome-devtools__click"],
});
test("groups your tools by server", () => {
  expect(servers.map((s) => [s.name, s.read.length, s.write.length])).toEqual([["claude.ai Linear", 1, 1], ["claude.ai Slack", 1, 1], ["chrome-devtools", 0, 1]]);
});
test("reads the launch spec", () => {
  expect(resolveSpec(parseSpec("linear, slack:all"), servers)).toEqual({ "claude.ai Linear": "read", "claude.ai Slack": "all" });
  expect(resolveSpec(parseSpec(""), servers)).toEqual({});
});
test("lets in only what's chosen: a server's reads, or all of it", () => {
  expect(runWith({}, servers)).toBeNull();
  const c = runWith({ "claude.ai Linear": "read", "claude.ai Slack": "all" }, servers)!;
  expect(c.args).toEqual(["--setting-sources", "user", "--settings", '{"disableAllHooks":true}']);
  expect(c.disallowed).toEqual(["mcp__chrome-devtools", "mcp__claude_ai_Linear__save_issue"]);
  expect(c.allowed).toEqual(["mcp__claude_ai_Linear__get_issue", "mcp__claude_ai_Slack"]);
  expect(c.note).toContain("claude.ai Linear (read only), claude.ai Slack (full access)");
});
test("blocks a read-only server whose tools aren't known yet", () => {
  const slow = catalogOf({ mcp_servers: [{ name: "claude.ai Datadog", status: "pending" }], tools: [] });
  expect(runWith({ "claude.ai Datadog": "read" }, slow)!.disallowed).toEqual(["mcp__claude_ai_Datadog"]);
});
