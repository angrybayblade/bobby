import { afterEach, beforeEach, expect, test } from "bun:test";
// @ts-expect-error: a browser module without types
import { replying, stacked } from "../public/app/keepplace.js";

// ---- typing through a redraw: the code is replaced under you, textarea included
class Box {
  selectionStart = 5; selectionEnd = 9; scrollTop = 40; focused: unknown = null; range: number[] = [];
  constructor(readonly attr: string, readonly value = "") {}
  matches(sel: string) { return sel === `textarea[${this.attr}]`; }
  getAttribute() { return this.value; }
  focus(o: unknown) { this.focused = o; }
  setSelectionRange(a: number, b: number) { this.range = [a, b]; }
}
const holder = (box: Box | null, next: Box | null = box) => ({ contains: (x: unknown) => x === box, querySelector: () => next });
const g = globalThis as unknown as { document?: unknown; CSS?: unknown };
let was: [unknown, unknown];
beforeEach(() => { was = [g.document, g.CSS]; g.CSS = { escape: (s: string) => s }; });
afterEach(() => { [g.document, g.CSS] = was; });

test("the caret and the box's scroll come back on the box that replaces it, without scrolling to it", () => {
  const old = new Box("data-composer"), fresh = new Box("data-composer");
  g.document = { activeElement: old };
  replying(holder(old, fresh))();
  expect(fresh.range).toEqual([5, 9]);
  expect(fresh.scrollTop).toBe(40);
  expect(fresh.focused).toEqual({ preventScroll: true }); // or the browser moves the stage to it
});

test("each kind of box you type in is kept", () => {
  for (const attr of ["data-composer", "data-rbox", "data-gedit"]) {
    const old = new Box(attr, "t1"), fresh = new Box(attr, "t1");
    g.document = { activeElement: old };
    replying(holder(old, fresh))();
    expect(fresh.range).toEqual([5, 9]);
  }
});

test("typing elsewhere, or in another box, takes no focus", () => {
  const elsewhere = new Box("data-composer");
  g.document = { activeElement: elsewhere };
  expect(replying(holder(null))).toBeNull();
  g.document = { activeElement: new Box("data-search") };
  expect(replying(holder(new Box("data-composer")))).toBeNull();
});

test("a box gone after the redraw is no error", () => {
  const old = new Box("data-composer");
  g.document = { activeElement: old };
  expect(() => replying(holder(old, null))()).not.toThrow();
});

// ---- a file changing size
const at = (col: Array<{ y0: number; h: number; id: string }>, gap = 10) => Object.fromEntries(stacked(col, gap).map(([v, y]: [{ id: string }, number]) => [v.id, y]));

test("a file that grows into the space below it moves nothing", () => {
  expect(at([{ id: "a", y0: 0, h: 150, }, { id: "b", y0: 200, h: 100 }])).toEqual({ a: 0, b: 200 });
});

test("a file that would cover the next moves it only as far as it must, and on down the column", () => {
  expect(at([{ id: "a", y0: 0, h: 300 }, { id: "b", y0: 200, h: 100 }, { id: "c", y0: 330, h: 50 }, { id: "d", y0: 1000, h: 50 }]))
    .toEqual({ a: 0, b: 310, c: 420, d: 1000 });
});

test("what moved goes back when the file shrinks, since each keeps where it was laid out", () => {
  expect(at([{ id: "a", y0: 0, h: 100 }, { id: "b", y0: 200, h: 100 }])).toEqual({ a: 0, b: 200 });
});

test("takes the column in laid-out order, whatever order it's given", () => {
  expect(at([{ id: "b", y0: 200, h: 100 }, { id: "a", y0: 0, h: 300 }])).toEqual({ a: 0, b: 310 });
});

// ---- no browser here, so these two hold the order of the steps, which is the whole of the fix
const source = (file: string) => Bun.file(`public/app/${file}`).text();

test("a viewer's scroll goes back after it's measured, not before: measuring sends it to the top", async () => {
  const fn = (await source("views/diff.js")).split("function remeasure(")[1].split("\n    }\n")[0];
  expect(fn).toContain("layout(new Set(paths))");
  expect(fn.indexOf("layout(new Set(paths))")).toBeLessThan(fn.indexOf("scrollTop = tops"));
  const refresh = (await source("views/diff.js")).split("function refresh()")[1].split("\n    }\n")[0];
  expect(refresh.indexOf("scrollTop")).toBeLessThan(refresh.indexOf("app.renderFile"));
});

test("the comment box comes before its line's threads, or a long thread pushes the line away", async () => {
  const code = await source("code.js");
  const inline = code.split("\n").find((l) => l.includes("cmLine((composing ?"))!, split = code.split("\n").find((l) => l.includes("const side = (k) =>"))!;
  for (const line of [inline, split]) expect(line.indexOf("composer(app")).toBeLessThan(line.indexOf("threadsAt(app"));
});
