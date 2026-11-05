// bobby doctor: what Bobby relies on and how each stands, each problem with the command that fixes it, in a form to paste
// into a bug report. It reads and asks; it changes nothing. SSH is only tried if you've allowed cloning over it: Bobby
// doesn't touch your keys otherwise, and neither does this.
import { homedir } from "node:os";
import { claudeStatus } from "./claude.ts";
import { git, run } from "./git.ts";
import { ghStatus } from "./github.ts";
import * as log from "./log.ts";
import { SERVERS } from "./servers.ts";
import { holder, home, loadSettings } from "./state.ts";

/** needed: Bobby can't review a PR without it. optional: something works less well, or not at all, without it. */
export interface Check { name: string; ok: boolean; detail: string; fix?: string; optional?: boolean }

/** The organizations GitHub left out of an answer until this sign-in authorizes them for single sign-on, by id. */
export function ssoOrgs(headers: string): string[] {
  const m = /^x-github-sso:.*organizations=([\d,]+)/im.exec(headers);
  return m ? m[1].split(",").filter(Boolean) : [];
}

/** The report: one line a check, then what to do. Paths under your home are shortened, and anything secret-looking goes. */
export function report(head: string, checks: Check[], me = homedir()): { text: string; ok: boolean } {
  const width = Math.max(...checks.map((c) => c.name.length));
  const lines = checks.map((c) => `${c.ok ? "✓" : c.optional ? "-" : "✗"} ${c.name.padEnd(width)}  ${c.detail}${!c.ok && c.fix ? `\n  ${" ".repeat(width)}  → ${c.fix}` : ""}`);
  const bad = checks.filter((c) => !c.ok && !c.optional).length;
  const end = bad ? `${bad} ${bad === 1 ? "problem" : "problems"} to fix.` : "Ready to review PRs.";
  return { text: log.redact([head, "", ...lines, "", end].join("\n")).replaceAll(me, "~"), ok: !bad };
}

async function github(): Promise<Check[]> {
  const gh = await ghStatus();
  if (!gh.installed) return [{ name: "gh", ok: false, detail: "not installed (a branch can still be reviewed without it)", fix: "run bobby, and its page offers to set it up, or see https://cli.github.com" }];
  const out: Check[] = [{ name: "gh", ok: true, detail: gh.version ?? "installed" }];
  const reached = await fetch("https://api.github.com/zen", { signal: AbortSignal.timeout(8000) }).then(() => true, () => false);
  out.push({ name: "github.com", ok: reached, detail: reached ? "reachable" : "can't be reached", fix: "check your connection, VPN or proxy" });
  if (!reached) return out;
  const token = process.env.GH_TOKEN ? "GH_TOKEN" : process.env.GITHUB_TOKEN ? "GITHUB_TOKEN" : null;
  out.push({ name: "account", ok: gh.loggedIn, detail: gh.loggedIn ? `${gh.login ?? "signed in"}${token ? ` (from ${token})` : ""}` : token ? `GitHub refused ${token}` : "not signed in",
    fix: token ? `set a new ${token}, or unset it to use gh's own sign-in` : "run gh auth login" });
  if (!gh.loggedIn) return out;
  const headers = await run(["gh", "api", "-i", "user/orgs?per_page=100"], { allowFail: true, timeoutMs: 15_000 });
  const scopes = /^x-oauth-scopes: *(.*)$/im.exec(headers)?.[1]?.trim();
  if (scopes) out.push({ name: "permissions", ok: /\brepo\b/.test(scopes), detail: scopes, fix: "private repos need the repo permission: gh auth refresh -s repo" });
  const blocked = await Promise.all(ssoOrgs(headers).map(async (id) => (await run(["gh", "api", `organizations/${id}`, "--jq", ".login"], { allowFail: true, timeoutMs: 15_000 })).trim() || `id ${id}`));
  if (headers) out.push({ name: "single sign-on", ok: !blocked.length, detail: blocked.length ? `not authorized for ${blocked.join(", ")}` : "no organization is waiting on it",
    fix: "run gh auth refresh, and press Authorize beside each on GitHub's page" });
  return out;
}

async function ssh(): Promise<Check> {
  if (loadSettings().cloneSsh !== "always") return { name: "ssh", ok: true, detail: "not used: Bobby clones over HTTPS, and asks before trying SSH" };
  // ssh -T exits 1 even when GitHub greets you: what it says is the answer
  const said = await Bun.$`ssh -T -o BatchMode=yes -o ConnectTimeout=8 git@github.com`.nothrow().quiet().then((r) => r.stderr.toString() + r.stdout.toString(), () => "");
  const ok = /successfully authenticated/.test(said);
  return { name: "ssh", ok, optional: true, detail: ok ? "GitHub accepts your key" : "GitHub didn't accept your key", fix: "see ssh -T git@github.com" };
}

async function claude(): Promise<Check> {
  const c = await claudeStatus();
  return { name: "claude", ok: c.loggedIn, optional: true, // how it's signed in, and never as whom: this gets pasted
    detail: c.loggedIn ? `${c.version ?? "installed"}, signed in${c.method ? ` with ${c.method}` : ""}` : c.installed ? "not signed in: no smarter tree, questions or reviews" : "not installed: no smarter tree, questions or reviews",
    fix: "Settings › Claude Code… sets it up" };
}

const servers = () => Promise.all(SERVERS.map(async (s): Promise<Check> => {
  if (await s.installed()) return { name: s.title, ok: true, detail: await s.version() };
  const missing = await s.missing();
  return { name: s.title, ok: false, optional: true, detail: "not installed: the inspector answers from imports alone", fix: missing ? `${missing.hint}${missing.command ? ` ${missing.command}` : ""}` : `bobby lsp install ${s.id}` };
}));

export async function doctor(version: string): Promise<number> {
  const gitv = /\d+\.\d+(\.\d+)?/.exec(await git(process.cwd(), ["--version"], true))?.[0];
  const running = holder();
  const checks: Check[] = [
    { name: "git", ok: !!gitv, detail: gitv ?? "not installed", fix: "see https://git-scm.com" },
    ...(await github()),
    await ssh(),
    await claude(),
    ...(await servers()),
  ];
  const head = [`bobby ${version} · ${process.platform} ${process.arch} · bun ${Bun.version}`,
    `home ${home()} · log ${log.logPath()}`,
    running ? `running: pid ${running.pid}, port ${running.port}` : "not running"].join("\n");
  const { text, ok } = report(head, checks);
  console.log(text);
  return ok ? 0 : 1;
}
