// Setting up Claude Code, which Bobby asks for the change tree. Bobby works without it, so installing Bobby doesn't
// need it: the page offers it the first time. Installing runs Anthropic's own installer; signing in runs
// `claude auth login` with its paste-the-code flow, so it works on a remote machine too: the page shows the sign-in
// link, you open it in a tab, sign in, and paste the code it gives you back into the page.
import { existsSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import type { Subprocess } from "bun";
import { run } from "./git.ts";

const WINDOWS = process.platform === "win32";
/** Anthropic's installer, for this OS: it puts claude in ~/.local/bin. */
export const INSTALL = WINDOWS
  ? ["powershell", "-NoProfile", "-ExecutionPolicy", "Bypass", "-Command", "irm https://claude.ai/install.ps1 | iex"]
  : ["bash", "-c", "curl -fsSL https://claude.ai/install.sh | bash"];
export const INSTALL_TEXT = WINDOWS ? "irm https://claude.ai/install.ps1 | iex" : "curl -fsSL https://claude.ai/install.sh | bash";

/** The claude to run: on PATH, else where the installer puts it (a shell started before the install hasn't got it). */
export function claudeBin(): string | null {
  const onPath = Bun.which("claude");
  if (onPath) return onPath;
  const local = join(homedir(), ".local", "bin", WINDOWS ? "claude.exe" : "claude");
  return existsSync(local) ? local : null;
}

export interface ClaudeStatus {
  installed: boolean; version?: string;
  loggedIn: boolean; method?: string; email?: string; // how it's signed in: claude.ai, an API key…
  step: "idle" | "installing" | "login" | "verifying"; // what the setup is doing now
  url?: string; // the sign-in link, while signing in
  error?: string; // why the last step failed
  log?: string; // the installer's last lines, while it runs
  dismissed?: boolean; // "not now", for this run of Bobby
}

const job: { step: ClaudeStatus["step"]; url?: string; error?: string; log: string[]; dismissed?: boolean;
  login?: Subprocess<"pipe", "pipe", "pipe">; said?: () => string; // the running login, and what it has printed
} = { step: "idle", log: [] };

export async function claudeStatus(): Promise<ClaudeStatus> {
  const bin = claudeBin();
  const base = { step: job.step, ...(job.url && job.step === "login" ? { url: job.url } : {}), ...(job.error ? { error: job.error } : {}),
    ...(job.step === "installing" ? { log: job.log.slice(-6).join("\n") } : {}), ...(job.dismissed ? { dismissed: true } : {}) };
  if (!bin) return { installed: false, loggedIn: false, ...base };
  const [version, auth] = await Promise.all([
    run([bin, "--version"], { allowFail: true, timeoutMs: 15_000 }),
    run([bin, "auth", "status", "--json"], { allowFail: true, timeoutMs: 15_000 }),
  ]);
  let a: { loggedIn?: boolean; authMethod?: string; email?: string } = {};
  try { a = JSON.parse(auth); } catch { /* an older claude without auth status: say it isn't signed in, and signing in tells */ }
  return { installed: true, version: version.trim().split(" ")[0] || undefined, loggedIn: !!a.loggedIn, ...(a.authMethod && a.authMethod !== "none" ? { method: a.authMethod } : {}), ...(a.email ? { email: a.email } : {}), ...base };
}

/** Runs the installer in the background; claudeStatus says how it's going. */
export function installClaude() {
  if (job.step !== "idle") return;
  Object.assign(job, { step: "installing", error: undefined, log: [] });
  void (async () => {
    try {
      const p = Bun.spawn(INSTALL, { stdout: "pipe", stderr: "pipe", stdin: "ignore" });
      const dec = new TextDecoder();
      const keep = async (s: ReadableStream<Uint8Array>) => { for await (const c of s) job.log.push(...dec.decode(c).replace(/\x1b\[[0-9;]*[a-zA-Z]/g, "").split(/\r?\n/).filter((l) => l.trim())); };
      await Promise.all([keep(p.stdout), keep(p.stderr), p.exited]);
      if (p.exitCode !== 0) throw new Error(`the installer stopped (exit ${p.exitCode}): ${job.log.at(-1) ?? "no output"}`);
      if (!claudeBin()) throw new Error("the installer finished, but claude isn't where it puts it (~/.local/bin)");
    } catch (e) {
      job.error = `Couldn't install Claude Code: ${(e as Error).message}. You can run it yourself: ${INSTALL_TEXT}`;
    } finally { job.step = "idle"; }
  })();
}

/** Starts `claude auth login` and returns its sign-in link (the one that shows a code to paste back). Its own attempt
 *  to open a browser is turned off: on a remote machine there's none, and here the page opens the link. */
export async function startLogin(): Promise<string> {
  const bin = claudeBin();
  if (!bin) throw new Error("Claude Code isn't installed yet");
  cancelLogin();
  Object.assign(job, { step: "login", url: undefined, error: undefined });
  const p = Bun.spawn([bin, "auth", "login"], { stdin: "pipe", stdout: "pipe", stderr: "pipe",
    env: { ...process.env, ...(WINDOWS ? {} : { BROWSER: "true" }) } });
  job.login = p;
  const dec = new TextDecoder();
  let out = "";
  const read = async (s: ReadableStream<Uint8Array>) => { for await (const c of s) out += dec.decode(c); };
  void read(p.stdout); void read(p.stderr);
  for (let i = 0; i < 100 && !job.url; i++) { // up to 20 s for it to print the link
    const m = /https:\/\/\S+oauth\/authorize\?\S+/.exec(out);
    if (m) job.url = m[0];
    else if (p.exitCode !== null) break;
    else await Bun.sleep(200);
  }
  if (!job.url) {
    cancelLogin();
    job.error = `claude auth login didn't give a sign-in link${out.trim() ? `: ${out.trim().split("\n").at(-1)}` : ""}`;
    throw new Error(job.error);
  }
  job.login.exited.then(() => { if (job.login === p && job.step === "login") { job.step = "idle"; job.login = undefined; } });
  job.said = () => out;
  return job.url;
}

/** Hands the code from the sign-in page to the waiting `claude auth login`. Resolves with the new status, or throws why
 *  it didn't take (a new link is needed then: the login has ended). */
export async function submitCode(code: string): Promise<ClaudeStatus> {
  const p = job.login;
  if (!p || p.exitCode !== null) throw new Error("The sign-in has ended: get a new link");
  job.step = "verifying";
  p.stdin.write(`${code.trim()}\n`);
  await p.stdin.flush();
  const done = await Promise.race([p.exited, Bun.sleep(60_000).then(() => null)]);
  job.login = undefined; job.url = undefined; job.step = "idle";
  if (done === null) { p.kill(); throw new Error((job.error = "Claude didn't answer within a minute: try again")); }
  const status = await claudeStatus();
  if (done !== 0 || !status.loggedIn) {
    const said = (job.said?.() ?? "").trim().split("\n").filter((l) => !/https:\/\//.test(l)).at(-1) ?? "";
    throw new Error((job.error = `That code didn't work${said ? ` (${said.replace(/^.*?>\s*/, "")})` : ""}. Get a new link and try again; a code works once, for a few minutes.`));
  }
  return status;
}

export function cancelLogin() {
  job.login?.kill();
  Object.assign(job, { login: undefined, url: undefined, step: job.step === "installing" ? job.step : "idle" });
}
export const dismiss = () => { job.dismissed = true; };
