import { expect, test } from "bun:test";
import { cacheMatch, type OnDisk, parseSlug, planStale } from "../src/purge.ts";

test("reads a state file's name back: a PR, one commit of it, or a branch, with underscores in the repo", () => {
  expect(parseSlug("ComposioHQ_platform_13778")).toEqual({ owner: "ComposioHQ", repo: "platform", number: 13778 });
  expect(parseSlug("o_my_repo_7_c0123456789ab-89abcde")).toEqual({ owner: "o", repo: "my_repo", number: 7 });
  expect(parseSlug("composiohq_platform_branch_feat-x")).toEqual({ owner: "composiohq", repo: "platform", branch: "feat-x" });
  expect(parseSlug("app.lock")).toBeNull();
});

test("a PR's cache files, its commit reviews' included, and not those of a repo whose name goes on with its number", () => {
  const pr = { owner: "o", repo: "x", number: 13, states: [] };
  expect(cacheMatch("o_x_13_0123456789ab_main.graphs.json", pr)).toBe("0123456789ab");
  expect(cacheMatch("o_x_13_cfedcba987654_0123456789ab.tree.0.6.3.json", pr)).toBe("0123456789ab");
  expect(cacheMatch("o_x_13_5_0123456789ab.graphs.json", pr)).toBeNull(); // repo x_13's #5
  expect(cacheMatch("o_x_137_0123456789ab.graphs.json", pr)).toBeNull();
  const branch = { owner: "o", repo: "x", states: ["o_x_branch_main.json"] };
  expect(cacheMatch("o_x_branch_main_0123456789ab_157e70f.graphs.json", branch)).toBe("0123456789ab");
  expect(cacheMatch("o_x_branch_main-2_0123456789ab.graphs.json", branch)).toBeNull();
});

const DAY = 86_400_000, now = Date.parse("2026-11-16T00:00:00Z");
const review = (key: string, daysAgo: number, work = 0): OnDisk => ({ key, owner: "o", repo: "r", number: 1, label: key, states: [], lastUsed: now - daysAgo * DAY, work, shas: [] });

test("stale: merged or closed, or not opened in the days given; drafts and notes keep a review whatever its age", () => {
  const plan = planStale([review("o/r#1", 2), review("o/r#2", 45), review("o/r#3", 2), review("o/r#4", 90, 3)], { now, days: 30, closed: new Set(["o/r#3"]) });
  expect(plan.remove.map((r) => [r.key, r.why])).toEqual([["o/r#2", "not opened in 45 days"], ["o/r#3", "merged or closed"]]);
  expect(plan.kept.map((r) => r.key)).toEqual(["o/r#4"]);
  expect(plan.kept[0].why).toContain("3 unsent drafts or notes");
});
