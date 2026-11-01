// A PR's stack: the PRs it sits on and the ones built on it, bottom (nearest the trunk) first. GitHub's own stack when
// the PR is in one; else one you defined in Bobby (kept in ~/.bobby/stacks.json, never sent to GitHub); else one
// followed through branches: an open PR whose head is this one's base sits below it, and the one open PR whose base is
// this one's head sits above (with several, the stack forks there, and stops). Read live, like the conversation: it
// moves as layers merge and restack. Each PR is still its own review, against its own base.
import { renameSync } from "node:fs";
import { join } from "node:path";
import { run } from "./git.ts";
import { home } from "./state.ts";

export interface Layer {
  number: number; title: string; url: string; author: string;
  state: "OPEN" | "CLOSED" | "MERGED"; draft: boolean;
  head: string; base: string; headSha: string; // branch names, and the head's commit
}
export interface Stack {
  source: "github" | "yours" | "branches";
  trunk: string; // the branch the bottom layer targets
  layers: Layer[]; // bottom first
  at: number; // this PR's index in layers
}
type Repo = { owner: string; repo: string };
type Raw = any; // eslint-disable-line @typescript-eslint/no-explicit-any

const LAYER = "number title url state isDraft headRefName baseRefName headRefOid isCrossRepository author { login }";
const layerOf = (p: Raw): Layer => ({
  number: p.number, title: p.title, url: p.url, author: p.author?.login ?? "", state: p.state, draft: !!p.isDraft,
  head: p.headRefName, base: p.baseRefName, headSha: p.headRefOid,
});
const MAX = 12; // layers each way: past that it's not a stack anyone reviews

async function graphql(query: string, vars: Record<string, string | number> = {}): Promise<Raw> {
  const args = Object.entries(vars).flatMap(([k, v]) => [typeof v === "number" ? "-F" : "-f", `${k}=${v}`]);
  return JSON.parse(await run(["gh", "api", "graphql", "-f", `query=${query}`, ...args])).data;
}

/** The PR's stack, or null when it stands alone. */
export async function stackOf(pr: Repo & { number: number }): Promise<Stack | null> {
  const d = await graphql(`query($owner: String!, $repo: String!, $n: Int!) { repository(owner: $owner, name: $repo) { defaultBranchRef { name } pullRequest(number: $n) { ${LAYER}
    stackEntry { stack { baseRefName entries(first: 50) { nodes { position pullRequest { ${LAYER} } } } } } } } }`, { owner: pr.owner, repo: pr.repo, n: pr.number });
  const me: Raw = d.repository.pullRequest;
  const native: Raw = me.stackEntry?.stack;
  if (native) {
    const layers = [...native.entries.nodes].sort((a: Raw, b: Raw) => a.position - b.position).map((e: Raw) => layerOf(e.pullRequest));
    const at = layers.findIndex((l) => l.number === pr.number);
    if (layers.length > 1 && at >= 0) return { source: "github", trunk: native.baseRefName, layers, at };
  }
  const chain = savedChain(await loadSaved(), pr, pr.number);
  if (chain) {
    const layers = await layersOf(pr, chain);
    const at = layers.findIndex((l) => l.number === pr.number);
    if (layers.length > 1 && at >= 0) return { source: "yours", trunk: layers[0].base, layers, at };
  }
  return followBranches(pr, layerOf(me), d.repository.defaultBranchRef?.name ?? "");
}

/** Each of these PRs, in this order, in one query; any that's gone is left out. */
async function layersOf(r: Repo, numbers: number[]): Promise<Layer[]> {
  const d = await graphql(`query($owner: String!, $repo: String!) { repository(owner: $owner, name: $repo) {
    ${numbers.map((n) => `p${n}: pullRequest(number: ${n}) { ${LAYER} }`).join("\n")} } }`, { owner: r.owner, repo: r.repo }).catch((e) => {
    if (/Could not resolve to a PullRequest/i.test(String(e.message))) return null; // one's missing: read them one by one
    throw e;
  });
  if (d) return numbers.map((n) => d.repository[`p${n}`]).filter(Boolean).map(layerOf);
  if (numbers.length === 1) return [];
  const each = await Promise.all(numbers.map((n) => layersOf(r, [n]).catch(() => [])));
  return each.flat();
}

/** The stack branches make: up through bases, down through heads, a step each way per query. Never below the default
 *  branch: a PR from main into a release branch isn't the layer under everything based on main. */
