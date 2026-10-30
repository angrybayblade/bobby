// bobby mcp: Bobby as an MCP server for your own agents (Claude Code, Cursor…), over stdio: `claude mcp add bobby -- bobby
// mcp`. It finds the Bobby app running on this machine (by its lock), or starts one in the background, and asks it over
// its API, so a review an agent opens is the one in your browser, with your progress in it. One tool for now:
// open_review.
import { spawn } from "node:child_process";
import { resolve as resolvePath } from "node:path";
import { answer, type Tool } from "./mcp.ts";
import { openCommand, runningApp } from "./running.ts";
import { run } from "./git.ts";
import { isBinary } from "./updates.ts";

const str = (description: string) => ({ type: "string", description });
const bool = (description: string) => ({ type: "boolean", description });
export const TOOLS: Tool[] = [
  { name: "open_review", description: "Open a GitHub pull request, or a local branch's changes, in Bobby (a focus-first PR reviewer running on this machine) and show it in the browser, for the user to review. Starts Bobby in the background if it isn't running. Bobby then builds the review, which takes a few seconds to a minute; its page shows the progress.",
    inputSchema: { type: "object", properties: {
      pr: str("The PR: its GitHub URL, owner/repo#number, or its number in the repository at `repo`. Leave it out to review the local branch's changes instead (its commits and uncommitted changes)."),
      repo: str("A folder with a git checkout: the PR's repository (default: the folder you work in, if it's one; else Bobby clones the repository), or, without `pr`, the branch to review."),
      base: str("Without `pr`: the branch to compare against (default: the branch's PR base, else the repository's default branch)."),
      show: bool("Show it in the browser (default true)."),
      ssh: bool("Clone over SSH, with the user's keys, if cloning over HTTPS failed. Only when the user has agreed to it."),
    } } },
];

/** The running Bobby app's address: the one already up, or one started now, in the background, on the home page. */
export async function ensureApp(): Promise<string> {
  const up = await runningApp();
  if (up) return up;
  const self = isBinary() ? [process.execPath] : [process.execPath, Bun.main]; // the compiled binary, or bun and cli.ts
  spawn(self[0], [...self.slice(1), "home", "--no-open"], { detached: true, stdio: "ignore", env: process.env }).unref();
  for (const until = Date.now() + 30_000; Date.now() < until;) {
    await Bun.sleep(300);
    const url = await runningApp();
    if (url) return url;
  }
  throw new Error("Started Bobby in the background, but it didn't come up within 30 s. `bobby logs` shows why.");
}

const show = (url: string) => run(openCommand(url), { allowFail: true }).then(() => true, () => false);

/** Runs a tool: its answer, as text for the agent. `app` finds (or starts) Bobby; `cwd` is the folder the agent works in. */
export async function runTool(name: string, a: Record<string, unknown>, o: { app: () => Promise<string>; cwd: string; show?: (url: string) => Promise<boolean> }): Promise<string> {
  if (name !== "open_review") throw new Error(`no tool ${name}`);
  const text = (v: unknown) => (typeof v === "string" && v.trim() ? v.trim() : undefined);
  const owned = text(a.pr)?.match(/^([\w.-]+)\/([\w.-]+)#(\d+)$/); // owner/repo#123, which the CLI doesn't take
  const pr = owned ? `https://github.com/${owned[1]}/${owned[2]}/pull/${owned[3]}` : text(a.pr), repo = text(a.repo) && resolvePath(o.cwd, text(a.repo)!);
  const url = await o.app();
  const r = await fetch(`${url}/api/open`, { method: "POST", headers: { "content-type": "application/json", origin: url },
    body: JSON.stringify({ arg: pr, repo: pr ? repo : repo ?? o.cwd, cwd: o.cwd, base: text(a.base), ...(a.ssh === true ? { ssh: true } : {}) }) });
  const out = (await r.json().catch(() => ({}))) as { id?: string; error?: string; setup?: string; ask?: string };
  const display = a.show === false ? async () => false : o.show ?? show;
  if (out.id) {
    const page = `${url}/r/${out.id}`, shown = await display(page);
    const loading = await fetch(`${page}/api/status`).then((s) => s.status === 202, () => true); // 202 while it builds
    return `Opened ${out.id} in Bobby${shown ? ", in the browser" : ""}: ${page}\n${loading ? "Bobby is building the review now; the page shows its progress." : "It's ready to review."}`;
  }
  if (out.setup === "gh" && pr) { // its page sets gh up, then opens the PR
    const page = `${url}/?open=${encodeURIComponent(pr)}`, shown = await display(page);
    return `GitHub's CLI isn't set up on this machine yet, so Bobby can't read the PR. Bobby's page (${page}${shown ? ", open in the browser" : ""}) walks the user through signing in, then opens it.`;
  }
  if (out.ask === "ssh") throw new Error(`${out.error}\nAsk the user whether to clone over SSH with their keys; if they agree, call open_review again with ssh: true.`);
  throw new Error(out.error ?? `Bobby at ${url} couldn't open it (HTTP ${r.status}).`);
}

/** Serves MCP over stdio, one JSON-RPC message a line, until stdin closes. Nothing else may reach stdout. */
export async function serveStdio(cwd = process.cwd()) {
  const o = { app: ensureApp, cwd };
  const reply = async (line: string) => {
    let body;
    try { body = JSON.parse(line); } catch { return write({ jsonrpc: "2.0", id: null, error: { code: -32700, message: "Parse error" } }); }
    const out = await answer(body, TOOLS, (name, a) => runTool(name, a, o));
    if (out) write(out);
  };
  const write = (m: unknown) => process.stdout.write(`${JSON.stringify(m)}\n`);
  const decoder = new TextDecoder();
  let buf = "";
  for await (const chunk of process.stdin) {
    buf += decoder.decode(chunk as Uint8Array, { stream: true });
    for (let i; (i = buf.indexOf("\n")) >= 0;) {
      const line = buf.slice(0, i).trim();
      buf = buf.slice(i + 1);
      if (line) void reply(line);
    }
  }
}
