import { expect, test } from "bun:test";
import type { ReviewGraph } from "../src/graph.ts";
import { aboveHits, parseBlame, parseDiff0 } from "../src/stackctx.ts";

const A = "a".repeat(40), B = "b".repeat(40);

test("blame: each final line's commit, groups included", () => {
  const out = [`${A} 1 1 2`, "author x", "\tline one", `${A} 2 2`, "\tline two", `${B} 7 3 1`, "boundary", "\tline three"].join("\n");
  expect([...parseBlame(out)]).toEqual([[1, A], [2, A], [3, B]]);
});

const diff = `diff --git a/src/pay.ts b/src/pay.ts
index 1..2 100644
--- a/src/pay.ts
+++ b/src/pay.ts
@@ -10,2 +10,3 @@ export function charge
+  const key = retryKey(order);
+  return withRetry(key);
+  // done
@@ -40 +41,0 @@
diff --git a/src/old.ts b/src/old.ts
deleted file mode 100644
--- a/src/old.ts
+++ /dev/null
@@ -1,3 +0,0 @@
-gone
`;

test("diff -U0: old ranges and added lines, deleted files left out", () => {
  expect(parseDiff0(diff)).toEqual([
    { path: "src/pay.ts", oldStart: 10, oldCount: 2, newStart: 10, added: [{ line: 10, text: "  const key = retryKey(order);" }, { line: 11, text: "  return withRetry(key);" }, { line: 12, text: "  // done" }] },
    { path: "src/pay.ts", oldStart: 40, oldCount: 1, newStart: 41, added: [] },
  ]);
});

test("above: the lowest layer that changes a change further, and where layers use its distinct names", () => {
  const g = {
    hunks: [{ id: "h1", newStart: 9, lines: [{ t: "+", o: null, n: 9, s: "" }, { t: "+", o: null, n: 11, s: "" }] }, { id: "h2", newStart: 1, lines: [{ t: "+", o: null, n: 1, s: "" }] }, { id: "h3", newStart: 1, lines: [{ t: "+", o: null, n: 1, s: "" }] }],
    nodes: [
      { id: "chg:src/pay.ts#retryKey", kind: "change", name: "retryKey", file: "src/pay.ts", symbols: ["retryKey"], hunkIds: ["h1"] },
      { id: "chg:a.ts#router", kind: "change", name: "router", file: "a.ts", symbols: ["router"], hunkIds: ["h2"] },
      { id: "chg:b.ts#router", kind: "change", name: "router", file: "b.ts", symbols: ["router"], hunkIds: ["h3"] },
    ],
  } as unknown as ReviewGraph;
  const own = parseDiff0(diff), uses = parseDiff0("+++ b/src/api.ts\n@@ -3,0 +4 @@\n+  app.post(router, retryKey)\n");
  const hits = aboveHits([g], [{ number: 102, own, cumulative: own }, { number: 103, own: uses, cumulative: [...own, ...uses] }]);
  expect(hits["chg:src/pay.ts#retryKey"]).toEqual([
    { layer: 102, kind: "changes", path: "src/pay.ts", line: 10, text: "const key = retryKey(order);" }, // 102 first, not 103 as well
    { layer: 103, kind: "uses", path: "src/api.ts", line: 4, text: "app.post(router, retryKey)", name: "retryKey" }, // its own lines don't count as uses
  ]);
  expect(hits["chg:a.ts#router"]).toBeUndefined(); // too common a name to mean this code
});
