import { join } from "node:path";
import { existsSync } from "node:fs";
import type { PrInfo } from "./types.ts";
import { home } from "./state.ts";

export async function run(
  cmd: string[],
  opts: { cwd?: string; input?: string; allowFail?: boolean; env?: Record<string, string>; timeoutMs?: number } = {},
): Promise<string> {
  // A program that isn't installed throws here, not as an exit code: say which, or read it as a failure when allowed
  const missing = !Bun.which(cmd[0], { PATH: opts.env?.PATH ?? process.env.PATH ?? "" }) && !cmd[0].includes("/");
  if (missing) {
    if (opts.allowFail) return "";
    throw new Error(`${cmd[0]} isn't installed, or isn't on your PATH${{ gh: ": https://cli.github.com", git: ": https://git-scm.com", claude: ": https://claude.com/claude-code" }[cmd[0]] ?? ""}`);
  }
  const proc = Bun.spawn(cmd, {
    cwd: opts.cwd,
    ...(opts.env ? { env: { ...process.env, ...opts.env } } : {}),
    stdin: opts.input !== undefined ? new TextEncoder().encode(opts.input) : "ignore",
    stdout: "pipe",
    stderr: "pipe",
  });
  let timedOut = false;
  const timer = opts.timeoutMs ? setTimeout(() => { timedOut = true; proc.kill(); }, opts.timeoutMs) : undefined;
  const [out, err, code] = await Promise.all([
    new Response(proc.stdout).text(),
    new Response(proc.stderr).text(),
    proc.exited,
  ]).finally(() => clearTimeout(timer));
  if (timedOut) { const s = Math.round(opts.timeoutMs! / 1000); throw new Error(`${cmd.slice(0, 2).join(" ")} gave no answer in ${s >= 120 ? `${Math.round(s / 60)} min` : `${s} s`}`); }
  if (code !== 0 && !opts.allowFail) {
    throw new Error(`${cmd.slice(0, 3).join(" ")} failed (${code}): ${err.trim() || out.trim()}`);
  }
  return out;
}

export const git = (cwd: string, args: string[], allowFail = false) =>
  run(["git", "-c", "core.quotePath=false", ...args], { cwd, allowFail });

const ONLY_GITHUB = "Bobby reviews PRs on github.com only for now; GitHub Enterprise isn't supported yet. You can still review the branch locally: check it out and run bobby with no PR.";

/** A PR's URL or number. A URL to one of its commits (…/pull/12/changes/<sha>, or /commits/<sha>) or to a range
 *  (…/changes/<from>..<to>) reviews just those. */
export function parsePrArg(arg: string): { owner?: string; repo?: string; number: number; commit?: string; from?: string } {
  const m = arg.match(/github\.com\/([^/]+)\/([^/]+)\/pull\/(\d+)(?:\/(?:changes|commits|files)\/([0-9a-f]{7,40})(?:\.\.\.?([0-9a-f]{7,40}))?)?/i);
  if (m) return { owner: m[1], repo: m[2], number: Number(m[3]), ...(m[5] ? { from: m[4], commit: m[5] } : m[4] ? { commit: m[4] } : {}) };
  if (/^\d+$/.test(arg)) return { number: Number(arg) };
  if (/^https?:\/\/[^/]+\/[^/]+\/[^/]+\/pull\/\d+/.test(arg)) throw new Error(ONLY_GITHUB);
  throw new Error(`Expected a PR URL or number, got "${arg}"`);
}

async function remoteFor(cwd: string, owner: string, repo: string): Promise<string | null> {
  const out = await git(cwd, ["remote", "-v"], true);
  const want = `${owner}/${repo}`.toLowerCase();
  for (const line of out.split("\n")) {
    const [name, url] = line.split(/\s+/);
    if (!url) continue;
    const slug = url.replace(/\.git$/, "").replace(/^.*github\.com[:/]/, "").toLowerCase();
    if (slug === want) return name;
  }
  return null;
}

