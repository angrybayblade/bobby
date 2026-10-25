import { expect, test } from "bun:test";
import { place } from "../src/agent.ts";
import type { ReviewGraph } from "../src/graph.ts";

// a.ts: line 10 unchanged, 11 added (old 11 removed), 12 unchanged
const g = { hunks: [{ id: "h1", file: "a.ts", lines: [
  { t: " ", o: 10, n: 10, s: "x" }, { t: "-", o: 11, n: null, s: "old" }, { t: "+", o: null, n: 11, s: "new" }, { t: " ", o: 12, n: 12, s: "y" },
] }] } as unknown as ReviewGraph;
const f = (o: object) => ({ path: "a.ts", side: "RIGHT" as const, line: 11, startLine: 0, severity: "bug" as const, title: " t ", body: " b ", ...o });

test("puts findings on the diff's lines", () => {
  const r = place(g, { summary: " s ", findings: [
    f({}), // as given
    f({ line: 40 }), // off the diff: the nearest line on its side
    f({ side: "LEFT", line: 11 }), // a removed line
    f({ line: 12, startLine: 10 }), // a range
    f({ line: 12, startLine: 12 }), // not a range
    f({ path: "b.ts" }), // a file the diff doesn't have: left out
    f({ severity: "wild" }), // an unknown severity: a risk
  ] });
  expect(r.left).toBe(1);
  expect(r.summary).toBe("s");
  expect(r.findings.map(({ side, line, startLine, severity }) => [side, line, startLine, severity])).toEqual([
    ["RIGHT", 11, undefined, "bug"], ["RIGHT", 12, undefined, "bug"], ["LEFT", 11, undefined, "bug"],
    ["RIGHT", 12, 10, "bug"], ["RIGHT", 12, undefined, "bug"], ["RIGHT", 11, undefined, "risk"],
  ]);
  expect(r.findings[0]).toMatchObject({ title: "t", body: "b", status: "open" });
});
