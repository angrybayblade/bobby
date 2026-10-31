import { expect, test } from "bun:test";
import { normalize } from "../src/map.ts";

const node = (id: string, more: object = {}) => ({ id, label: id, kind: "step", status: "same", group: "", note: "", points: [], before: [], ref: "", ...more });
const edge = (from: string, to: string, more: object = {}) => ({ from, to, label: "", status: "same", before: "", ...more });
const raw = {
  scope: "Where charges are retried.", effect: "Customers whose card fails once.", summary: "Failed charges are retried by a worker.",
  layers: [
    { name: "Checkout", about: "What a customer goes through.", nodes: [node("pay"), node("charge", { status: "changed", points: ["fails: retry ×3"], before: ["fails: error"] }), node("done", { kind: "outcome" }), node("pay", { label: "duplicate" })],
      edges: [edge("pay", "charge"), edge("charge", "done", { status: "changed", label: "after retries", before: "at once" }), edge("pay", "worker")] },
    { name: "Inside", about: "", nodes: [node("worker", { kind: "service", status: "added", ref: "src/worker.ts#L3" }), node("odd", { kind: "spaceship", status: "exploded" }), node("pay")],
      edges: [edge("worker", "odd", { status: "added", before: "ignored" })] },
    { name: "Empty", about: "", nodes: [], edges: [] },
  ],
};

test("a map is made safe to draw, layer by layer", () => {
  const m = normalize(raw);
  expect(m.layers.map((l) => l.name)).toEqual(["Checkout", "Inside"]); // a layer with nothing on it is dropped
  const [top, inside] = m.layers;
  expect(top.nodes.map((n) => n.id)).toEqual(["pay", "charge", "done"]); // the duplicate id is dropped
  expect(inside.nodes.map((n) => n.id)).toEqual(["worker", "odd"]); // ids are unique across layers too
  expect(top.nodes[1]).toEqual({ id: "charge", label: "charge", kind: "step", status: "changed", points: ["fails: retry ×3"], before: ["fails: error"] });
  expect(inside.nodes[1]).toMatchObject({ kind: "step", status: "same" }); // unknown kind and status fall back
  expect(top.edges).toEqual([ // an edge to a node on another layer is dropped; only a changed edge keeps what it was
    { from: "pay", to: "charge", label: "", status: "same" },
    { from: "charge", to: "done", label: "after retries", status: "changed", before: "at once" },
  ]);
  expect(inside.edges).toEqual([{ from: "worker", to: "odd", label: "", status: "added" }]);
  expect(m).toMatchObject({ scope: "Where charges are retried.", effect: "Customers whose card fails once." });
});
