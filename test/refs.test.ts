import { expect, test } from "bun:test";
import { type RefContext, refsForGitHub, resolveRefs } from "../src/refs.ts";
import type { ReviewGraph } from "../src/graph.ts";

const files = { head: ["src/a/index.ts", "src/b/index.ts", "src/lib/util.ts", "pages/[id]/page.tsx"], base: ["src/a/index.ts", "src/old.ts"] };
const ctx: RefContext = {
  files: async (side) => files[side],
  lineCount: async (side, path) => (files[side].includes(path) ? 50 : 0),
  prFiles: ["src/a/index.ts"],
};
const r = (s: string) => resolveRefs(s, ctx);

test("resolves references to real files and lines", async () => {
  expect(await r("see [the check](src/lib/util.ts#L12-L20)")).toBe("see [the check](ref://head/src/lib/util.ts#L12-L20)");
  expect(await r("before: [it](src/a/index.ts#base-L3)")).toBe("before: [it](ref://base/src/a/index.ts#L3)");
  expect(await r("in `src/lib/util.ts:7`")).toBe("in [`src/lib/util.ts:7`](ref://head/src/lib/util.ts#L7)");
  expect(await r("at src/lib/util.ts:7–9, then")).toBe("at [src/lib/util.ts:7–9](ref://head/src/lib/util.ts#L7-L9), then");
  expect(await r("[route](pages/[id]/page.tsx#L4)")).toBe("[route](ref://head/pages/%5Bid%5D/page.tsx#L4)");
});
test("completes a short path when one file fits, preferring the PR's", async () => {
  expect(await r("`util.ts:5`")).toBe("[`util.ts:5`](ref://head/src/lib/util.ts#L5)");
  expect(await r("`index.ts:5`")).toBe("[`index.ts:5`](ref://head/src/a/index.ts#L5)"); // two fit; one is the PR's
  expect(await r("`old.ts:2`")).toBe("[`old.ts:2`](ref://base/src/old.ts#L2)"); // gone at head
});
test("leaves what doesn't resolve as text", async () => {
  expect(await r("[gone](src/nope.ts#L3)")).toBe("gone");
  expect(await r("`src/lib/util.ts:99`")).toBe("`src/lib/util.ts:99`"); // past its end
  expect(await r("at 12:30, localhost:8080, `x:3`")).toBe("at 12:30, localhost:8080, `x:3`");
  expect(await r("[docs](https://example.com/a.ts#L3)")).toBe("[docs](https://example.com/a.ts#L3)");
  expect(await r("```\nsrc/lib/util.ts:7\n```")).toBe("```\nsrc/lib/util.ts:7\n```");
});
test("turns references into GitHub links for a posted comment", () => {
  const pr = { provider: "github", owner: "o", repo: "r", headSha: "H", baseSha: "B" } as ReviewGraph["pr"];
  expect(refsForGitHub("[x](ref://head/src/a.ts#L3-L5) [y](ref://base/b.ts#L1)", pr)).toBe("[x](https://github.com/o/r/blob/H/src/a.ts#L3-L5) [y](https://github.com/o/r/blob/B/b.ts#L1)");
  expect(refsForGitHub("[x](ref://head/src/a.ts#L3)", { ...pr, provider: "local" })).toBe("x");
});
