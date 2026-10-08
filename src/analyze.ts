import { git } from "./git.ts";
import type { Band, ChangeTree, CodeRef, Core, FileDiff, Hunk, PrInfo, TreeNode, Unit } from "./types.ts";
import { BANDS } from "./types.ts";

const KEYWORDS = new Set(
  ("if else for while do switch case break continue return function def class interface type enum struct " +
    "trait impl fn func const let var val new this self super null undefined true false None True False " +
    "import export from as async await try catch finally throw raise with yield static public private " +
    "protected readonly extends implements package module object string number boolean void any never " +
    "int float bool char byte long short double unsigned signed print println console require typeof " +
    "instanceof delete elif lambda pass assert global nonlocal match where when then end begin unless " +
    "constructor override abstract final default get set init main index data value args kwargs props state " +
    "error result response request params options config item items name list dict map key keys test expect").split(" "),
);

const DECL_RES = [
  /\b(?:function\*?|def|class|interface|type|enum|struct|trait|fn|func|module|protocol|object|record)\s+([A-Za-z_$][\w$]*)/g,
  /\bfunc\s*\([^)]*\)\s*([A-Za-z_]\w*)/g,
  /\b(?:const|let|var|val)\s+([A-Za-z_$][\w$]*)\s*(?::[^=]+)?=\s*(?:async\s+)?(?:function|\(|[A-Za-z_$][\w$]*\s*=>)/g,
  /^\s*(?:export\s+)?(?:(?:public|private|protected|static|async|override|readonly)\s+)*([A-Za-z_$][\w$]*)\s*(?:<[^>]*>)?\s*\([^)]*\)\s*(?::\s*[^={]+)?\{\s*$/g,
];

export function declsIn(text: string): string[] {
  const out: string[] = [];
  for (const re of DECL_RES) {
    re.lastIndex = 0;
    for (const m of text.matchAll(re)) if (m[1] && !KEYWORDS.has(m[1])) out.push(m[1]);
  }
  return [...new Set(out)];
}

const IDENT = /[A-Za-z_$][\w$]*/g;
// Import/re-export lines mention a symbol without using it; they're noise as "callers".
const IMPORT_LINE = /^\s*(import\b|export\s+(type\s+)?(\{|\*)|from\s+\S+\s+import\b|use\s|#include|[\w\s,{}]*\}\s*from\s|.*\brequire\(|\s*(type\s+)?[\w$]+,?\s*$)/;
const meaningful = (id: string) => id.length >= 4 && !KEYWORDS.has(id);

function primarySymbol(h: Hunk): string {
  const changed = h.lines.filter((l) => l.t !== " ").map((l) => l.s).join("\n");
  const d = declsIn(changed);
  if (d.length) return d[0];
  const fromCtx = declsIn(h.ctx);
  if (fromCtx.length) return fromCtx[0];
  const firstChange = h.lines.findIndex((l) => l.t !== " ");
  for (let i = firstChange - 1; i >= 0; i--) {
    const d2 = declsIn(h.lines[i].s);
    if (d2.length) return d2[0];
  }
  return h.file.split("/").pop()!;
}

export interface Analysis {
  units: Unit[];
  refs: CodeRef[];
  edges: Array<{ from: string; to: string; symbol: string }>; // from = upstream unit, to = downstream unit
  hunkById: Map<string, Hunk>;
}

export async function analyze(cwd: string, pr: PrInfo, files: FileDiff[]): Promise<Analysis> {
  const hunkById = new Map<string, Hunk>();
  for (const f of files) for (const h of f.hunks) hunkById.set(h.id, h);

  // 1. Units: hunks grouped by file + primary symbol.
  const unitsByKey = new Map<string, Unit>();
  const unitOfHunk = new Map<string, Unit>();
  for (const f of files) {
    for (const h of f.hunks) {
      if (h.noise) continue;
      const sym = primarySymbol(h);
      const key = `${f.path}::${sym}`;
      let u = unitsByKey.get(key);
      if (!u) unitsByKey.set(key, (u = { id: `u${unitsByKey.size + 1}`, file: f.path, symbols: [sym], hunkIds: [] }));
      u.hunkIds.push(h.id);
      for (const d of declsIn(h.lines.filter((l) => l.t !== " ").map((l) => l.s).join("\n")))
        if (!u.symbols.includes(d)) u.symbols.push(d);
      unitOfHunk.set(h.id, u);
    }
  }
  const units = [...unitsByKey.values()];

  // Where each added line lives, so grep hits can be classified as changed vs unchanged code.
  const addedAt = new Map<string, Unit>();
  for (const u of units)
    for (const hid of u.hunkIds)
      for (const l of hunkById.get(hid)!.lines) if (l.t === "+") addedAt.set(`${u.file}:${l.n}`, u);

  const symbolOwner = new Map<string, Unit>();
  for (const u of units) for (const s of u.symbols) if (meaningful(s) && !symbolOwner.has(s)) symbolOwner.set(s, u);

  const refs: CodeRef[] = [];
  const edges: Analysis["edges"] = [];
  const edgeKeys = new Set<string>();
  const addRef = (r: Omit<CodeRef, "id">) => refs.push({ ...r, id: `r${refs.length + 1}` });

  // 2. Downstream: every usage of a changed symbol at head.
  const syms = [...symbolOwner.keys()];
  if (syms.length) {
    const args = ["grep", "-n", "-w", "-F", "-I"];
    for (const s of syms) args.push("-e", s);
    const out = await git(cwd, [...args, pr.headSha, "--", "."], true);
    const hits = parseGrep(out, pr.headSha);
    const perSymbol = new Map<string, typeof hits>();
    for (const hit of hits) {
      const toks = new Set(hit.text.match(IDENT) ?? []);
      for (const s of syms) if (toks.has(s)) (perSymbol.get(s) ?? perSymbol.set(s, []).get(s)!).push(hit);
    }
    for (const [s, list] of perSymbol) {
      const owner = symbolOwner.get(s)!;
      const generic = list.length > 120;
      const seenFiles = new Map<string, number>();
      let unchangedCount = 0;
      for (const hit of list) {
        if (declsIn(hit.text).includes(s) || IMPORT_LINE.test(hit.text)) continue;
        const at = addedAt.get(`${hit.path}:${hit.line}`);
        if (at) {
          if (at !== owner && !edgeKeys.has(`${owner.id}>${at.id}`)) {
            edgeKeys.add(`${owner.id}>${at.id}`);
            edges.push({ from: owner.id, to: at.id, symbol: s });
          }
        } else if (!generic && unchangedCount < 10 && (seenFiles.get(hit.path) ?? 0) < 2) {
          seenFiles.set(hit.path, (seenFiles.get(hit.path) ?? 0) + 1);
          unchangedCount++;
          addRef({ path: hit.path, line: hit.line, text: hit.text.trim(), dir: "down", symbol: s, forUnit: owner.id });
        }
      }
    }
  }

  // 3. Upstream: unchanged definitions of identifiers the added code relies on.
  const usedBy = new Map<string, Map<string, number>>(); // ident → unit → count
  for (const u of units)
    for (const hid of u.hunkIds)
      for (const l of hunkById.get(hid)!.lines) {
        if (l.t !== "+") continue;
        for (const id of l.s.match(IDENT) ?? []) {
          if (!meaningful(id) || symbolOwner.has(id)) continue;
          const m = usedBy.get(id) ?? usedBy.set(id, new Map()).get(id)!;
          m.set(u.id, (m.get(u.id) ?? 0) + 1);
        }
      }
  const idents = [...usedBy.keys()].slice(0, 600);
  const defs = new Map<string, Array<{ path: string; line: number; text: string }>>();
  for (let i = 0; i < idents.length; i += 150) {
    const chunk = idents.slice(i, i + 150).map((s) => s.replace(/\$/g, "\\$"));
    const pattern = `(function|def|class|interface|type|enum|struct|trait|fn|func|const|let|var|val)[[:space:]]+(${chunk.join("|")})`;
    const out = await git(cwd, ["grep", "-n", "-I", "-w", "-E", "-e", pattern, pr.headSha, "--", "."], true);
    for (const hit of parseGrep(out, pr.headSha)) {
      if (addedAt.has(`${hit.path}:${hit.line}`)) continue;
      for (const d of declsIn(hit.text)) {
        if (!usedBy.has(d)) continue;
        const list = defs.get(d) ?? defs.set(d, []).get(d)!;
        if (list.length < 2) list.push(hit);
      }
    }
  }
  for (const u of units) {
    const candidates = [...usedBy.entries()]
      .filter(([id, m]) => m.has(u.id) && defs.get(id)?.length === 1) // ambiguous names are noise
      .sort((a, b) => b[1].get(u.id)! - a[1].get(u.id)!)
      .slice(0, 6);
    for (const [id] of candidates) {
      const d = defs.get(id)![0];
      addRef({ path: d.path, line: d.line, text: d.text.trim(), dir: "up", symbol: id, forUnit: u.id });
    }
  }

  return { units, refs, edges, hunkById };
}

function parseGrep(out: string, sha: string) {
  const hits: Array<{ path: string; line: number; text: string }> = [];
  for (const raw of out.split("\n")) {
    if (!raw) continue;
    const line = raw.startsWith(sha + ":") ? raw.slice(sha.length + 1) : raw;
    const m = line.match(/^(.+?):(\d+):(.*)$/);
    if (m) hits.push({ path: m[1], line: Number(m[2]), text: m[3].slice(0, 300) });
  }
  return hits;
}

const SNIPPET_RADIUS = 6;
export const refNode = (r: CodeRef, band: Band, why: string, risk?: TreeNode["risk"], label?: string): TreeNode => ({
  id: "", band, title: label?.trim() || `${r.symbol} · ${r.path.split("/").pop()}:${r.line}`, why, risk,
  ref: { path: r.path, line: r.line, start: Math.max(1, r.line - SNIPPET_RADIUS), end: r.line + SNIPPET_RADIUS },
});

const unitTitle = (u: Unit) => u.symbols[0];

/** Deterministic tree from the static analysis. Shown instantly; Claude's version replaces it when ready. */
export function heuristicTree(pr: PrInfo, a: Analysis, files: FileDiff[]): ChangeTree {
  const unitById = new Map(a.units.map((u) => [u.id, u]));
  const ups = new Map<string, typeof a.edges>();
  const downs = new Map<string, typeof a.edges>();
  for (const e of a.edges) {
    (ups.get(e.to) ?? ups.set(e.to, []).get(e.to)!).push(e);
    (downs.get(e.from) ?? downs.set(e.from, []).get(e.from)!).push(e);
  }
  const refsFor = (uid: string, dir: "up" | "down") => a.refs.filter((r) => r.forUnit === uid && r.dir === dir);
  const weight = (u: Unit) => (downs.get(u.id)?.length ?? 0) * 3 + refsFor(u.id, "down").length;
  const order = [...a.units].sort((x, y) => {
    const xs = ups.has(x.id) ? 1 : 0, ys = ups.has(y.id) ? 1 : 0;
    return xs - ys || weight(y) - weight(x);
  });

  const placed = new Set<string>();
  const cores: Core[] = [];
  for (const u of order) {
    if (placed.has(u.id)) continue;
    placed.add(u.id);
    const bands = emptyBands();
    bands.core.push({ id: "", band: "core", title: unitTitle(u), why: `Changed in ${u.file}`, unitIds: [u.id] });
    const members = [u];
    for (const e of ups.get(u.id) ?? []) {
      const up = unitById.get(e.from)!;
      bands.upChanged.push({ id: "", band: "upChanged", title: unitTitle(up), why: `Defines \`${e.symbol}\`, which the core change uses`, unitIds: [up.id] });
      if (!placed.has(up.id)) { placed.add(up.id); members.push(up); }
    }
    for (const e of downs.get(u.id) ?? []) {
      const down = unitById.get(e.to)!;
      bands.downChanged.push({ id: "", band: "downChanged", title: unitTitle(down), why: `Uses \`${e.symbol}\` and was changed too`, unitIds: [down.id] });
      if (!placed.has(down.id)) { placed.add(down.id); members.push(down); }
    }
    for (const m of members) {
      for (const r of refsFor(m.id, "up").slice(0, m === u ? 4 : 2))
        bands.upUnchanged.push(refNode(r, "upUnchanged", `Existing \`${r.symbol}\`, relied on by ${unitTitle(m)}`));
      for (const r of refsFor(m.id, "down").slice(0, m === u ? 6 : 3))
        bands.downUnchanged.push(refNode(r, "downUnchanged", `Unchanged caller of \`${r.symbol}\`; check it still holds`, "med"));
    }
    cores.push({ id: "", title: unitTitle(u), summary: `${u.file} · ${u.hunkIds.length} hunk(s)`, bands });
  }
  return finalize({ source: "heuristic", intent: pr.title, cores, noiseHunkIds: [] }, a, files);
}

export const emptyBands = (): Record<Band, TreeNode[]> => ({ upUnchanged: [], upChanged: [], core: [], downChanged: [], downUnchanged: [] });

/** Assigns ids, marks repeats as "seen", appends anything not yet covered so no hunk is ever skipped. */
export function finalize(tree: ChangeTree, a: Analysis, files: FileDiff[]): ChangeTree {
  const shownUnits = new Set<string>();
  const shownRefs = new Map<string, string>();
  const unitShownAt = new Map<string, string>();
  let n = 0;
  tree.cores.forEach((c, ci) => {
    c.id = `c${ci + 1}`;
    for (const band of BANDS) {
      const seen = new Set<string>();
      c.bands[band] = c.bands[band].filter((node) => {
        const key = node.ref ? `${node.ref.path}:${node.ref.line}` : (node.unitIds ?? []).join(",");
        if (!key || seen.has(key)) return false;
        seen.add(key);
        return true;
      });
      for (const node of c.bands[band]) {
        node.id = `n${++n}`;
        if (node.unitIds) {
          const fresh = node.unitIds.filter((u) => !shownUnits.has(u));
          if (!fresh.length) node.seenIn = unitShownAt.get(node.unitIds[0]);
          for (const u of fresh) { shownUnits.add(u); unitShownAt.set(u, node.id); }
        } else if (node.ref) {
          const key = `${node.ref.path}:${node.ref.line}`;
          if (shownRefs.has(key)) node.seenIn = shownRefs.get(key);
          else shownRefs.set(key, node.id);
        }
      }
    }
  });

  const leftovers = a.units.filter((u) => !shownUnits.has(u.id));
  const byFile = new Map<string, Unit[]>();
  for (const u of leftovers) (byFile.get(u.file) ?? byFile.set(u.file, []).get(u.file)!).push(u);
  for (const [file, us] of byFile) {
    const bands = emptyBands();
    for (const u of us) bands.core.push({ id: `n${++n}`, band: "core", title: unitTitle(u), why: `Other change in ${file}`, unitIds: [u.id] });
    tree.cores.push({ id: `c${tree.cores.length + 1}`, title: file.split("/").pop()!, summary: `Remaining changes in ${file}`, bands });
  }

  tree.noiseHunkIds = files.flatMap((f) => f.hunks.filter((h) => h.noise).map((h) => h.id));
  return tree;
}
