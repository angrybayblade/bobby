// Local mode: review the branch you're on, inside its repo, with no PR needed. The diff runs from the
// merge-base with a base branch to your working tree (uncommitted tracked changes included).
import { basename } from "node:path";
import { git, run } from "./git.ts";
import type { PrInfo } from "./types.ts";

const exists = async (cwd: string, ref: string) => (await git(cwd, ["rev-parse", "--verify", "--quiet", `${ref}^{commit}`], true)).trim() !== "";

/**
 * The branch to compare against, first match wins:
 * --base · the base of this branch's open PR · origin's default branch · main / master / develop / trunk.
 * Returns null if none is found; `why` says where the answer came from.
 */
export async function detectBase(cwd: string, branch: string): Promise<{ ref: string; why: string } | null> {
  const local = (name: string) => [`origin/${name}`, name];
  if (branch) {
    const out = await run(["gh", "pr", "view", "--json", "baseRefName,number", branch], { cwd, allowFail: true });
    const pr = out.trim().startsWith("{") ? (JSON.parse(out) as { baseRefName: string; number: number }) : null;
    if (pr) for (const ref of local(pr.baseRefName)) if (await exists(cwd, ref)) return { ref, why: `base of PR #${pr.number}` };
  }
  const head = (await git(cwd, ["symbolic-ref", "--quiet", "--short", "refs/remotes/origin/HEAD"], true)).trim();
  if (head && (await exists(cwd, head))) return { ref: head, why: "origin's default branch" };
  for (const name of ["main", "master", "develop", "trunk"])
    for (const ref of local(name)) if (await exists(cwd, ref)) return { ref, why: "common default name" };
  return null;
}

/** Asks for a base branch on the terminal. Only called when stdin is a TTY. */
function askBase(branches: string[]): string {
  console.log("  Couldn't work out which branch this one is based on.");
  if (branches.length) console.log(`  Branches: ${branches.slice(0, 12).join(", ")}${branches.length > 12 ? ", …" : ""}`);
  return (prompt("  Base branch to compare against:") ?? "").trim();
}

export interface LocalReview { cwd: string; pr: PrInfo; dirty: boolean; untracked: number; why: string }

export async function resolveLocal(dir: string, baseArg?: string): Promise<LocalReview> {
  const cwd = (await git(dir, ["rev-parse", "--show-toplevel"], true)).trim();
  if (!cwd) throw new Error(`${dir} isn't inside a git repository. Pass a PR URL or number, or run prfocus inside a repo.`);
  const branch = (await git(cwd, ["branch", "--show-current"], true)).trim();

  let base: { ref: string; why: string } | null = baseArg ? { ref: baseArg, why: "--base" } : await detectBase(cwd, branch);
  if (!base && process.stdin.isTTY) {
    const branches = (await git(cwd, ["for-each-ref", "--format=%(refname:short)", "refs/heads", "refs/remotes"], true)).split("\n").filter((b) => b && b !== branch && !b.endsWith("/HEAD"));
    const ref = askBase(branches);
    if (ref) base = { ref, why: "you chose it" };
  }
  if (!base) throw new Error("Couldn't detect a base branch. Pass one with --base <branch>.");
  if (!(await exists(cwd, base.ref))) throw new Error(`Base "${base.ref}" isn't a branch or commit in ${cwd}.`);

  const head = (await git(cwd, ["rev-parse", "HEAD"])).trim();
  const baseSha = (await git(cwd, ["merge-base", base.ref, head])).trim();
  // Uncommitted tracked changes: `git stash create` snapshots them without touching the working tree or the
  // stash list. Its tree id is stable while the files are, so cached graphs still hit; git diff, grep and show
  // all accept a tree.
  const stash = (await git(cwd, ["stash", "create"], true)).trim();
  const headSha = stash ? (await git(cwd, ["rev-parse", `${stash}^{tree}`])).trim() : head;
  if (!stash && baseSha === head) {
    throw new Error(`Nothing to review: ${branch || "HEAD"} has no changes since ${base.ref}. Pass a different --base?`);
  }

  // Identity: the GitHub repo when origin points at one, else the folder name.
  const origin = (await git(cwd, ["remote", "get-url", "origin"], true)).trim();
  const m = origin.match(/github\.com[:/]([^/]+)\/(.+?)(?:\.git)?$/);
  const [owner, repo] = m ? [m[1], m[2]] : ["local", basename(cwd)];
  const subjects = (await git(cwd, ["log", "--format=%s", `${baseSha}..${head}`], true)).split("\n").filter(Boolean);
  const author = (await git(cwd, ["config", "user.name"], true)).trim();
  const untracked = (await git(cwd, ["ls-files", "--others", "--exclude-standard"], true)).split("\n").filter(Boolean).length;
  return {
    cwd, dirty: !!stash, untracked, why: base.why,
    pr: {
      provider: "local", branch: branch || head.slice(0, 7), baseRef: base.ref,
      owner, repo, number: 0, url: "",
      title: !subjects.length ? "Uncommitted changes" : subjects.length === 1 ? subjects[0] : `${subjects.length} commits, latest: ${subjects[0]}`,
      body: subjects.map((s) => `- ${s}`).join("\n") + (stash ? `${subjects.length ? "\n" : ""}- (uncommitted changes)` : ""),
      author, baseSha, headSha,
    },
  };
}
