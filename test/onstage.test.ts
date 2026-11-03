import { expect, test } from "bun:test";
// @ts-expect-error: a browser module without types
import { nudge } from "../public/app/onstage.js";

const stage = { left: 0, right: 1000, top: 100, bottom: 900 };
const box = (left: number, top: number, w = 200, h = 100) => ({ left, right: left + w, top, bottom: top + h });

test("a box on the stage leaves the camera alone", () => {
  expect(nudge(box(100, 300), stage)).toEqual({ dx: 0, dy: 0 });
});

test("a box off an edge is brought just inside it", () => {
  expect(nudge(box(100, 850), stage).dy).toBe(62); // bottom 950, to 888
  expect(nudge(box(100, 50), stage).dy).toBe(-62); // top 50, to 112
  expect(nudge(box(900, 300), stage).dx).toBe(112);
  expect(nudge(box(-50, 300), stage).dx).toBe(-62);
});

test("a box too tall for the stage keeps its top in view", () => {
  expect(nudge(box(100, 300, 200, 2000), stage).dy).toBe(188); // top 300, to 112, not bottom 2300 to 888
});

// A scrollable stage scrolls itself to show a caret, and no camera knows it did: the canvas stays off by that much.
test("a canvas's stage can't scroll itself", async () => {
  for (const [file, rule] of [["diff", ".dv .stage"], ["flow", ".flow .stage"]]) {
    const css = (await Bun.file(`public/app/views/${file}.js`).text()).split("\n").find((l) => l.startsWith(`${rule} {`));
    expect(css).toContain("overflow: clip");
  }
});
