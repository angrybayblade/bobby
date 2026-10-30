import { expect, test } from "bun:test";
import { normalize } from "../src/map.ts";

const raw = {
  level: "service", why: "A new worker retries charges.", summary: "Failed charges are retried by a worker.",
  nodes: [
    { id: "api", label: "Charges API", kind: "service", status: "same", group: "payments", note: "", ref: "" },
    { id: "worker", label: "Retry worker", kind: "service", status: "added", group: "payments", note: "new", ref: "src/worker.ts#L3" },
    { id: "stripe", label: "Stripe", kind: "external", status: "same", group: "", note: "", ref: "" },
    { id: "api", label: "duplicate", kind: "service", status: "same", group: "", note: "", ref: "" },
    { id: "odd", label: "Odd", kind: "spaceship", status: "exploded", group: "", note: "", ref: "" },
  ],
  edges: [
    { from: "api", to: "ghost", label: "nowhere", status: "same", before: "" },
    { from: "api", to: "stripe", label: "charges once", status: "changed", before: "charges, fails" },
    { from: "worker", to: "stripe", label: "retries ×3", status: "added", before: "ignored" },
  ],
  changes: [{ title: "Charges retry", detail: "Before, a failure was final.", nodes: ["worker", "ghost"], edges: [0, 1, 2] }, { title: "", detail: "x", nodes: [], edges: [] }],
};

test("a map is made safe to draw", () => {
  const m = normalize(raw);
  expect(m.level).toBe("service");
  expect(m.nodes.map((n) => n.id)).toEqual(["api", "worker", "stripe", "odd"]); // the duplicate id is dropped
  expect(m.nodes[3]).toMatchObject({ kind: "module", status: "same" }); // unknown kind and status fall back
  expect(m.nodes[0]).toEqual({ id: "api", label: "Charges API", kind: "service", status: "same", group: "payments" }); // empty fields left out
  expect(m.edges).toEqual([ // the edge to a missing node is dropped; only a changed edge keeps what it was
    { from: "api", to: "stripe", label: "charges once", status: "changed", before: "charges, fails" },
    { from: "worker", to: "stripe", label: "retries ×3", status: "added" },
  ]);
  expect(m.changes).toEqual([{ title: "Charges retry", detail: "Before, a failure was final.", nodes: ["worker"], edges: [0, 1] }]); // indexes follow the edges kept
});

test("the level the reviewer asked for is kept", () => {
  expect(normalize({ ...raw, level: "nonsense" }, "user")).toMatchObject({ level: "user", asked: "user" });
  expect(normalize({ ...raw, level: "nonsense" }).level).toBe("module");
});
