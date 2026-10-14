// Which file an import refers to, and where a name it imports is declared (following re-exports): the repo at the
// PR's head, read through git without checking anything out.
//   TS/JS   relative paths, tsconfig/jsconfig "paths" and "baseUrl" (following "extends"), workspace packages by their
//           package.json name, and the usual extension and index rules (".js" written for a ".ts" file included)
//   Python  relative (from .a import b) and absolute (a.b.c) modules, a module's __init__.py
//   Go      import paths through the repo's go.mod modules, to a package directory
//   Java    fully qualified class names (and a.b.* packages), to files
//   Rust    crate::, super:: and self:: paths, to module files
// Anything that resolves outside the repo (a library) resolves to nothing.
import { dirname, join, normalize } from "node:path/posix";
import { git } from "./git.ts";
import { family, type Lang, type Syntax, langOf, parseSyntax } from "./syntax.ts";

const JS_EXT = ["", ".ts", ".tsx", ".d.ts", ".js", ".jsx", ".mjs", ".cjs", "/index.ts", "/index.tsx", "/index.js", "/index.jsx", "/index.mjs"];

export class Repo {
  files = new Set<string>();
  private text = new Map<string, Promise<string | null>>();
  private syn = new Map<string, Promise<Syntax | null>>();
  private tsconfigs = new Map<string, Promise<TsPaths | null>>();
  private packages: Promise<Map<string, PkgInfo>> | null = null;
  private goMods: Promise<Array<{ module: string; dir: string }>> | null = null;

  private constructor(readonly cwd: string, readonly sha: string) {}
  static async open(cwd: string, sha: string) {
    const r = new Repo(cwd, sha);
    for (const f of (await git(cwd, ["ls-tree", "-r", "-z", "--name-only", sha], true)).split("\0")) if (f) r.files.add(f);
    return r;
  }

  /** File contents at head; many at once go through one git cat-file. */
  read(path: string): Promise<string | null> {
    let p = this.text.get(path);
    if (!p) this.text.set(path, (p = this.files.has(path) ? git(this.cwd, ["show", `${this.sha}:${path}`], true) : Promise.resolve(null)));
    return p;
  }
  async readMany(paths: string[]) {
    const want = [...new Set(paths)].filter((p) => this.files.has(p) && !this.text.has(p));
    for (let i = 0; i < want.length; i += 500) {
      const chunk = want.slice(i, i + 500);
      const proc = Bun.spawn(["git", "-c", "core.quotePath=false", "cat-file", "--batch"], { cwd: this.cwd, stdin: "pipe", stdout: "pipe", stderr: "ignore" });
      proc.stdin.write(chunk.map((p) => `${this.sha}:${p}\n`).join(""));
      proc.stdin.end();
      const buf = new Uint8Array(await new Response(proc.stdout).arrayBuffer());
      const dec = new TextDecoder();
      let at = 0;
      for (const path of chunk) {
        const nl = buf.indexOf(10, at);
        if (nl < 0) break;
        const head = dec.decode(buf.subarray(at, nl)).split(" ");
        at = nl + 1;
        if (head[1] !== "blob") { this.text.set(path, Promise.resolve(null)); continue; }
        const size = Number(head[2]);
        this.text.set(path, Promise.resolve(dec.decode(buf.subarray(at, at + size))));
        at += size + 1;
      }
    }
  }
  /** The file's syntax, or null (unsupported language, missing file, or no tree-sitter). */
  syntax(path: string): Promise<Syntax | null> {
    let p = this.syn.get(path);
    if (!p) this.syn.set(path, (p = this.read(path).then((t) => (t == null || t.length > 1_500_000 ? null : parseSyntax(path, t)))));
    return p;
  }

  // ---- imports → files
  /** The files an import in `from` refers to: one file, or a package's files (Go, Java a.b.*). Empty: outside the repo. */
  private resolved = new Map<string, Promise<string[]>>();
  resolve(from: string, imp: { source: string; level?: number; name?: string }, lang: Lang): Promise<string[]> {
    const key = `${family(lang)}|${from}|${imp.source}|${imp.level ?? 0}|${imp.name ?? ""}`;
    let p = this.resolved.get(key);
    if (!p) this.resolved.set(key, (p = this.resolveOnce(from, imp, lang)));
    return p;
  }
  private async resolveOnce(from: string, imp: { source: string; level?: number; name?: string }, lang: Lang): Promise<string[]> {
    switch (family(lang)) {
      case "js": return this.resolveJs(from, imp.source);
      case "py": return this.resolvePy(from, imp.source, imp.level ?? 0, imp.name);
      case "go": return this.goPackage(imp.source);
      case "java": return this.resolveJava(imp.source, imp.name);
      case "rust": return this.resolveRust(from, imp.source);
    }
    return [];
  }

