import { dirname } from "node:path/posix";
import { git } from "./git.ts";
import { Repo } from "./resolve.ts";
import { family, langOf, type Ref, type Syntax, syntaxReady } from "./syntax.ts";
import type { Band, ChangeTree, CodeRef, Core, Definition, FileDiff, Hunk, PrInfo, TreeNode, Unit } from "./types.ts";
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
  defs: Record<string, Definition[]>; // path → the names on its new-side lines, and where each is declared
}

export async function analyze(cwd: string, pr: PrInfo, files: FileDiff[]): Promise<Analysis> {
  const hunkById = new Map<string, Hunk>();
  for (const f of files) for (const h of f.hunks) hunkById.set(h.id, h);
  // The repo at head, parsed with tree-sitter where the language is supported; null if tree-sitter can't run here,
  // and then every file goes through text search, as before.
  const repo = (await syntaxReady()) ? await Repo.open(cwd, pr.headSha) : null;
  const synOf = async (path: string, status?: string) => (repo && status !== "deleted" ? repo.syntax(path) : null);
  if (repo) await repo.readMany(files.filter((f) => f.status !== "deleted" && langOf(f.path)).map((f) => f.path));

  // 1. Units: hunks grouped by file + primary symbol.
  const unitsByKey = new Map<string, Unit>();
  const unitOfHunk = new Map<string, Unit>();
  for (const f of files) {
    const syn = await synOf(f.path, f.status);
    for (const h of f.hunks) {
      if (h.noise) continue;
      const declared = syn ? declaredIn(h, syn) : [];
      const prose = NOT_CODE.test(f.path); // docs and data: named after the file, no "declarations" read from prose
      const sym = prose ? f.path.split("/").pop()! : declared[0] ?? (syn && enclosing(h, syn)) ?? primarySymbol(h);
      const key = `${f.path}::${sym}`;
      let u = unitsByKey.get(key);
      if (!u) unitsByKey.set(key, (u = { id: `u${unitsByKey.size + 1}`, file: f.path, symbols: [sym], hunkIds: [] }));
      u.hunkIds.push(h.id);
      // What it declares: from the syntax tree for added code; removed declarations by pattern (their callers matter).
      const names = syn ? [...declared, ...declsIn(h.lines.filter((l) => l.t === "-").map((l) => l.s).join("\n"))] : declsIn(h.lines.filter((l) => l.t !== " ").map((l) => l.s).join("\n"));
      if (!prose) for (const d of names) if (!u.symbols.includes(d)) u.symbols.push(d);
      unitOfHunk.set(h.id, u);
    }
  }
  const units = [...unitsByKey.values()];

  // Where each added line lives, so hits can be classified as changed vs unchanged code.
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
  const parsed = (u: Unit) => !!repo && !!langOf(u.file);

  // 2. Downstream: every use of a changed symbol at head. A hit on another unit's added line is an edge; one in
  // untouched code is a downstream ref (at most 10 per symbol, 2 per file; none for a symbol used more than 120 times).
  const perSymbol = new Map<string, Hit[]>();
  const add = (s: string, hit: Hit) => (perSymbol.get(s) ?? perSymbol.set(s, []).get(s)!).push(hit);
  const syms = [...symbolOwner.keys()];
  const textSyms = syms.filter((s) => !parsed(symbolOwner.get(s)!) && !NOT_CODE.test(symbolOwner.get(s)!.file));
  const treeSyms = syms.filter((s) => parsed(symbolOwner.get(s)!));
  if (textSyms.length) { // unsupported languages: every whole-word match that isn't a declaration or an import line
    for (const hit of parseGrep(await grepWords(cwd, pr.headSha, textSyms), pr.headSha)) {
      if (NOT_CODE.test(hit.path)) continue;
      const toks = new Set(hit.text.match(IDENT) ?? []);
      for (const s of textSyms) if (toks.has(s) && !declsIn(hit.text).includes(s) && !IMPORT_LINE.test(hit.text)) add(s, hit);
    }
  }
  if (treeSyms.length && repo) { // supported languages: uses in the syntax tree that resolve, through imports, to the owner
    // Only files where a symbol of their own language family appears are parsed: a use in another family never binds
    // (below), and on a polyglot repo most hits on a common name are in the other languages.
    const famOf = new Map(treeSyms.map((s) => [s, family(langOf(symbolOwner.get(s)!.file)!)]));
    const odd = treeSyms.filter((s) => !/^\w+$/.test(s)).map((s) => famOf.get(s)!); // not a \w word (a JS $name): kept
    const fams = new Map<string, Set<string>>(); // file → the families of the symbols on its hit lines
    for (const h of parseGrep(await grepWords(cwd, pr.headSha, treeSyms), pr.headSha)) {
      const lang = langOf(h.path);
      if (!lang) continue;
      const f = fams.get(h.path) ?? fams.set(h.path, new Set(odd)).get(h.path)!;
      if (h.text.length >= 300) f.add(family(lang)); // the line was cut short: more may be on it
      else for (const w of h.text.match(/\w+/g) ?? []) { const s = famOf.get(w); if (s) f.add(s); }
    }
    const cands = [...fams].filter(([p, f]) => f.has(family(langOf(p)!))).map(([p]) => p);
    await repo.readMany(cands);
    const wanted = new Set(treeSyms);
    for (const path of cands) {
      const lang = langOf(path);
      if (!lang) continue;
      const syn = await repo.syntax(path), text = await repo.read(path);
      if (!syn || text == null) continue;
      const lines = text.split("\n");
      for (const r of syn.refs) {
        if (!wanted.has(r.name)) continue;
        const owner = symbolOwner.get(r.name)!;
        if (family(lang) !== family(langOf(owner.file)!)) continue;
        if (!(await binds(repo, path, syn, r, owner))) continue;
        add(r.name, { path, line: r.line, text: (lines[r.line - 1] ?? "").slice(0, 300) });
      }
    }
    for (const [s, list] of perSymbol) if (wanted.has(s)) { // one hit per line, in file order
      const seen = new Set<string>();
      perSymbol.set(s, list.filter((h) => !seen.has(`${h.path}:${h.line}`) && seen.add(`${h.path}:${h.line}`)).sort((a, b) => a.path.localeCompare(b.path) || a.line - b.line));
    }
  }
  for (const [s, list] of perSymbol) {
    const owner = symbolOwner.get(s)!;
    const generic = list.length > 120;
    const seenFiles = new Map<string, number>();
    let unchangedCount = 0;
    for (const hit of list) {
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

  // 3. Upstream: the unchanged definitions the added code relies on. Supported languages: each name used on an added
  // line, resolved through the file's imports (or its own module, or its Go/Java package) to its one declaration.
  // Others: identifiers with exactly one definition-looking line in the repo.
  const usedBy = new Map<string, Map<string, number>>(); // def key → unit → count
  const defAt = new Map<string, { path: string; line: number; symbol: string }>();
  for (const u of units.filter((x) => parsed(x))) {
    const syn = await repo!.syntax(u.file);
    if (!syn) continue;
    const added = new Set(u.hunkIds.flatMap((h) => hunkById.get(h)!.lines.filter((l) => l.t === "+").map((l) => l.n)));
    for (const r of syn.refs) {
      if (!added.has(r.line) || r.name.length < 3 || u.symbols.includes(r.name) || KEYWORDS.has(r.name)) continue;
      const d = await resolveDef(repo!, u.file, syn, r);
      if (!d || addedAt.has(`${d.path}:${d.line}`)) continue; // changed code: an edge, found downstream
      const key = `${d.path}:${d.line}`;
      defAt.set(key, { ...d, symbol: r.name });
      const m = usedBy.get(key) ?? usedBy.set(key, new Map()).get(key)!;
      m.set(u.id, (m.get(u.id) ?? 0) + 1);
    }
  }
  for (const u of units.filter((x) => parsed(x))) {
    const top = [...usedBy.entries()].filter(([, m]) => m.has(u.id)).sort((a, b) => b[1].get(u.id)! - a[1].get(u.id)!).slice(0, 6);
    for (const [key] of top) {
      const d = defAt.get(key)!, lines = (await repo!.read(d.path))?.split("\n") ?? [];
      addRef({ path: d.path, line: d.line, text: (lines[d.line - 1] ?? "").trim().slice(0, 300), dir: "up", symbol: d.symbol, forUnit: u.id });
    }
  }
  await textUpstream(cwd, pr, units.filter((x) => !parsed(x) && !NOT_CODE.test(x.file)), hunkById, addedAt, symbolOwner, addRef);

  return { units, refs, edges, hunkById, defs: await definitions(repo, files) };
}

/** 4. Definitions, for the inspector: every name on a new-side line of a hunk (added or context), resolved through
 *  the syntax tree and imports. Names it can't place (locals, members of values) are kept without a target, so a
 *  language server can fill them in later. */
async function definitions(repo: Repo | null, files: FileDiff[]): Promise<Record<string, Definition[]>> {
  const out: Record<string, Definition[]> = {};
  if (!repo) return out;
  for (const f of files) {
    if (f.status === "deleted" || !langOf(f.path)) continue;
    const syn = await repo.syntax(f.path);
    if (!syn) continue;
    const shown = new Set(f.hunks.flatMap((h) => h.lines.filter((l) => l.t !== "-" && l.n != null).map((l) => l.n!)));
    const list: Definition[] = [];
    for (const r of syn.refs) {
      if (!shown.has(r.line) || KEYWORDS.has(r.name)) continue;
      const d = await resolveDef(repo, f.path, syn, r);
      const end = d && (await repo.syntax(d.path))?.decls.find((x) => x.line === d.line)?.end;
      list.push({ line: r.line, col: r.col, len: r.name.length, name: r.name, ...(d ? { to: { ...d, ...(end && end > d.line ? { end } : {}) }, via: "syntax" as const } : {}) });
    }
    if (list.length) out[f.path] = list;
  }
  return out;
}

type Hit = { path: string; line: number; text: string };
/** Docs and data: a word there isn't a use of code. */
const NOT_CODE = /\.(md|mdx|markdown|txt|rst|adoc|json|jsonc|ya?ml|toml|ini|csv|tsv|svg|html?|xml|lock|snap|log)$/i;

/** Names a hunk's added lines declare, by the syntax tree of the file at head. */
function declaredIn(h: Hunk, syn: Syntax): string[] {
  const added = new Set(h.lines.filter((l) => l.t === "+").map((l) => l.n));
  // Module-level declarations first, then methods; a one-line member is a field, whose name is too generic to follow.
  const pick = syn.decls.filter((d) => added.has(d.line) && (d.top || (d.member && d.end > d.start)));
  return [...new Set([...pick.filter((d) => d.top), ...pick.filter((d) => !d.top)].map((d) => d.name))];
}
/** The innermost module-level declaration or member around a hunk's first change: what the hunk changes. */
function enclosing(h: Hunk, syn: Syntax): string | null {
  const i = h.lines.findIndex((l) => l.t !== " ");
  const at = h.lines.slice(i).find((l) => l.t !== "-")?.n ?? h.lines.slice(0, i).reverse().find((l) => l.t !== "-")?.n;
  if (at == null) return null;
  const around = syn.decls.filter((d) => (d.top || d.member) && d.end > d.start && d.start <= at && at <= d.end).sort((a, b) => (a.end - a.start) - (b.end - b.start));
  return around[0]?.name ?? null;
}

const rootOf = (qual: string) => qual.split(/\.|::/)[0];
/** Whether a use of a symbol in `path` refers to the owner's declaration: same file, or bound through an import (or
 *  the same Go/Java package) to the owner's file. A member (x.method) counts when the file imports the owner's file. */
async function binds(repo: Repo, path: string, syn: Syntax, r: Ref, owner: Unit): Promise<boolean> {
  const O = owner.file;
  if (path === O) return true;
  const fam = family(syn.lang);
  const ownerSyn = await repo.syntax(O);
  const isMember = !ownerSyn || ownerSyn.decls.some((d) => d.name === r.name && d.member) || !ownerSyn.decls.some((d) => d.name === r.name && d.top);
  const samePkg = (fam === "go" || fam === "java") && dirname(path) === dirname(O);
  // value.member: the file must import what declares the member (the class around it), not merely the owner's file.
  const decl = ownerSyn?.decls.find((d) => d.name === r.name && d.member);
  const container = decl && ownerSyn!.decls.filter((d) => d.top && d.start <= decl.line && decl.line <= d.end).sort((a, b) => (a.end - a.start) - (b.end - b.start))[0]?.name;
  const importsOwner = async () => {
    for (const imp of syn.imports) {
      if (container && imp.name !== container && imp.name !== "default" && imp.name !== "*") continue;
      if (await repo.reaches(await repo.resolve(path, imp, syn.lang), O)) return true;
    }
    return false;
  };
  if (r.qual) {
    const imp = syn.imports.find((i) => i.local === rootOf(r.qual!));
    if (imp) return repo.reaches(await repo.resolve(path, imp, syn.lang), O); // ns.name, pkg.Name, mod.name, Class.static
    return isMember && (samePkg || (await importsOwner())); // value.member
  }
  if (samePkg) return true;
  const imp = syn.imports.find((i) => i.local === r.name);
  if (imp) return repo.reaches(await repo.resolve(path, imp, syn.lang), O);
  for (const w of syn.imports.filter((i) => i.local === "*")) if (await repo.reaches(await repo.resolve(path, w, syn.lang), O)) return true; // from x import *
  return false;
}

/** Where a name used in `path` is declared, if it's somewhere in the repo: through an import, the file itself, its
 *  Go/Java package, or a wildcard import. Members reached through a value (x.name) aren't resolved. */
export async function resolveDef(repo: Repo, path: string, syn: Syntax, r: Ref): Promise<{ path: string; line: number } | null> {
  const fam = family(syn.lang);
  if (r.qual) {
    const imp = syn.imports.find((i) => i.local === rootOf(r.qual!));
    if (!imp || (imp.name !== "*" && fam !== "rust")) return null; // a member of a value or of an imported class
    return repo.findDecl(await repo.resolve(path, imp, syn.lang), r.name);
  }
  const imp = syn.imports.find((i) => i.local === r.name);
  if (imp) {
    const files = await repo.resolve(path, imp, syn.lang);
    return files.length ? repo.findDecl(files, imp.name === "default" || imp.name === "*" ? r.name : imp.name) : null;
  }
  const own = syn.decls.find((d) => d.name === r.name && d.top);
  if (own) return { path, line: own.line };
  if (fam === "go") return repo.findDecl(repo.goFilesIn(dirname(path)).filter((f) => f !== path), r.name);
  if (fam === "java") return repo.findDecl(repo.javaPackage(path).filter((f) => f !== path), r.name);
  for (const w of syn.imports.filter((i) => i.local === "*")) { const d = await repo.findDecl(await repo.resolve(path, w, syn.lang), r.name); if (d) return d; }
  return null;
}

/** Upstream refs by text search, for files tree-sitter doesn't parse: identifiers used on added lines with exactly one
 *  definition-looking line elsewhere in the repo. */
async function textUpstream(cwd: string, pr: PrInfo, units: Unit[], hunkById: Map<string, Hunk>, addedAt: Map<string, Unit>,
  symbolOwner: Map<string, Unit>, addRef: (r: Omit<CodeRef, "id">) => void) {
  if (!units.length) return;
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
    const out = await git(cwd, ["grep", "-z", "-n", "-I", "-w", "-E", "-e", pattern, pr.headSha, "--", "."], true);
    for (const hit of parseGrep(out, pr.headSha)) {
      if (addedAt.has(`${hit.path}:${hit.line}`) || NOT_CODE.test(hit.path)) continue;
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
}

// Many words at once. Passed as separate -F patterns, git checks each pattern against every line in turn
// (minutes on a large repo); one alternation is a single pass. PCRE (-P) is fastest; builds without it get -E.
const reEscape = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
export async function grepWords(cwd: string, sha: string, words: string[], extra: string[] = []): Promise<string> {
  const alt = words.map(reEscape).join("|");
  const base = ["git", "-c", "core.quotePath=false", "grep", "-z", "-n", "-I", ...extra];
  const p = Bun.spawn([...base, "-P", "-e", `\\b(?:${alt})\\b`, sha, "--", "."], { cwd, stdout: "pipe", stderr: "pipe" });
  const [out, code] = await Promise.all([new Response(p.stdout).text(), p.exited]);
  if (code === 0 || code === 1) return out; // 1: no matches
  return git(cwd, base.slice(3).concat(["-w", "-E", "-e", `(${alt})`, sha, "--", "."]), true); // no PCRE in this git
}

/** git grep's hits. With -z (as Bobby runs it), "<sha>:<path>\0<line>\0<text>", so any path reads right; without, the
 *  first ":<digits>:" ends the path. */
export function parseGrep(out: string, sha: string) {
  const hits: Array<{ path: string; line: number; text: string }> = [];
  for (const raw of out.split("\n")) {
    if (!raw) continue;
    const line = raw.startsWith(sha + ":") ? raw.slice(sha.length + 1) : raw;
    const z = line.split("\0");
    if (z.length >= 3 && /^\d+$/.test(z[1])) { hits.push({ path: z[0], line: Number(z[1]), text: z.slice(2).join("\0").slice(0, 300) }); continue; }
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
