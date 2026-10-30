import { afterAll, expect, test } from "bun:test";
import { answer } from "../src/mcp.ts";
import { runTool, TOOLS } from "../src/bridge.ts";

// a stand-in for the running Bobby: answers /api/open as the server would, by the PR asked for
const asked: any[] = [];
const fake = Bun.serve({ port: 0, async fetch(req) {
  if (new URL(req.url).pathname.endsWith("/api/status")) return new Response(null, { status: req.url.includes("local/") ? 200 : 202 });
  const body = await req.json();
  asked.push(body);
  if (body.arg?.endsWith("/9")) return Response.json({ error: "gh: not logged in", setup: "gh" }, { status: 400 });
  if (body.arg?.endsWith("/8")) return Response.json({ error: "cloning over HTTPS failed", ask: "ssh" }, { status: 400 });
  if (body.arg?.endsWith("/7")) return Response.json({ error: "no such PR" }, { status: 400 });
  return Response.json({ id: body.arg ? "acme/pay/1" : "local/pay/fix" });
} });
afterAll(() => fake.stop());
const url = `http://127.0.0.1:${fake.port}`, shown: string[] = [];
const o = { app: async () => url, cwd: "/work/pay", show: async (u: string) => (shown.push(u), true) };
const open = (a: object) => runTool("open_review", a as Record<string, unknown>, o);

test("opens a PR in the running Bobby, and shows it", async () => {
  expect(await open({ pr: "acme/pay#1" })).toContain(`Opened acme/pay/1 in Bobby, in the browser: ${url}/r/acme/pay/1`);
  expect(await open({ pr: "acme/pay#1" })).toContain("building the review now");
  expect(asked.at(-1)).toEqual({ arg: "https://github.com/acme/pay/pull/1", cwd: "/work/pay" });
  expect(shown.at(-1)).toBe(`${url}/r/acme/pay/1`);
});
test("without a PR, the branch in the folder the agent works in, or the one named", async () => {
  expect(await open({})).toContain("It's ready to review.");
  expect(asked.at(-1)).toEqual({ repo: "/work/pay", cwd: "/work/pay" });
  await open({ repo: "../other", base: "develop", show: false });
  expect(asked.at(-1)).toEqual({ repo: "/work/other", cwd: "/work/pay", base: "develop" });
});
test("says what to do when Bobby can't open it yet", async () => {
  expect(await open({ pr: "https://github.com/acme/pay/pull/9" })).toContain(`${url}/?open=${encodeURIComponent("https://github.com/acme/pay/pull/9")}`);
  await expect(open({ pr: "https://github.com/acme/pay/pull/8" })).rejects.toThrow("call open_review again with ssh: true");
  await expect(open({ pr: "https://github.com/acme/pay/pull/7" })).rejects.toThrow("no such PR");
});
test("speaks MCP: lists the tool, and a failure is the agent's to read", async () => {
  const run = (n: string, a: Record<string, unknown>) => runTool(n, a, o);
  expect(((await answer({ jsonrpc: "2.0", id: 1, method: "tools/list" }, TOOLS, run)) as any).result.tools[0].name).toBe("open_review");
  const r = (await answer({ jsonrpc: "2.0", id: 2, method: "tools/call", params: { name: "open_review", arguments: { pr: "https://github.com/acme/pay/pull/7" } } }, TOOLS, run)) as any;
  expect(r.result).toEqual({ content: [{ type: "text", text: "no such PR" }], isError: true });
});