  private firstFile(base: string, exts: string[]) {
    for (const e of exts) { const p = normalize(base + e); if (this.files.has(p)) return p; }
    if (/\.(m|c)?js$/.test(base)) { const stem = base.replace(/\.(m|c)?js$/, ""); for (const e of [".ts", ".tsx", ".mts", ".cts"]) if (this.files.has(normalize(stem + e))) return normalize(stem + e); }
    return null;
  }
  private async resolveJs(from: string, src: string): Promise<string[]> {
    const one = (p: string | null) => (p ? [p] : []);
    if (src.startsWith(".")) return one(this.firstFile(join(dirname(from), src), JS_EXT));
    if (src.startsWith("/")) return one(this.firstFile(src.slice(1), JS_EXT));
    const ts = await this.tsPathsFor(from);
    if (ts) {
      for (const [pat, targets] of ts.paths) {
        const star = pat.indexOf("*");
        const hit = star < 0 ? (src === pat ? "" : null) : src.startsWith(pat.slice(0, star)) && src.endsWith(pat.slice(star + 1)) ? src.slice(star, src.length - (pat.length - star - 1)) : null;
        if (hit == null) continue;
        for (const t of targets) { const f = this.firstFile(join(ts.base, t.replace("*", hit)), JS_EXT); if (f) return [f]; }
      }
      if (ts.baseUrl != null) { const f = this.firstFile(join(ts.baseUrl, src), JS_EXT); if (f) return [f]; }
    }
    // A workspace package: its name, then a subpath or its entry point.
    const pkgs = await this.workspacePackages();
    const parts = src.split("/"), name = src.startsWith("@") ? parts.slice(0, 2).join("/") : parts[0], sub = src.slice(name.length + 1);
    const pkg = pkgs.get(name);
    if (!pkg) return [];
    if (sub) return one(this.firstFile(join(pkg.dir, sub), JS_EXT) ?? this.firstFile(join(pkg.dir, "src", sub), JS_EXT));
    for (const entry of pkg.entries) { const f = this.firstFile(join(pkg.dir, entry), JS_EXT); if (f) return [f]; }
    return one(this.firstFile(join(pkg.dir, "src/index"), JS_EXT) ?? this.firstFile(join(pkg.dir, "index"), JS_EXT));
  }
  /** The nearest tsconfig.json / jsconfig.json above a file, with "extends" followed. */
  private tsPathsFor(from: string): Promise<TsPaths | null> {
    let dir = dirname(from);
    for (;;) {
      for (const n of ["tsconfig.json", "jsconfig.json"]) { const p = dir === "." ? n : `${dir}/${n}`; if (this.files.has(p)) return this.tsConfig(p); }
      if (dir === "." || dir === "/" || dir === "") return Promise.resolve(null);
      dir = dirname(dir);
    }
  }
  private tsConfig(path: string, depth = 0): Promise<TsPaths | null> {
    let p = this.tsconfigs.get(path);
    if (!p) this.tsconfigs.set(path, (p = (async () => {
      const json = parseJsonc(await this.read(path));
      if (!json) return null;
      const dir = dirname(path);
      let parent: TsPaths | null = null;
      if (typeof json.extends === "string" && depth < 5) {
        const ext: string = json.extends;
        let target: string | null = null;
        if (ext.startsWith(".")) target = this.firstFile(join(dir, ext), ["", ".json"]);
        else {
          const pkgs = await this.workspacePackages(), parts = ext.split("/"), name = ext.startsWith("@") ? parts.slice(0, 2).join("/") : parts[0];
          const pkg = pkgs.get(name);
          if (pkg) target = this.firstFile(join(pkg.dir, ext.slice(name.length + 1) || "tsconfig.json"), ["", ".json"]);
        }
        if (target) parent = await this.tsConfig(target, depth + 1);
      }
      const co = json.compilerOptions ?? {};
      const baseUrl = typeof co.baseUrl === "string" ? join(dir, co.baseUrl) : parent?.baseUrl ?? null;
      if (co.paths && typeof co.paths === "object") {
        // paths resolve against baseUrl when set, else against the config that declares them
        return { base: baseUrl ?? dir, baseUrl, paths: Object.entries(co.paths as Record<string, string[]>).sort((a, b) => b[0].length - a[0].length) };
      }
      return parent ? { ...parent, baseUrl } : baseUrl != null ? { base: baseUrl, baseUrl, paths: [] } : null;
    })()));
    return p;
  }
  private workspacePackages(): Promise<Map<string, PkgInfo>> {
    this.packages ??= (async () => {
      const files = [...this.files].filter((f) => f.endsWith("package.json") && !f.includes("node_modules/"));
      await this.readMany(files);
      const out = new Map<string, PkgInfo>();
      for (const f of files) {
        const json = parseJsonc(await this.read(f));
        if (typeof json?.name !== "string") continue;
        const entries = [json.source, json.module, json.types, json.typings, json.main, typeof json.exports === "string" ? json.exports : json.exports?.["."]?.import ?? json.exports?.["."]?.default ?? json.exports?.["."]]
          .filter((x): x is string => typeof x === "string").map((x) => x.replace(/^\.\//, ""));
        out.set(json.name, { dir: dirname(f), entries });
      }
      return out;
    })();
    return this.packages;
  }

  private resolvePy(from: string, module: string, level: number, name?: string): string[] {
    const segs = module ? module.split(".") : [];
    const asModule = (base: string) => [`${base}.py`, `${base}.pyi`, `${base}/__init__.py`].find((p) => this.files.has(p));
    if (level > 0) {
      let dir = dirname(from);
      for (let i = 1; i < level; i++) dir = dirname(dir);
      const base = [dir === "." ? "" : dir, ...segs].filter(Boolean).join("/");
      // from .a import b: b may be a submodule, or a name in a/__init__.py
      const sub = name && name !== "*" ? asModule(`${base ? base + "/" : ""}${name}`) : undefined;
      const mod = asModule(base); // the package itself: base.py or base/__init__.py
      return [sub ?? mod].filter((x): x is string => !!x);
    }
    if (!segs.length) return [];
    // Absolute: any file whose path ends with the module path; the one nearest the importing file wins.
    const tails = [segs.join("/") + ".py", segs.join("/") + ".pyi", segs.join("/") + "/__init__.py"];
    const subTails = name && name !== "*" ? [[...segs, name].join("/") + ".py", [...segs, name].join("/") + "/__init__.py"] : [];
    const near = (cands: string[]) => cands.sort((a, b) => common(b, from) - common(a, from) || a.length - b.length)[0];
    const pick = (ts: string[]) => near([...this.files].filter((f) => ts.some((t) => f === t || f.endsWith("/" + t))));
    const sub = subTails.length ? pick(subTails) : undefined;
    const mod = pick(tails);
    return [sub ?? mod].filter((x): x is string => !!x);
  }

  private async goPackage(path: string): Promise<string[]> {
    this.goMods ??= (async () => {
      const mods = [];
      for (const f of [...this.files].filter((x) => x === "go.mod" || x.endsWith("/go.mod"))) {
        const m = (await this.read(f))?.match(/^module\s+(\S+)/m);
        if (m) mods.push({ module: m[1], dir: dirname(f) });
      }
      return mods.sort((a, b) => b.module.length - a.module.length);
    })();
    for (const { module, dir } of await this.goMods) {
      if (path !== module && !path.startsWith(module + "/")) continue;
      const pkgDir = normalize(join(dir === "." ? "" : dir, path.slice(module.length + 1)));
      return this.goFilesIn(pkgDir);
    }
    return [];
  }
  /** A Go package: the non-test .go files directly in a directory. */
  goFilesIn(dir: string): string[] {
    const d = dir === "." ? "" : dir + "/";
    return [...this.files].filter((f) => f.startsWith(d) && f.endsWith(".go") && !f.endsWith("_test.go") && !f.slice(d.length).includes("/"));
  }

  private resolveJava(source: string, name?: string): string[] {
    const segs = source.split(".");
    if (name === "*") { const tail = "/" + segs.join("/") + "/"; return [...this.files].filter((f) => f.endsWith(".java") && ("/" + f).includes(tail) && !("/" + f).slice(("/" + f).indexOf(tail) + tail.length).includes("/")); }
    const tail = segs.join("/") + ".java";
    const hit = [...this.files].find((f) => f === tail || f.endsWith("/" + tail));
    return hit ? [hit] : [];
  }
  /** Java: the other classes in a file's own package (its directory). */
  javaPackage(file: string): string[] {
    const d = dirname(file) + "/";
    return [...this.files].filter((f) => f.startsWith(d) && f.endsWith(".java") && !f.slice(d.length).includes("/"));
  }

  private resolveRust(from: string, path: string): string[] {
    const segs = path.split("::").filter(Boolean);
    if (!segs.length) return [];
    // The module directory of `from`: a/b.rs and a/b/mod.rs are both module a::b, whose children live in a/b/.
    const modDir = (f: string) => (/(^|\/)(mod|lib|main)\.rs$/.test(f) ? dirname(f) : f.replace(/\.rs$/, ""));
    let dir: string;
    if (segs[0] === "crate") {
      let d = dirname(from);
      while (d !== "." && !this.files.has(`${d}/lib.rs`) && !this.files.has(`${d}/main.rs`)) d = dirname(d);
      dir = d; segs.shift();
    } else if (segs[0] === "self") { dir = modDir(from); segs.shift(); }
    else if (segs[0] === "super") { dir = modDir(from); while (segs[0] === "super") { dir = dirname(dir); segs.shift(); } }
    else return []; // another crate
    // Walk down as far as files exist; the remaining segments are items inside the last module.
    let file: string | null = null;
    for (const s of segs) {
      const next = [`${dir}/${s}.rs`, `${dir}/${s}/mod.rs`].find((p) => this.files.has(p));
      if (!next) break;
      file = next; dir = `${dir}/${s}`;
    }
    return [file ?? [`${dir}/mod.rs`, `${dir}.rs`, `${dir}/lib.rs`, `${dir}/main.rs`].find((p) => this.files.has(p)) ?? ""].filter(Boolean);
  }

  // ---- names → declarations
  /** Where `name`, as exported by one of `files`, is declared: the file itself, or through its re-exports. */
  async findDecl(files: string[], name: string, depth = 0): Promise<{ path: string; line: number } | null> {
    for (const f of files) {
      const s = await this.syntax(f);
      if (!s) continue;
      const d = s.decls.find((x) => x.name === name && x.top) ?? s.decls.find((x) => x.name === name);
      if (d) return { path: f, line: d.line };
      if (depth >= 4) continue;
      for (const r of s.reexports) {
        if (r.local !== name && r.name !== "*") continue;
        const found = await this.findDecl(await this.resolve(f, r, s.lang), r.name === "*" ? name : r.name, depth + 1);
        if (found) return found;
      }
    }
    return null;
  }
  /** Whether `files` are, or re-export from, `target`. */
  private reach = new Map<string, Promise<boolean>>();
  reaches(files: string[], target: string, depth = 0): Promise<boolean> {
    if (files.includes(target)) return Promise.resolve(true);
    const key = `${files.join(",")}>${target}`;
    let p = this.reach.get(key);
    if (!p) this.reach.set(key, (p = this.reachesOnce(files, target, depth)));
    return p;
  }
  private async reachesOnce(files: string[], target: string, depth: number): Promise<boolean> {
    if (depth >= 4) return false;
    for (const f of files) {
      const s = await this.syntax(f);
      for (const r of s?.reexports ?? []) if (await this.reaches(await this.resolve(f, r, s!.lang), target, depth + 1)) return true;
    }
    return false;
  }
  langOf(path: string) { return langOf(path); }
}

interface TsPaths { base: string; baseUrl: string | null; paths: Array<[string, string[]]> }
interface PkgInfo { dir: string; entries: string[] }
const common = (a: string, b: string) => { let i = 0; while (i < a.length && a[i] === b[i]) i++; return i; };

/** JSON with comments and trailing commas (tsconfig, jsconfig). */
function parseJsonc(text: string | null): any {
  if (!text) return null;
  let out = "", inStr = false;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (inStr) { out += ch; if (ch === "\\") out += text[++i] ?? ""; else if (ch === '"') inStr = false; continue; }
    if (ch === '"') { inStr = true; out += ch; continue; }
    if (ch === "/" && text[i + 1] === "/") { while (i < text.length && text[i] !== "\n") i++; out += "\n"; continue; }
    if (ch === "/" && text[i + 1] === "*") { i += 2; while (i < text.length && !(text[i] === "*" && text[i + 1] === "/")) i++; i++; continue; }
    out += ch;
  }
  try { return JSON.parse(out.replace(/,(\s*[}\]])/g, "$1")); } catch { return null; }
}
