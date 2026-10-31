import { expect, test } from "bun:test";
// @ts-expect-error: a browser module without types
import { mapLayout, settle } from "../public/app/views/maplayout.js";

type Box = { x: number; y: number; w: number; h: number };
const overlap = (a: Box, b: Box) => a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h;
const n = (id: string) => ({ id, w: 200, h: 60 });
const lbl = { w: 120, h: 18 };

test("lays boxes out top to bottom, with each label clear of every box and other label", () => {
  const nodes = ["user", "api", "auth", "limiter", "redis", "admin"].map(n);
  const edges = [["user", "api"], ["api", "auth"], ["auth", "limiter"], ["api", "limiter"], ["limiter", "redis"], ["admin", "redis"], ["api", "redis"], ["redis", "api"]]
    .map(([from, to]) => ({ from, to, label: lbl }));
  const lay = mapLayout(nodes, edges);
  const y = (id: string) => lay.nodes.get(id).y;
  expect(y("user")).toBeLessThan(y("api"));
  expect(y("auth")).toBeLessThan(y("limiter"));
  expect(y("limiter")).toBeLessThan(y("redis"));
  expect(y("admin")).toBe(y("limiter")); // a source sits just above what it feeds
  const boxes: Box[] = [...lay.nodes.values()];
  const labels: Box[] = lay.edges.map((e: any) => ({ x: e.label.x - lbl.w / 2, y: e.label.y - lbl.h / 2, w: lbl.w, h: lbl.h }));
  const all = [...boxes, ...labels];
  for (let i = 0; i < all.length; i++) for (let j = i + 1; j < all.length; j++) expect(overlap(all[i], all[j])).toBe(false);
  const back = lay.edges[7].points; // redis → api goes up, and still ends at api
  expect(back[0][1]).toBeGreaterThan(back.at(-1)[1]);
  for (const e of lay.edges) for (const [px, py] of e.points) { expect(px).toBeGreaterThanOrEqual(0); expect(py).toBeGreaterThanOrEqual(0); }
});

test("settles a row as near to where its items want to be as the room between them allows", () => {
  const row = [{ w: 10 }, { w: 10 }, { w: 10 }], room = () => 20;
  expect(settle(row, [0, 100, 200], room)).toEqual([0, 100, 200]);
  expect(settle(row, [50, 50, 50], room)).toEqual([30, 50, 70]);
});
