// The code inspector's answers: where a name on a line is declared, and (with a language server) its type.
// A language server, when there is one for the file's language, answers for any name; otherwise the syntax tree and
// imports answer what they can. The server is any LanguageServer (langserver.ts): this file knows none of them.
import { readFileSync } from "node:fs";
import { isAbsolute, join, normalize, relative, sep } from "node:path";
import { grepWords, parseGrep, resolveDef } from "./analyze.ts";
import type { LanguageServer } from "./langserver.ts";
import { LspClient, type LspTarget } from "./lsp.ts";
import type { Repo } from "./resolve.ts";
import { langOf, parseSyntax } from "./syntax.ts";
import type { Definition } from "./types.ts";

export interface Inspection extends Pick<Definition, "to" | "ext"> {
  name?: string;
  hover?: string; // the server's signature or type, as markdown
  via: "lsp" | "syntax" | "none";
}

const FIRST_TIMEOUT = 300_000; // the first answer waits for the server to load the project (about 50 s on a large monorepo)
const TIMEOUT = 20_000;
const PARALLEL = 8;
const KEEP_OPEN = 64; // files sent to the server, least recently asked about closed first
const HUNG = 3; // answers in a row that time out: the server is hung, and isn't asked again

/** A running language server over a tree of files (a PR's exported head, or a local working copy). */
export class Inspector {
  private warm = false;
  private strikes = 0; // answers in a row that timed out
  private openOrder: string[] = [];
  private constructor(readonly server: LanguageServer, readonly root: string, private client: LspClient) {}

  static async start(server: LanguageServer, root: string, log: (m: string) => void) {
    const c = await server.command(root, log);
    return new Inspector(server, root, await LspClient.start(c.cmd, root, { env: c.env, init: c.init, settings: c.settings, folders: server.folders?.(root) }));
  }
  /** Whether this server reads a file. */
  reads(path: string) { return !!this.server.languageId(path); }
  get alive() { return !this.client.exited; }
  /** Called once if the server stops on its own (a crash, out of memory). */
  onExit(fn: (why: string) => void) { this.client.onExit(fn); }
  stop() { return this.client.stop(); }

  /** A server that keeps timing out is hung (a project it can't load): it isn't asked again, so names fall back to
   *  imports and the syntax tree instead of waiting minutes each, for hours. */
  get hung() { return this.strikes >= HUNG; }
  private async ask<T>(answer: Promise<T>): Promise<T> {
    try { const r = await answer; this.warm = true; this.strikes = 0; return r; }
    catch (e) { if (/timed out/.test(String((e as Error)?.message))) this.strikes++; throw e; }
  }

  /** The definitions extraction found in the files this server reads, each name asked of the server instead. */
  async definitions(defs: Record<string, Definition[]>): Promise<Record<string, Definition[]>> {
    const out: Record<string, Definition[]> = {};
    for (const [path, list] of Object.entries(defs)) {
      if (!this.reads(path)) continue;
      if (!this.open(path)) { out[path] = list; continue; }
      const text = this.text(path);
      out[path] = await pool(list, PARALLEL, async (d) => {
        if (this.hung) return d;
        try {
          const ts = await this.ask(this.client.definition(this.abs(path), { line: d.line - 1, character: d.col }, this.timeout()));
          if (!ts.length) return d;
          const at = await this.withEnd(this.place(ts[0], path, text));
          if (at.unresolved && (d.to || !at.ext)) return d; // the server stopped at an import: what the syntax tree found, if anything
          const { to: _, ext: __, ...rest } = d;
          return { ...rest, to: at.to, ext: at.ext, via: "lsp" as const };
        } catch { return d; }
      });
    }
    return out;
  }

  /** Where the name at a position is declared, and its type. */
  async inspect(path: string, line: number, col: number): Promise<Inspection | null> {
    if (this.hung || !this.reads(path) || !this.open(path)) return null;
    const pos = { line: line - 1, character: col }, t = this.timeout();
    const [ts, hover] = await Promise.all([this.ask(this.client.definition(this.abs(path), pos, t)), this.client.hover(this.abs(path), pos, t).catch(() => null)]);
    const at = ts.length ? await this.withEnd(this.place(ts[0], path, this.text(path))) : null;
    return { ...(at?.to ? { to: at.to } : at?.ext ? { ext: at.ext } : {}), ...(hover ? { hover } : {}), via: "lsp" };
  }

  /** Every use of the name at a position, in the repo (the declaration itself left out). */
  async references(path: string, line: number, col: number): Promise<Uses | null> {
    if (this.hung || !this.reads(path) || !this.open(path)) return null;
    const found = await this.ask(this.client.references(this.abs(path), { line: line - 1, character: col }, this.timeout()));
    const refs = found.flatMap((r) => {
      const rel = relative(this.root, r.path).split(sep).join("/");
      return rel.startsWith("../") || this.server.outside(r.path) || rel.includes(".bobby-stubs/") ? [] : [{ path: rel, line: r.line, col: r.col }];
    });
    return { name: wordAt(this.text(path)?.split("\n")[line - 1] ?? "", col), refs, via: "lsp" };
  }

