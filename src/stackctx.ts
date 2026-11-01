// What a PR's neighbours in its stack have to do with its code. Below: unchanged code this PR relies on or affects that
// a PR lower in the stack wrote (git blame, from the trunk to this PR's head, each commit read as the lowest layer that
// has it), so you know it's still under review there, not settled code. Above: where the PRs built on this one change
// its changes further, or use what it adds (their own diffs, read against this PR's head). Read from the clone, after
// fetching each layer's head; nothing here goes to GitHub.
import { ghCredentials, git, remoteFor, run } from "./git.ts";
import type { ReviewGraph } from "./graph.ts";
import type { Stack } from "./stack.ts";
import type { PrInfo } from "./types.ts";

export interface BelowHit { layer: number; lines: number[] } // lines (head's numbering) the layer below wrote
export interface AboveHit { layer: number; kind: "changes" | "uses"; path: string; line: number; text: string; name?: string } // name: what it uses
export interface StackContext {
  below: Record<string, BelowHit>; // context node id → the lower layer that wrote most of its lines
  above: Record<string, AboveHit[]>; // change node id → where layers above change it further or use it
}

// ---------------------------------------------------------------- parsing (pure)
/** git blame --porcelain: each final line's commit. */
export function parseBlame(out: string): Map<number, string> {
  const at = new Map<number, string>();
  for (const line of out.split("\n")) {
    const m = line.match(/^([0-9a-f]{40}) \d+ (\d+)(?: (\d+))?$/);
    if (!m) continue;
    const n = Number(m[2]), count = Number(m[3] ?? 1);
    for (let k = 0; k < count; k++) at.set(n + k, m[1]);
  }
  return at;
}

export interface Hunk0 { path: string; oldStart: number; oldCount: number; newStart: number; added: Array<{ line: number; text: string }> }
/** git diff -U0: each hunk's old range in the file it changed, and its added lines with their new numbers. */
export function parseDiff0(out: string): Hunk0[] {
  const hunks: Hunk0[] = [];
  let path = "", cur: Hunk0 | null = null, n = 0;
  for (const line of out.split("\n")) {
    if (line.startsWith("+++ ")) { path = line.startsWith("+++ b/") ? line.slice(6) : ""; cur = null; continue; }
    if (line.startsWith("--- ") || line.startsWith("diff ") || line.startsWith("index ")) continue;
    const h = line.match(/^@@ -(\d+)(?:,(\d+))? \+(\d+)(?:,(\d+))? @@/);
    if (h) {
      if (!path) { cur = null; continue; } // a deleted file: nothing above to point at
      cur = { path, oldStart: Number(h[1]), oldCount: h[2] === undefined ? 1 : Number(h[2]), newStart: Number(h[3]), added: [] };
      n = cur.newStart;
      hunks.push(cur);
      continue;
    }
    if (cur && line.startsWith("+")) cur.added.push({ line: n++, text: line.slice(1) });
  }
  return hunks;
}

/** The lines (head's numbering) each change node's hunks cover, and the names it changes. */
function changeNodes(graphs: ReviewGraph[], old = new Set<string>()) {
  const out = new Map<string, { path: string; ranges: Array<[number, number]>; names: string[] }>();
  for (const g of graphs) {
    const hunk = new Map(g.hunks.map((h) => [h.id, h]));
    for (const node of g.nodes) {
      if (node.kind !== "change" || out.has(node.id)) continue;
      const ranges = node.hunkIds.map((id) => hunk.get(id)).filter(Boolean).map((h) => {
        const nums = h!.lines.filter((l) => l.t !== "-").map((l) => l.n!).filter(Boolean);
        return [Math.min(...nums, h!.newStart), Math.max(...nums, h!.newStart)] as [number, number];
      });
      out.set(node.id, { path: node.file, ranges, names: node.symbols });
    }
  }
  // Only names distinct enough to mean this code when they turn up elsewhere: camelCase, PascalCase or SNAKE_CASE, five
  // characters or more, and changed by this one node (router, handler and the like are in every other file).
  const count = new Map<string, number>();
  for (const n of out.values()) for (const s of new Set(n.names)) count.set(s, (count.get(s) ?? 0) + 1);
  for (const n of out.values()) n.names = n.names.filter((s) => s.length >= 5 && /^[A-Za-z_$][\w$]*$/.test(s) && /[A-Z_]/.test(s.slice(1)) && count.get(s) === 1 && !old.has(s));
  return out;
}