export interface ResolvedPr {
  cwd: string; remote: string; owner: string; repo: string;
  commit?: string; from?: string; // one commit (or a range) of the PR, as given
  meta: { number: number; title: string; body: string; url: string; author?: { login: string }; baseRefName: string; baseRefOid: string; headRefOid: string };
}

/** Reads the PR's metadata and finds (or clones) a local checkout. Doesn't fetch, so it's cheap enough to run on every launch. */
export async function resolvePr(arg: string, repoDir?: string): Promise<ResolvedPr> {
  const parsed = parsePrArg(arg);
  let cwd = repoDir ?? process.cwd();

  const fields = "number,title,body,url,author,baseRefName,baseRefOid,headRefOid";
  const viewArgs = ["gh", "pr", "view", String(parsed.number), ...(parsed.owner ? ["-R", `${parsed.owner}/${parsed.repo}`] : []), "--json", fields];
  const meta = JSON.parse(await run(viewArgs, { cwd }));
  const m = meta.url.match(/^https:\/\/github\.com\/([^/]+)\/([^/]+)\/pull/);
  if (!m) throw new Error(ONLY_GITHUB);
  const [, owner, repo] = m;

  const isRepo = (await git(cwd, ["rev-parse", "--git-dir"], true)).trim() !== "";
  let remote = isRepo ? await remoteFor(cwd, owner, repo) : null;
  if (!remote && !repoDir) {
    cwd = join(home(), "repos", owner, repo);
    if (!existsSync(cwd)) {
      console.error(`  cloning ${owner}/${repo} into ${cwd} (first time only)…`); // stderr: extract may be writing the graph to stdout
      await run(["gh", "repo", "clone", `${owner}/${repo}`, cwd, "--", "--no-tags"]);
    }
    remote = (await remoteFor(cwd, owner, repo)) ?? "origin";
  }
  if (!remote) throw new Error(`No remote in ${cwd} points at ${owner}/${repo}`);
  return { cwd, remote, owner, repo, meta, ...(parsed.commit ? { commit: parsed.commit } : {}), ...(parsed.from ? { from: parsed.from } : {}) };
}

/** Fetches base + head commits and pins the diff range. */
export async function fetchPr(resolved: ResolvedPr): Promise<PrInfo> {
  const { cwd, remote, owner, repo, meta } = resolved;
  const ns = `refs/bobby/${meta.number}`;
  await git(cwd, [
    "fetch", "--quiet", "--no-tags", remote,
    `+refs/pull/${meta.number}/head:${ns}/head`,
    `+refs/heads/${meta.baseRefName}:${ns}/base`,
  ]);
  const hasBaseOid = (await Bun.spawn(["git", "cat-file", "-e", meta.baseRefOid], { cwd, stderr: "ignore" }).exited) === 0;
  const baseTip = hasBaseOid ? meta.baseRefOid : `${ns}/base`;
  const prHead = (await git(cwd, ["rev-parse", `${ns}/head`])).trim();
  const pr = { owner, repo, number: meta.number, title: meta.title, body: meta.body ?? "", baseRef: meta.baseRefName, url: meta.url, author: meta.author?.login ?? "" };
  if (!resolved.commit) return { ...pr, baseSha: (await git(cwd, ["merge-base", baseTip, prHead])).trim(), headSha: prHead };

  // One commit (against its first parent) or a range: both must be in the PR's history, as fetched.
  const sha = async (s: string) => {
    const full = (await git(cwd, ["rev-parse", "--verify", "--quiet", `${s}^{commit}`], true)).trim();
    const inPr = full && (await Bun.spawn(["git", "merge-base", "--is-ancestor", full, prHead], { cwd, stderr: "ignore" }).exited) === 0;
    if (!inPr) throw new Error(`${s} isn't a commit of PR #${meta.number}`);
    return full;
  };
  const headSha = await sha(resolved.commit);
  const baseSha = resolved.from ? await sha(resolved.from) : (await git(cwd, ["rev-parse", "--verify", "--quiet", `${headSha}^`], true)).trim();
  if (!baseSha) throw new Error(`${resolved.commit} has no parent to compare it with`);
  const subject = (await git(cwd, ["log", "-1", "--format=%s", headSha])).trim();
  return { ...pr, baseSha, headSha, commit: { sha: headSha, ...(resolved.from ? { from: baseSha } : {}), subject } };
}