  private timeout() { return this.warm ? TIMEOUT : FIRST_TIMEOUT; }
  private abs(path: string) { return join(this.root, path); }
  private text(path: string) { if (!insideRepo(path)) return null; try { return readFileSync(this.abs(path), "utf8"); } catch { return null; } }
  private open(path: string) {
    const i = this.openOrder.indexOf(path);
    if (i >= 0) { this.openOrder.splice(i, 1); this.openOrder.push(path); return true; }
    const text = this.text(path);
    if (text == null) return false;
    this.client.openFile(this.abs(path), text, this.server.languageId(path)!);
    this.openOrder.push(path);
    while (this.openOrder.length > KEEP_OPEN) this.client.closeFile(this.abs(this.openOrder.shift()!));
    return true;
  }
  /** Some servers give only the name's position (pyright): the declaration's last line, then, from the syntax tree. */
  private ends = new Map<string, Promise<Map<number, number>>>();
  private async withEnd<T extends Pick<Definition, "to">>(at: T): Promise<T> {
    const to = at.to;
    if (!to || to.end) return at;
    let m = this.ends.get(to.path);
    if (!m) this.ends.set(to.path, (m = (async () => {
      const text = this.text(to.path), syn = text == null ? null : await parseSyntax(to.path, text).catch(() => null);
      return new Map((syn?.decls ?? []).map((d) => [d.line, d.end]));
    })()));
    const end = (await m).get(to.line);
    return end && end > to.line ? { ...at, to: { ...to, end } } : at;
  }
  /** A server's answer as a place in the repo, or as something outside it. */
  private place(t: LspTarget, from: string, fromText: string | null): Pick<Definition, "to" | "ext"> & { unresolved?: boolean } {
    const rel = relative(this.root, t.path).split(sep).join("/");
    const line = t.at.start.line + 1, end = t.span.end.line + 1;
    const ext = this.server.outside(t.path); // a package, a module, the standard library: maybe inside the tree (a .venv)
    if (ext) return { ext };
    if (rel.startsWith("../")) return { ext: t.path.split(sep).pop()! };
    // A package that isn't installed: the server stops at the import itself. Say which package, don't jump there.
    if (rel === from && this.server.importedPackage) {
      const pkg = this.server.importedPackage(fromText?.split("\n")[t.at.start.line] ?? "", this.root);
      if (pkg !== null) return pkg ? { ext: pkg, unresolved: true } : { unresolved: true }; // "": one of the repo's own
    }
    return { to: { path: rel, line, ...(end > line ? { end } : {}) } };
  }
}

/** A repo-relative path that stays in the repo: never absolute, never climbing out with "..". */
export function insideRepo(path: string) {
  const n = normalize(path);
  return !!path && !isAbsolute(path) && !/^[a-zA-Z]:/.test(path) && n !== ".." && !n.startsWith(`..${sep}`) && !n.startsWith("../");
}

export interface Uses { name: string; refs: Array<{ path: string; line: number; col: number }>; via: "lsp" | "syntax" }
const wordAt = (text: string, col: number) => {
  let a = col, b = col;
  while (a > 0 && /[\w$]/.test(text[a - 1])) a--;
  while (b < text.length && /[\w$]/.test(text[b])) b++;
  return text.slice(a, b);
};
const MAX_FILES = 400; // a common name's candidates, parsed: past this, the rest are left out

/** Without a language server: the uses of the name at a position (a use of it, or its declaration). Candidates are the
 *  files git grep finds the name in; a use counts when it resolves, through imports, to the same declaration. Members
 *  reached through a value (x.name) don't resolve this way, so they're missed. */
export async function referencesSyntax(repo: Repo, cwd: string, sha: string, path: string, line: number, col: number): Promise<Uses | null> {
  const syn = await repo.syntax(path);
  if (!syn) return null;
  const r = syn.refs.find((x) => x.line === line && col >= x.col && col < x.col + x.name.length);
  const name = r?.name ?? wordAt((await repo.read(path))?.split("\n")[line - 1] ?? "", col);
  const decl = r ? await resolveDef(repo, path, syn, r) : syn.decls.find((d) => d.line === line && d.name === name) ? { path, line } : null;
  if (!name || !decl) return { name, refs: [], via: "syntax" };
  const files = [...new Set(parseGrep(await grepWords(cwd, sha, [name]), sha).map((h) => h.path))].filter((f) => langOf(f)).slice(0, MAX_FILES);
  await repo.readMany(files);
  const refs: Uses["refs"] = [];
  for (const f of files) {
    const s = await repo.syntax(f);
    for (const x of s?.refs ?? []) {
      if (x.name !== name) continue;
      const d = await resolveDef(repo, f, s!, x);
      if (d && d.path === decl.path && d.line === decl.line) refs.push({ path: f, line: x.line, col: x.col });
    }
  }
  return { name, refs, via: "syntax" };
}

/** Without a language server: the name at a position, through the syntax tree and imports. */
export async function inspectSyntax(repo: Repo, path: string, line: number, col: number): Promise<Inspection | null> {
  const syn = await repo.syntax(path);
  const r = syn?.refs.find((x) => x.line === line && col >= x.col && col < x.col + x.name.length);
  if (!syn || !r) return null;
  const d = await resolveDef(repo, path, syn, r);
  if (!d) return { name: r.name, via: "none" };
  const end = (await repo.syntax(d.path))?.decls.find((x) => x.line === d.line)?.end;
  return { name: r.name, to: { ...d, ...(end && end > d.line ? { end } : {}) }, via: "syntax" };
}

async function pool<T, R>(items: T[], n: number, fn: (x: T) => Promise<R>): Promise<R[]> {
  const out = new Array<R>(items.length);
  let next = 0;
  await Promise.all(Array.from({ length: Math.min(n, items.length) }, async () => {
    while (next < items.length) { const i = next++; out[i] = await fn(items[i]); }
  }));
  return out;
}