/** Where layers above touch this PR's changes: own is layer k's own diff (against the one below it), cumulative
 *  everything from this PR's head up to layer k. A change node is changed further by the lowest layer whose cumulative
 *  diff overlaps its lines, and used wherever a layer's own added lines name something it adds: old holds the names the
 *  code had before this PR (orgId, config…), which name plenty else. */
export function aboveHits(graphs: ReviewGraph[], layers: Array<{ number: number; own: Hunk0[]; cumulative: Hunk0[] }>, old = new Set<string>(), cap = 6): Record<string, AboveHit[]> {
  const out: Record<string, AboveHit[]> = {};
  const add = (id: string, h: AboveHit) => { (out[id] ??= []).length < cap && out[id].push(h); };
  for (const [id, node] of changeNodes(graphs, old)) {
    const claimed = layers.find((l) => l.cumulative.some((h) => h.path === node.path && node.ranges.some(([a, b]) => h.oldStart <= b && h.oldStart + Math.max(h.oldCount, 1) - 1 >= a)));
    if (claimed) {
      const h = claimed.cumulative.find((x) => x.path === node.path && node.ranges.some(([a, b]) => x.oldStart <= b && x.oldStart + Math.max(x.oldCount, 1) - 1 >= a))!;
      add(id, { layer: claimed.number, kind: "changes", path: h.path, line: h.added[0]?.line ?? h.newStart, text: h.added[0]?.text.trim() ?? "" });
    }
    if (!node.names.length) continue;
    const word = new RegExp(`(^|[^\\w$])(${node.names.map((s) => s.replace(/\$/g, "\\$")).join("|")})(?![\\w$])`);
    for (const l of layers)
      for (const h of l.own)
        for (const a of h.added)
          if (!(h.path === node.path && node.ranges.some(([x, y]) => a.line >= x && a.line <= y))) {
            const m = a.text.match(word);
            if (m) add(id, { layer: l.number, kind: "uses", path: h.path, line: a.line, text: a.text.trim().slice(0, 160), name: m[2] });
          }
  }
  return out;
}

// ---------------------------------------------------------------- reading the clone
const ref = (n: number) => `refs/bobby/stack/${n}`;

export async function stackContext(cwd: string, pr: PrInfo, stack: Stack, graphs: ReviewGraph[]): Promise<StackContext> {
  const remote = (await remoteFor(cwd, pr.owner, pr.repo)) ?? "origin";
  const others = stack.layers.filter((l) => l.number !== pr.number);
  await git(cwd, [...ghCredentials(), "fetch", "--quiet", "--no-tags", remote, `+refs/heads/${stack.trunk}:refs/bobby/stack/trunk`,
    ...others.map((l) => `+refs/pull/${l.number}/head:${ref(l.number)}`)], true);
  const has = async (r: string) => !!(await git(cwd, ["rev-parse", "--verify", "--quiet", `${r}^{commit}`], true)).trim();
  const fetched = new Set<number>();
  for (const l of others) if (await has(ref(l.number))) fetched.add(l.number);
  const head = pr.headSha;
  return { below: await belowHits(cwd, head, stack, fetched, graphs), above: await aboveOf(cwd, head, pr.baseSha, stack, fetched, graphs) };
}

async function belowHits(cwd: string, head: string, stack: Stack, fetched: Set<number>, graphs: ReviewGraph[]): Promise<Record<string, BelowHit>> {
  const lower = stack.layers.slice(0, stack.at).filter((l) => fetched.has(l.number));
  const trunkTip = (await git(cwd, ["rev-parse", "--verify", "--quiet", "refs/bobby/stack/trunk^{commit}"], true)).trim();
  if (!lower.length || !trunkTip) return {};
  const base = (await git(cwd, ["merge-base", trunkTip, head], true)).trim();
  if (!base) return {};
  // each commit as the lowest layer that has it; a layer whose commits this PR doesn't have (merged by squash, or one you
  // put in the stack that isn't under it) simply has none
  const layerOf = new Map<string, number>();
  for (const l of lower) {
    const shas = (await git(cwd, ["rev-list", `${base}..${ref(l.number)}`], true)).split("\n").filter(Boolean);
    for (const s of shas) if (!layerOf.has(s)) layerOf.set(s, l.number);
  }
  if (!layerOf.size) return {};
  const contexts = new Map<string, { path: string; from: number; to: number }>();
  for (const g of graphs) for (const n of g.nodes) if (n.kind === "context" && !contexts.has(n.id)) contexts.set(n.id, { path: n.location.path, from: n.snippet.start, to: n.snippet.start + n.snippet.lines.length - 1 });
  const paths = [...new Set([...contexts.values()].map((c) => c.path))].slice(0, 80);
  const blame = new Map<string, Map<number, string>>();
  await Promise.all(paths.map(async (p) => blame.set(p, parseBlame(await git(cwd, ["blame", "--porcelain", `${base}..${head}`, "--", p], true)))));
  const out: Record<string, BelowHit> = {};
  for (const [id, c] of contexts) {
    const at = blame.get(c.path);
    if (!at) continue;
    const by = new Map<number, number[]>();
    for (let n = c.from; n <= c.to; n++) {
      const layer = layerOf.get(at.get(n) ?? "");
      if (layer) by.set(layer, [...(by.get(layer) ?? []), n]);
    }
    const top = [...by].sort((a, b) => b[1].length - a[1].length)[0];
    if (top) out[id] = { layer: top[0], lines: top[1] };
  }
  return out;
}

