import { expect, test } from "bun:test";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { prCommits } from "../src/git.ts";

// Without git's own variables: run from a commit hook, GIT_INDEX_FILE (and friends) would point these commands at the
// repo being committed to.
const env = { ...Object.fromEntries(Object.entries(process.env).filter(([k]) => !k.startsWith("GIT_"))), GIT_CONFIG_GLOBAL: "/dev/null" };

test("a PR's commits run oldest first along the first parent, with merges marked", async () => {
  const dir = mkdtempSync(join(tmpdir(), "bobby-commits-"));
  const g = (...a: string[]) => {
    const r = Bun.spawnSync(["git", "-c", "user.name=T", "-c", "user.email=t@t", ...a], { cwd: dir, env });
    if (r.exitCode !== 0) throw new Error(`git ${a.join(" ")}: ${r.stderr.toString()}`);
    return r.stdout.toString().trim();
  };
  const commit = (f: string, m: string) => { writeFileSync(join(dir, f), m); g("add", "-A"); g("commit", "-qm", m); return g("rev-parse", "HEAD"); };
  try {
    g("init", "-q", "-b", "main");
    const base = commit("base", "base");
    g("checkout", "-qb", "side"); commit("s", "on the side");
    g("checkout", "-qb", "pr", base);
    const one = commit("a", "first: with a subject");
    g("merge", "-q", "--no-ff", "-m", "merge side", "side");
    const three = commit("b", "last");
    const got = await prCommits(dir, base, three);
    expect(got.map((c) => c.subject)).toEqual(["first: with a subject", "merge side", "last"]);
    expect(got.map((c) => c.merge)).toEqual([false, true, false]);
    expect(got[0].parent).toBe(base);
    expect(got[1].parent).toBe(one);
    expect(got[0].author).toBe("T");
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
