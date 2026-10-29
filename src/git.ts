import { join } from "node:path";
import { existsSync } from "node:fs";
import type { PrInfo } from "./types.ts";
import type { Discussion, GDiscussion, GOutdated, PendingReview, Reaction } from "./graph.ts";
import { home } from "./state.ts";
import { ghBin } from "./github.ts";

export async function run(
  cmd: string[],
  opts: { cwd?: string; input?: string; allowFail?: boolean; env?: Record<string, string>; timeoutMs?: number } = {},
): Promise<string> {
  const said = cmd; // what errors name: gh, not where it is
  if (cmd[0] === "gh" && !Bun.which("gh", { PATH: opts.env?.PATH ?? process.env.PATH ?? "" })) cmd = [ghBin() ?? "gh", ...cmd.slice(1)]; // gh Bobby installed in ~/.local/bin, not on PATH
  // A program that isn't installed throws here, not as an exit code: say which, or read it as a failure when allowed
  const missing = !Bun.which(cmd[0], { PATH: opts.env?.PATH ?? process.env.PATH ?? "" }) && !cmd[0].includes("/");
  if (missing) {
    if (opts.allowFail) return "";
    throw new Error(`${cmd[0]} isn't installed, or isn't on your PATH${{ gh: ": set it up from Bobby's page (it offers to), or see https://cli.github.com", git: ": https://git-scm.com", claude: ": set it up from Bobby's page (it offers to), or see https://claude.com/claude-code" }[cmd[0]] ?? ""}`);
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
  if (timedOut) { const s = Math.round(opts.timeoutMs! / 1000); throw new Error(`${said.slice(0, 2).join(" ")} gave no answer in ${s >= 120 ? `${Math.round(s / 60)} min` : `${s} s`}`); }
  if (code !== 0 && !opts.allowFail) {
    throw new Error(`${said.slice(0, 3).join(" ")} failed (${code}): ${err.trim() || out.trim()}`);
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
/** from: the folder to look in for a clone when repoDir isn't given (where you ran bobby; default this process's). */
export async function resolvePr(arg: string, repoDir?: string, from = process.cwd()): Promise<ResolvedPr> {
  const parsed = parsePrArg(arg);
  let cwd = repoDir ?? from;

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
  // Signed in with gh: git asks it for github.com's credentials, as gh does for its own commands (a private repo on a
  // machine whose git was never given them). Only for this fetch: your git config is left alone.
  const gh = ghBin();
  const viaGh = gh ? ["-c", "credential.https://github.com.helper=", "-c", `credential.https://github.com.helper=!'${gh.replaceAll("'", "'\\''")}' auth git-credential`] : [];
  await git(cwd, [
    ...viaGh, "fetch", "--quiet", "--no-tags", remote,
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

/** What only GraphQL says of a PR's review threads: each thread's node id and whether it's resolved (by its first
 *  comment's id), each comment's node id and reactions, your review that isn't submitted yet, and its comments (REST
 *  leaves those out, and gives them no line). */
interface ThreadInfo {
  threads: Map<string, { id: string; resolved: boolean }>;
  comments: Map<string, { node: string; reactions: Reaction[] }>;
  pending?: PendingReview;
  pendingComments: GDiscussion[];
}
const REACTIONS = "reactionGroups { content viewerHasReacted reactors { totalCount } }";
export const reactionsOf = (groups: Array<{ content: string; viewerHasReacted: boolean; reactors: { totalCount: number } }> | undefined): Reaction[] =>
  (groups ?? []).filter((g) => g.reactors.totalCount > 0).map((g) => ({ content: g.content, count: g.reactors.totalCount, mine: g.viewerHasReacted }));
async function threadInfo(pr: Pick<PrInfo, "owner" | "repo" | "number">, strict: boolean): Promise<ThreadInfo> {
  const q = `query($owner: String!, $repo: String!, $n: Int!, $after: String) { repository(owner: $owner, name: $repo) { pullRequest(number: $n) {
    reviews(states: PENDING, first: 1) { nodes { id databaseId body comments { totalCount } } }
    reviewThreads(first: 50, after: $after) { pageInfo { hasNextPage endCursor } nodes { id isResolved path line startLine diffSide startDiffSide subjectType
      comments(first: 100) { nodes { id databaseId state body bodyHTML createdAt url author { login avatarUrl } replyTo { databaseId } ${REACTIONS} } } } } } } }`;
  type RawComment = { id: string; databaseId: number; state: string; body: string; bodyHTML: string; createdAt: string; url: string; author: { login: string; avatarUrl?: string } | null; replyTo: { databaseId: number } | null;
    reactionGroups: Parameters<typeof reactionsOf>[0] };
  type RawThread = { id: string; isResolved: boolean; path: string; line: number | null; startLine: number | null; diffSide: "LEFT" | "RIGHT"; startDiffSide: "LEFT" | "RIGHT" | null; subjectType: "LINE" | "FILE"; comments: { nodes: RawComment[] } };
  const out: ThreadInfo = { threads: new Map(), comments: new Map(), pendingComments: [] };
  for (let after = "", k = 0; k < 40; k++) {
    const r = await run(["gh", "api", "graphql", "-f", `query=${q}`, "-F", `owner=${pr.owner}`, "-F", `repo=${pr.repo}`, "-F", `n=${pr.number}`, ...(after ? ["-f", `after=${after}`] : [])], { allowFail: !strict });
    const p = r.trim() ? JSON.parse(r).data?.repository?.pullRequest : null;
    if (!p) break;
    const mine = p.reviews?.nodes?.[0];
    if (mine) out.pending = { id: mine.id, databaseId: String(mine.databaseId), body: mine.body ?? "", comments: mine.comments.totalCount };
    for (const t of p.reviewThreads.nodes as RawThread[]) {
      const first = t.comments.nodes[0];
      if (first) out.threads.set(String(first.databaseId), { id: t.id, resolved: t.isResolved });
      for (const c of t.comments.nodes) {
        out.comments.set(String(c.databaseId), { node: c.id, reactions: reactionsOf(c.reactionGroups) });
        if (c.state !== "PENDING") continue;
        const file = t.subjectType === "FILE";
        if (!file && t.line == null) continue; // its line has gone from the diff
        out.pendingComments.push({
          id: String(c.databaseId), path: t.path, line: file ? 0 : t.line!, side: t.diffSide ?? "RIGHT", author: c.author?.login ?? "ghost", body: c.body, url: c.url, createdAt: c.createdAt,
          ...(c.author?.avatarUrl ? { avatar: c.author.avatarUrl } : {}), ...(c.bodyHTML ? { html: c.bodyHTML } : {}), ...(c.replyTo ? { replyTo: String(c.replyTo.databaseId) } : {}),
          ...(!file && t.startLine && t.startLine !== t.line ? { startLine: t.startLine, startSide: t.startDiffSide ?? t.diffSide } : {}),
          thread: t.id, node: c.id, pending: true, ...(file ? { file: true as const } : {}),
        });
      }
    }
    if (!p.reviewThreads.pageInfo.hasNextPage) break;
    after = p.reviewThreads.pageInfo.endCursor;
  }
  return out;
}

/** Existing inline review comments: those still anchored to a line of the current diff, and those on a whole file,
 *  each with its thread (resolved or not) and reactions; the outdated threads, whose line is gone (kept off the lines,
 *  counted by file); and your review that isn't submitted yet, with its comments. For one commit of the PR, the
 *  comments written on that commit, where they were written (GitHub's original_line), and none outdated.
 *  strict: a failed fetch throws instead of reading as no comments. */
export async function reviewComments(pr: Pick<PrInfo, "owner" | "repo" | "number" | "commit">, strict = false): Promise<Discussion> {
  type Raw = { id: number; path: string; line: number | null; side: "LEFT" | "RIGHT"; in_reply_to_id?: number; start_line?: number | null; start_side?: "LEFT" | "RIGHT" | null; user: { login: string; avatar_url?: string } | null; body: string; body_html?: string; html_url: string; created_at: string;
    original_commit_id?: string; original_line?: number | null; original_start_line?: number | null; subject_type?: "line" | "file" };
  // --jq '.[]' prints one compact object per line, so paginated pages concatenate cleanly. full+json: body_html too.
  const [out, info] = await Promise.all([
    run(["gh", "api", "--paginate", "-H", "Accept: application/vnd.github.full+json", "--jq", ".[]", `repos/${pr.owner}/${pr.repo}/pulls/${pr.number}/comments?per_page=100`], { allowFail: !strict }),
    threadInfo(pr, strict),
  ]);
  let raw = out.split("\n").filter((l) => l.startsWith("{")).map((l) => JSON.parse(l) as Raw);
  const root = (c: Raw) => String(c.in_reply_to_id ?? c.id);
  const of = (first: string) => { const t = info.threads.get(first); return t ? { thread: t.id, ...(t.resolved ? { resolved: true as const } : {}) } : {}; };
  const extra = (id: string) => { const c = info.comments.get(id); return c ? { node: c.node, ...(c.reactions.length ? { reactions: c.reactions } : {}) } : {}; };
  if (pr.commit) raw = raw.filter((c) => c.original_commit_id === pr.commit!.sha && c.original_line != null).map((c) => ({ ...c, line: c.original_line!, start_line: c.original_start_line ?? null }));
  const onFile = new Set(raw.filter((c) => c.subject_type === "file" && !c.in_reply_to_id).map((c) => String(c.id)));
  const outdated: GOutdated[] = [];
  for (const c of raw) {
    if (c.line != null || c.in_reply_to_id || onFile.has(String(c.id))) continue;
    outdated.push({ id: String(c.id), path: c.path, author: c.user?.login ?? "ghost", url: c.html_url, createdAt: c.created_at,
      comments: raw.filter((r) => root(r) === String(c.id)).length, ...of(String(c.id)) });
  }
  const comments: GDiscussion[] = raw.filter((c) => c.line != null || onFile.has(root(c))).map((c) => {
    const file = onFile.has(root(c));
    return {
      id: String(c.id), path: c.path, line: file ? 0 : c.line!, side: c.side ?? "RIGHT", author: c.user?.login ?? "ghost",
      body: c.body, url: c.html_url, createdAt: c.created_at, ...(c.user?.avatar_url ? { avatar: c.user.avatar_url } : {}), ...(c.body_html ? { html: c.body_html } : {}), ...(c.in_reply_to_id ? { replyTo: String(c.in_reply_to_id) } : {}),
      ...(!file && c.start_line && c.start_line !== c.line ? { startLine: c.start_line, startSide: c.start_side ?? c.side } : {}),
      ...of(root(c)), ...extra(String(c.id)), ...(file ? { file: true as const } : {}),
    };
  });
  const seen = new Set(comments.map((c) => c.id));
  if (!pr.commit) comments.push(...info.pendingComments.filter((c) => !seen.has(c.id)));
  return { comments, outdated, ...(info.pending && !pr.commit ? { pending: info.pending } : {}) };
}

/** Who you are on GitHub (gh's login), for your own drafts and notes; asked once a day at most, null if gh can't say
 *  (not installed, logged out, offline), and then not asked again for an hour. */
let unknownSince = 0;
/** Ask GitHub again, now: gh was just set up. */
export const forgetUnknownMe = () => { unknownSince = 0; };
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
