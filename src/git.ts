import { join } from "node:path";
import { existsSync } from "node:fs";
import type { PrInfo } from "./types.ts";
import { home } from "./state.ts";

export async function run(
  cmd: string[],
  opts: { cwd?: string; input?: string; allowFail?: boolean } = {},
): Promise<string> {
  const proc = Bun.spawn(cmd, {
    cwd: opts.cwd,
    stdin: opts.input !== undefined ? new TextEncoder().encode(opts.input) : "ignore",
    stdout: "pipe",
    stderr: "pipe",
  });
  const [out, err, code] = await Promise.all([
    new Response(proc.stdout).text(),
    new Response(proc.stderr).text(),
    proc.exited,
  ]);
  if (code !== 0 && !opts.allowFail) {
    throw new Error(`${cmd.slice(0, 3).join(" ")} failed (${code}): ${err.trim() || out.trim()}`);
  }
  return out;
}

export const git = (cwd: string, args: string[], allowFail = false) =>
  run(["git", "-c", "core.quotePath=false", ...args], { cwd, allowFail });

export function parsePrArg(arg: string): { owner?: string; repo?: string; number: number } {
  const m = arg.match(/github\.com\/([^/]+)\/([^/]+)\/pull\/(\d+)/);
  if (m) return { owner: m[1], repo: m[2], number: Number(m[3]) };
  if (/^\d+$/.test(arg)) return { number: Number(arg) };
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
  meta: { number: number; title: string; body: string; url: string; author?: { login: string }; baseRefName: string; baseRefOid: string; headRefOid: string };
}

/** Reads the PR's metadata and finds (or clones) a local checkout. Doesn't fetch, so it's cheap enough to run on every launch. */
export async function resolvePr(arg: string, repoDir?: string): Promise<ResolvedPr> {
  const parsed = parsePrArg(arg);
  let cwd = repoDir ?? process.cwd();

  const fields = "number,title,body,url,author,baseRefName,baseRefOid,headRefOid";
  const viewArgs = ["gh", "pr", "view", parsed.owner ? arg : String(parsed.number), "--json", fields];
  const meta = JSON.parse(await run(viewArgs, { cwd }));
  const [, owner, repo] = meta.url.match(/github\.com\/([^/]+)\/([^/]+)\/pull/)!;

  const isRepo = (await git(cwd, ["rev-parse", "--git-dir"], true)).trim() !== "";
  let remote = isRepo ? await remoteFor(cwd, owner, repo) : null;
  if (!remote && !repoDir) {
    cwd = join(home(), "repos", owner, repo);
    if (!existsSync(cwd)) {
      console.log(`  cloning ${owner}/${repo} into ${cwd} (first time only)…`);
      await run(["gh", "repo", "clone", `${owner}/${repo}`, cwd, "--", "--no-tags"]);
    }
    remote = (await remoteFor(cwd, owner, repo)) ?? "origin";
  }
  if (!remote) throw new Error(`No remote in ${cwd} points at ${owner}/${repo}`);
  return { cwd, remote, owner, repo, meta };
}

/** Fetches base + head commits and pins the diff range. */
export async function fetchPr({ cwd, remote, owner, repo, meta }: ResolvedPr): Promise<PrInfo> {
  const ns = `refs/bobby/${meta.number}`;
  await git(cwd, [
    "fetch", "--quiet", "--no-tags", remote,
    `+refs/pull/${meta.number}/head:${ns}/head`,
    `+refs/heads/${meta.baseRefName}:${ns}/base`,
  ]);
  const hasBaseOid = (await Bun.spawn(["git", "cat-file", "-e", meta.baseRefOid], { cwd, stderr: "ignore" }).exited) === 0;
  const baseTip = hasBaseOid ? meta.baseRefOid : `${ns}/base`;
  const headSha = (await git(cwd, ["rev-parse", `${ns}/head`])).trim();
  const baseSha = (await git(cwd, ["merge-base", baseTip, headSha])).trim();

  return {
    owner, repo, number: meta.number, title: meta.title, body: meta.body ?? "",
    url: meta.url, author: meta.author?.login ?? "", baseSha, headSha,
  };
}

const fileCache = new Map<string, string[]>();
export async function fileLines(cwd: string, sha: string, path: string): Promise<string[]> {
  const key = `${sha}:${path}`;
  let lines = fileCache.get(key);
  if (!lines) {
    lines = (await git(cwd, ["show", key], true)).split("\n");
    fileCache.set(key, lines);
  }
  return lines;
}

/** Existing inline review comments still anchored to a line of the current diff (outdated ones are dropped). */
export async function reviewComments(pr: Pick<PrInfo, "owner" | "repo" | "number">) {
  type Raw = { id: number; path: string; line: number | null; side: "LEFT" | "RIGHT"; in_reply_to_id?: number; user: { login: string } | null; body: string; html_url: string; created_at: string };
  // --jq '.[]' prints one compact object per line, so paginated pages concatenate cleanly.
  const out = await run(["gh", "api", "--paginate", "--jq", ".[]", `repos/${pr.owner}/${pr.repo}/pulls/${pr.number}/comments?per_page=100`], { allowFail: true });
  const raw = out.split("\n").filter((l) => l.startsWith("{")).map((l) => JSON.parse(l) as Raw);
  return raw.filter((c) => c.line != null).map((c) => ({
    id: String(c.id), path: c.path, line: c.line!, side: c.side, author: c.user?.login ?? "ghost",
    body: c.body, url: c.html_url, createdAt: c.created_at, ...(c.in_reply_to_id ? { replyTo: String(c.in_reply_to_id) } : {}),
  }));
}