async function followBranches(r: Repo, me: Layer, trunk: string): Promise<Stack | null> {
  const below: Layer[] = [], above: Layer[] = [];
  const seen = new Set([me.number]);
  let down: Layer | null = me.base === trunk ? null : me, up: Layer | null = me;
  for (let k = 0; k < MAX && (down || up); k++) {
    const d = await graphql(`query($owner: String!, $repo: String!${down ? ", $base: String!" : ""}${up ? ", $head: String!" : ""}) { repository(owner: $owner, name: $repo) {
      ${down ? `below: pullRequests(headRefName: $base, states: [OPEN], first: 5) { nodes { ${LAYER} } }` : ""}
      ${up ? `above: pullRequests(baseRefName: $head, states: [OPEN], first: 5) { nodes { ${LAYER} } }` : ""} } }`,
      { owner: r.owner, repo: r.repo, ...(down ? { base: down.base } : {}), ...(up ? { head: up.head } : {}) });
    const ours = (nodes: Raw[] = []) => nodes.filter((p) => !p.isCrossRepository && !seen.has(p.number)).map(layerOf); // a fork's branch of the same name isn't this stack
    const b = ours(d.repository.below?.nodes), a = ours(d.repository.above?.nodes);
    down = b.length === 1 ? b[0] : null;
    up = a.length === 1 ? a[0] : null;
    if (down) { below.unshift(down); seen.add(down.number); if (down.base === trunk) down = null; }
    if (up) { above.push(up); seen.add(up.number); }
  }
  const layers = [...below, me, ...above];
  return layers.length > 1 ? { source: "branches", trunk: layers[0].base, layers, at: below.length } : null;
}

// ---------------------------------------------------------------- the stacks you define
// ~/.bobby/stacks.json: { "owner/repo": [[101, 102, 103], …] }, each a stack bottom first. A PR is in one at most.
export type Saved = Record<string, number[][]>;
const savedPath = () => join(home(), "stacks.json");
export async function loadSaved(): Promise<Saved> {
  const f = Bun.file(savedPath());
  return (await f.exists()) ? ((await f.json().catch(() => ({}))) as Saved) : {};
}
const key = (r: Repo) => `${r.owner}/${r.repo}`.toLowerCase();
/** The stack you defined that holds this PR, if any. */
export const savedChain = (saved: Saved, r: Repo, n: number) => saved[key(r)]?.find((c) => c.includes(n)) ?? null;
/** Saved with this PR's stack set to numbers (bottom first): every PR in it leaves any other stack, and fewer than two
 *  means this PR stands alone again. */
export function withChain(saved: Saved, r: Repo, n: number, numbers: number[]): Saved {
  const k = key(r), mine = savedChain(saved, r, n) ?? [];
  const gone = new Set([...mine, ...numbers]);
  const rest = (saved[k] ?? []).map((c) => c.filter((x) => !gone.has(x))).filter((c) => c.length > 1);
  const next = numbers.length > 1 ? [...rest, numbers] : rest;
  const out = { ...saved };
  if (next.length) out[k] = next; else delete out[k];
  return out;
}

/** Sets this PR's stack to these PRs, bottom first; an empty or one-PR list removes it. Throws, saying why, for a list
 *  that leaves this PR out, repeats one, or names a PR the repo doesn't have. */
export async function defineStack(pr: Repo & { number: number }, numbers: number[]): Promise<void> {
  if (numbers.length > 1) {
    if (!numbers.every((n) => Number.isInteger(n) && n > 0)) throw new Error("PR numbers only");
    if (new Set(numbers).size !== numbers.length) throw new Error("A PR can be in the stack once");
    if (!numbers.includes(pr.number)) throw new Error(`The stack has to include #${pr.number}`);
    if (numbers.length > 2 * MAX) throw new Error(`At most ${2 * MAX} PRs`);
    const found = new Set((await layersOf(pr, numbers)).map((l) => l.number));
    const missing = numbers.filter((n) => !found.has(n));
    if (missing.length) throw new Error(`${pr.owner}/${pr.repo} has no PR ${missing.map((n) => `#${n}`).join(", ")}`);
  }
  const next = withChain(await loadSaved(), pr, pr.number, numbers.length > 1 ? numbers : []);
  const tmp = `${savedPath()}.${process.pid}.tmp`;
  await Bun.write(tmp, JSON.stringify(next, null, 1));
  renameSync(tmp, savedPath());
}
