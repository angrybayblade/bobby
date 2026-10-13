// The code inspector's answers: where a name on a line is declared, and (with a language server) its type.
// A language server, when there is one, answers for any name; otherwise the syntax tree and imports answer what they can.
import { readFileSync } from "node:fs";
import { isAbsolute, join, normalize, relative, sep } from "node:path";
import { resolveDef } from "./analyze.ts";
import { LspClient, type LspTarget } from "./lsp.ts";
import type { Repo } from "./resolve.ts";
import { typescriptServer, tsLanguageId } from "./typescript.ts";
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

/** A running TypeScript language server over a tree of files (a PR's exported head, or a local working copy). */
export class Inspector {
  private warm = false;
  private openOrder: string[] = [];
  private constructor(readonly root: string, private client: LspClient) {}

  static async start(root: string, log: (m: string) => void) {
    const srv = await typescriptServer(log);
    return new Inspector(root, await LspClient.start(srv.cmd, root, { env: srv.env, init: srv.init }));
  }
  get alive() { return !this.client.exited; }
  /** Called once if the server stops on its own (a crash, out of memory). */
  onExit(fn: (why: string) => void) { this.client.onExit(fn); }
  stop() { return this.client.stop(); }

  /** The definitions extraction found, with every TypeScript/JavaScript name asked of the server instead. */
  async definitions(defs: Record<string, Definition[]>): Promise<Record<string, Definition[]>> {
    const out: Record<string, Definition[]> = {};
    for (const [path, list] of Object.entries(defs)) {
      if (!tsLanguageId(path) || !this.open(path)) { out[path] = list; continue; }
      const text = this.text(path);
      out[path] = await pool(list, PARALLEL, async (d) => {
        try {
          const ts = await this.client.definition(this.abs(path), { line: d.line - 1, character: d.col }, this.timeout());
          this.warm = true;
          if (!ts.length) return d;
          const at = this.place(ts[0], path, text);
          if (at.unresolved && d.to) return d; // the server stopped at an import the syntax tree followed (a tsconfig alias it missed)
          const { to: _, ext: __, ...rest } = d;
          return { ...rest, to: at.to, ext: at.ext, via: "lsp" as const };
        } catch { return d; }
      });
    }
    return out;
  }

  /** Where the name at a position is declared, and its type. */
  async inspect(path: string, line: number, col: number): Promise<Inspection | null> {
    if (!tsLanguageId(path) || !this.open(path)) return null;
    const pos = { line: line - 1, character: col }, t = this.timeout();
    const [ts, hover] = await Promise.all([this.client.definition(this.abs(path), pos, t), this.client.hover(this.abs(path), pos, t).catch(() => null)]);
    this.warm = true;
    const at = ts.length ? this.place(ts[0], path, this.text(path)) : null;
    return { ...(at?.to ? { to: at.to } : at?.ext ? { ext: at.ext } : {}), ...(hover ? { hover } : {}), via: "lsp" };
  }

  private timeout() { return this.warm ? TIMEOUT : FIRST_TIMEOUT; }
  private abs(path: string) { return join(this.root, path); }
  private text(path: string) { if (!insideRepo(path)) return null; try { return readFileSync(this.abs(path), "utf8"); } catch { return null; } }
  private open(path: string) {
    const i = this.openOrder.indexOf(path);
    if (i >= 0) { this.openOrder.splice(i, 1); this.openOrder.push(path); return true; }
    const text = this.text(path);
    if (text == null) return false;
    this.client.openFile(this.abs(path), text, tsLanguageId(path)!);
    this.openOrder.push(path);
    while (this.openOrder.length > KEEP_OPEN) this.client.closeFile(this.abs(this.openOrder.shift()!));
    return true;
  }
  /** A server's answer as a place in the repo, or as something outside it. */
  private place(t: LspTarget, from: string, fromText: string | null): Pick<Definition, "to" | "ext"> & { unresolved?: boolean } {
    const rel = relative(this.root, t.path).split(sep).join("/");
    const line = t.at.start.line + 1, end = t.span.end.line + 1;
    if (rel.startsWith("../") || rel.includes("node_modules/")) return { ext: outside(t.path) };
    // A package that isn't installed: the server stops at the import itself. Say which package, don't jump there.
    if (rel === from) {
      const src = fromText?.split("\n")[t.at.start.line] ?? "";
      const pkg = /^\s*import\b/.test(src) && /from\s+['"]([^'"]+)['"]/.exec(src)?.[1];
      if (pkg) return /^[.@~#]?\//.test(pkg) || pkg.startsWith(".") ? { unresolved: true } : { ext: pkg, unresolved: true }; // a path alias isn't a package
    }
    return { to: { path: rel, line, ...(end > line ? { end } : {}) } };
  }
}

/** A repo-relative path that stays in the repo: never absolute, never climbing out with "..". */
export function insideRepo(path: string) {
  const n = normalize(path);
  return !!path && !isAbsolute(path) && !/^[a-zA-Z]:/.test(path) && n !== ".." && !n.startsWith(`..${sep}`) && !n.startsWith("../");
}

/** A name for a declaration outside the repo: the package it's in, or the language's own library. */
function outside(path: string) {
  const p = path.split(sep).join("/");
  if (/\/typescript\/lib\/lib\.[^/]*\.d\.ts$/.test(p)) return "TypeScript's built-in types";
  const m = /node_modules\/((?:@[^/]+\/)?[^/]+)/.exec(p);
  return m ? m[1].replace(/^@types\//, "") : p.split("/").pop()!;
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
