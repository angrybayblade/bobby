// End to end: extract a small repo's branch (no Claude, no language servers) and check the graph against the schema
// and the invariants views rely on.
import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import Ajv2020 from "ajv/dist/2020.js";
import schema from "../schema/review-graph.v1.schema.json" with { type: "json" };
import { GRAPH_SCHEMA, VERSION, type ReviewGraph } from "../src/graph.ts";
import pkg from "../package.json" with { type: "json" };

const root = mkdtempSync(join(tmpdir(), "bobby-test-"));
const repo = join(root, "repo"), home = join(root, "home");
// Without git's own variables: run from a commit hook, GIT_INDEX_FILE (and friends) would point these commands, and
// bobby's, at the repo being committed to.
const env = { ...Object.fromEntries(Object.entries(process.env).filter(([k]) => !k.startsWith("GIT_"))), HOME: home };
const sh = (cmd: string[]) => {
  const r = Bun.spawnSync(cmd, { cwd: repo, env: { ...env, GIT_CONFIG_GLOBAL: "/dev/null" } });
  if (r.exitCode !== 0) throw new Error(`${cmd.join(" ")}: ${r.stderr.toString()}`);
  return r.stdout.toString();
};
const write = (path: string, text: string) => { mkdirSync(join(repo, path, ".."), { recursive: true }); writeFileSync(join(repo, path), text); };
const git = (...args: string[]) => sh(["git", "-c", "user.name=t", "-c", "user.email=t@t", ...args]);

let graph: ReviewGraph;
beforeAll(() => {
  mkdirSync(repo, { recursive: true });
  mkdirSync(home, { recursive: true });
  git("init", "-q", "-b", "main");
  write("src/limit.ts", `export function limit(n: number) {\n  return Math.min(n, 10);\n}\n`);
  write("src/api.ts", `import { limit } from "./limit";\n\nexport function handler(n: number) {\n  return limit(n);\n}\n`);
  write("app/util.py", `def clamp(x):\n    return max(0, x)\n`);
  git("add", "-A");
  git("commit", "-qm", "base");
  git("checkout", "-qb", "feature");
  write("src/limit.ts", `export const MAX = 20;\n\nexport function limit(n: number, max = MAX) {\n  return Math.min(n, max);\n}\n`);
  write("app/util.py", `def clamp(x, lo=0):\n    return max(lo, x)\n`);
  write("src/new.ts", `import { MAX } from "./limit";\nexport const half = MAX / 2;\n`);
  git("add", "-A");
  git("commit", "-qm", "raise the limit");
  const cli = join(import.meta.dir, "..", "src", "cli.ts"), out = join(root, "graph.json");
  const r = Bun.spawnSync(["bun", cli, "extract", "--no-llm", "--base", "main", "--repo", repo, "-o", out], { env });
  if (r.exitCode !== 0) throw new Error(r.stderr.toString() + r.stdout.toString());
  graph = JSON.parse(readFileSync(out, "utf8"));
});
afterAll(() => rmSync(root, { recursive: true, force: true }));

describe("an extracted graph", () => {
  test("validates against the v1 schema", () => {
    const validate = new Ajv2020({ allErrors: true, validateFormats: false }).compile(schema);
    expect(validate(graph) ? [] : validate.errors).toEqual([]);
    expect(graph.schema).toBe(GRAPH_SCHEMA);
  });

  test("is a local review of the branch", () => {
    expect(graph.pr).toMatchObject({ provider: "local", branch: "feature", baseRef: "main", number: 0, title: "raise the limit" });
    expect(graph.generator.tree).toBe("static");
  });

  test("has every changed file and its hunks", () => {
    expect(graph.files.map((f) => [f.path, f.status]).sort()).toEqual([["app/util.py", "modified"], ["src/limit.ts", "modified"], ["src/new.ts", "added"]]);
    const files = new Set(graph.files.map((f) => f.path));
    for (const h of graph.hunks) expect(files.has(h.file)).toBe(true);
  });

  test("refers only to ids it has", () => {
    const nodes = new Set(graph.nodes.map((n) => n.id)), hunks = new Set(graph.hunks.map((h) => h.id));
    const placements = new Map(graph.cores.flatMap((c) => Object.values(c.bands).flat().map((p) => [p.id, p] as const)));
    for (const p of placements.values()) expect(nodes.has(p.node)).toBe(true);
    for (const n of graph.nodes) if (n.kind === "change") for (const h of n.hunkIds) expect(hunks.has(h)).toBe(true);
    for (const e of graph.edges) { expect(placements.has(e.from)).toBe(true); expect(placements.has(e.to)).toBe(true); }
    for (const id of graph.walk) expect(placements.has(id) || id === "low").toBe(true);
  });

  test("shows every changed hunk somewhere", () => {
    const shown = new Set([...graph.nodes.flatMap((n) => (n.kind === "change" ? n.hunkIds : [])), ...graph.lowSignal]);
    for (const h of graph.hunks) expect(shown.has(h.id)).toBe(true);
  });

  test("traces a name to where it's declared", () => {
    const defs = graph.definitions?.["src/new.ts"] ?? [];
    expect(defs.find((d) => d.name === "MAX" && d.line === 2)?.to).toMatchObject({ path: "src/limit.ts", line: 1 });
  });
});