// Files read at a commit, the most recently used kept: a long session of inspecting and expanding mustn't hold every
// file it ever opened.
const fileCache = new Map<string, string[]>(), KEEP_FILES = 400;
export async function fileLines(cwd: string, sha: string, path: string): Promise<string[]> {
  const key = `${sha}:${path}`;
  let lines = fileCache.get(key);
  if (lines) fileCache.delete(key); // to the back: most recently used
  else lines = (await git(cwd, ["show", key], true)).split("\n");
  fileCache.set(key, lines);
  if (fileCache.size > KEEP_FILES) fileCache.delete(fileCache.keys().next().value!);
  return lines;
}

/** Existing inline review comments still anchored to a line of the current diff (outdated ones are dropped). For one
 *  commit of the PR, the comments written on that commit, where they were written (GitHub's original_line).
 *  strict: a failed fetch throws instead of reading as no comments. */
export async function reviewComments(pr: Pick<PrInfo, "owner" | "repo" | "number" | "commit">, strict = false) {
  type Raw = { id: number; path: string; line: number | null; side: "LEFT" | "RIGHT"; in_reply_to_id?: number; start_line?: number | null; start_side?: "LEFT" | "RIGHT" | null; user: { login: string; avatar_url?: string } | null; body: string; html_url: string; created_at: string;
    original_commit_id?: string; original_line?: number | null; original_start_line?: number | null };
  // --jq '.[]' prints one compact object per line, so paginated pages concatenate cleanly.
  const out = await run(["gh", "api", "--paginate", "--jq", ".[]", `repos/${pr.owner}/${pr.repo}/pulls/${pr.number}/comments?per_page=100`], { allowFail: !strict });
  let raw = out.split("\n").filter((l) => l.startsWith("{")).map((l) => JSON.parse(l) as Raw);
  if (pr.commit) raw = raw.filter((c) => c.original_commit_id === pr.commit!.sha && c.original_line != null).map((c) => ({ ...c, line: c.original_line!, start_line: c.original_start_line ?? null }));
  return raw.filter((c) => c.line != null).map((c) => ({
    id: String(c.id), path: c.path, line: c.line!, side: c.side, author: c.user?.login ?? "ghost",
    body: c.body, url: c.html_url, createdAt: c.created_at, ...(c.user?.avatar_url ? { avatar: c.user.avatar_url } : {}), ...(c.in_reply_to_id ? { replyTo: String(c.in_reply_to_id) } : {}), ...(c.start_line && c.start_line !== c.line ? { startLine: c.start_line, startSide: c.start_side ?? c.side } : {}),
  }));
}

/** Who you are on GitHub (gh's login), for your own drafts and notes; asked once a day at most, null if gh can't say
 *  (not installed, logged out, offline), and then not asked again for an hour. */
let unknownSince = 0;
export async function whoAmI(cache: string): Promise<{ login: string; avatar: string } | null> {
  try {
    const f = Bun.file(cache);
    if ((await f.exists()) && Date.now() - f.lastModified < 86_400_000) return await f.json();
    if (Date.now() - unknownSince < 3_600_000) return null;
    const me = JSON.parse(await run(["gh", "api", "user", "--jq", "{login: .login, avatar: .avatar_url}"]));
    await Bun.write(cache, JSON.stringify(me));
    return me;
  } catch { unknownSince = Date.now(); return null; }
}