async function aboveOf(cwd: string, head: string, baseSha: string, stack: Stack, fetched: Set<number>, graphs: ReviewGraph[]): Promise<Record<string, AboveHit[]>> {
  const upper = stack.layers.slice(stack.at + 1).filter((l) => l.state !== "MERGED" && l.state !== "CLOSED" && fetched.has(l.number));
  if (!upper.length) return {};
  const layers = [];
  let prev = head;
  for (const l of upper) {
    const own = parseDiff0(await git(cwd, ["diff", "-U0", "--no-color", "--no-ext-diff", `${prev}...${ref(l.number)}`], true));
    // read against this PR's head when the layer is built on it; otherwise (a stack you defined of unrelated PRs) its own diff
    const onTop = (await Bun.spawn(["git", "merge-base", "--is-ancestor", head, ref(l.number)], { cwd, stderr: "ignore" }).exited) === 0;
    const cumulative = onTop ? parseDiff0(await git(cwd, ["diff", "-U0", "--no-color", "--no-ext-diff", head, ref(l.number)], true)) : [];
    layers.push({ number: l.number, own, cumulative });
    prev = ref(l.number);
  }
  // Uses only of names this PR adds: the ones the code already had before it (orgId, config…) name plenty else. One git
  // grep, for just the names that turned up.
  const hits = aboveHits(graphs, layers);
  const names = [...new Set(Object.values(hits).flat().flatMap((h) => (h.name ? [h.name] : [])))];
  if (!names.length) return hits;
  const before = await git(cwd, ["grep", "-h", "-o", "-w", "-F", ...names.flatMap((x) => ["-e", x]), baseSha, "--"], true);
  return aboveHits(graphs, layers, new Set(before.split("\n").map((l) => l.trim()).filter(Boolean)));
}

// ---------------------------------------------------------------- restacks
/** Whether moving to newHead (based on baseRef) leaves this PR's own changes as they were: the same patch from its
 *  merge-base, as after a restack on a moved PR below, or a rebase. Fetches the new head and base; false when unsure. */
export async function sameOwnChanges(cwd: string, pr: PrInfo, newHead: string, baseRef: string): Promise<boolean> {
  const remote = (await remoteFor(cwd, pr.owner, pr.repo)) ?? "origin", ns = `refs/bobby/${pr.number}`;
  await git(cwd, [...ghCredentials(), "fetch", "--quiet", "--no-tags", remote, `+refs/pull/${pr.number}/head:${ns}/next`, `+refs/heads/${baseRef}:${ns}/nextbase`], true);
  const next = (await git(cwd, ["rev-parse", "--verify", "--quiet", `${ns}/next^{commit}`], true)).trim();
  if (next !== newHead) return false; // moved again meanwhile: the next check looks
  const base = (await git(cwd, ["merge-base", `${ns}/nextbase`, next], true)).trim();
  return !!base && samePatch(cwd, [pr.baseSha, pr.headSha], [base, next]);
}
/** Whether two ranges make the same change (git patch-id: the same diff, wherever it sits). */
export async function samePatch(cwd: string, was: [string, string], now: [string, string]): Promise<boolean> {
  const id = async ([a, b]: [string, string]) => {
    const diff = await git(cwd, ["diff", "--no-color", "--no-ext-diff", a, b], true);
    return diff.trim() ? (await run(["git", "patch-id", "--stable"], { cwd, input: diff, allowFail: true })).split(" ")[0] : "";
  };
  const [x, y] = await Promise.all([id(was), id(now)]);
  return !!x && x === y;
}
