// What a file declares, references and imports, from its syntax tree (tree-sitter, run as WebAssembly so it works
// under bun and inside the compiled binary). Unlike grepping for a word, this knows a declaration from a use, never
// counts a word in a comment or a string, and knows which module each imported name comes from (resolve.ts).
//
// Supported: TypeScript, TSX, JavaScript, Python, Go, Java and Rust. Other files get null, and extraction falls back to
// text search for them.
import Parser from "web-tree-sitter";
import runtime from "web-tree-sitter/tree-sitter.wasm" with { type: "file" };
import wasmTs from "tree-sitter-wasms/out/tree-sitter-typescript.wasm" with { type: "file" };
import wasmTsx from "tree-sitter-wasms/out/tree-sitter-tsx.wasm" with { type: "file" };
import wasmJs from "tree-sitter-wasms/out/tree-sitter-javascript.wasm" with { type: "file" };
import wasmPy from "tree-sitter-wasms/out/tree-sitter-python.wasm" with { type: "file" };
import wasmGo from "tree-sitter-wasms/out/tree-sitter-go.wasm" with { type: "file" };
import wasmJava from "tree-sitter-wasms/out/tree-sitter-java.wasm" with { type: "file" };
import wasmRust from "tree-sitter-wasms/out/tree-sitter-rust.wasm" with { type: "file" };

export type Lang = "ts" | "tsx" | "js" | "py" | "go" | "java" | "rust";
/** Languages whose files can import each other (a .ts file may import a .js one). */
export const family = (l: Lang) => (l === "ts" || l === "tsx" || l === "js" ? "js" : l);

const BY_EXT: Record<string, Lang> = {
  ts: "ts", mts: "ts", cts: "ts", tsx: "tsx", js: "js", jsx: "js", mjs: "js", cjs: "js",
  py: "py", pyi: "py", go: "go", java: "java", rs: "rust",
};
export function langOf(path: string): Lang | null {
  if (path.endsWith(".d.ts")) return "ts";
  const ext = path.slice(path.lastIndexOf(".") + 1).toLowerCase();
  return BY_EXT[ext] ?? null;
}
const WASM: Record<Lang, string> = { ts: wasmTs, tsx: wasmTsx, js: wasmJs, py: wasmPy, go: wasmGo, java: wasmJava, rust: wasmRust };

/** A name a file declares. Lines are 1-based; start..end spans the whole declaration. top: module level; member: a
 *  method or field of a class, struct, trait or interface (reached through a value, x.name). Neither: a local. */
export interface Decl { name: string; line: number; start: number; end: number; top: boolean; member?: boolean }
/** A use of a name. qual is what it's reached through, "db" in db.create(), "pkg" in pkg.Name. */
export interface Ref { name: string; line: number; col: number; qual?: string } // col: 0-based, in UTF-16 units (as LSP counts)
/** A name an import binds. name is what the module exports it as ("default" or "*" for the module itself). */
export interface Import { local: string; name: string; source: string; level?: number }
/** export { name as local } from source, or export * from source (name "*"). */
export interface ReExport { name: string; local: string; source: string }
export interface Syntax { lang: Lang; decls: Decl[]; refs: Ref[]; imports: Import[]; reexports: ReExport[]; pkg?: string }

let ready: Promise<boolean> | null = null;
const languages = new Map<Lang, Parser.Language>();
let parser: Parser | null = null;
/** Loads the parser once; false if tree-sitter can't run here (extraction then falls back to text search). */
export function syntaxReady(): Promise<boolean> {
  ready ??= (async () => {
    try {
      await Parser.init({ wasmBinary: await Bun.file(runtime).bytes() });
      parser = new Parser();
      return true;
    } catch (e) {
      console.warn(`  ! tree-sitter unavailable (${(e as Error).message}); falling back to text search`);
      return false;
    }
  })();
  return ready;
}
async function language(lang: Lang) {
  let l = languages.get(lang);
  if (!l) languages.set(lang, (l = await Parser.Language.load(await Bun.file(WASM[lang]).bytes())));
  return l;
}

/** Parses a file; null for an unsupported language or when tree-sitter isn't available. */
export async function parseSyntax(path: string, text: string): Promise<Syntax | null> {
  const lang = langOf(path);
  if (!lang || !(await syntaxReady()) || !parser) return null;
  parser.setLanguage(await language(lang));
  const tree = parser.parse(text);
  try {
    return walk(lang, tree.rootNode);
  } finally {
    tree.delete();
  }
}

type N = Parser.SyntaxNode;
const line = (n: N) => n.startPosition.row + 1;
const col = (n: N) => n.startPosition.column;
const unquote = (s: string) => s.replace(/^[`'"]|[`'"]$/g, "");

function walk(lang: Lang, root: N): Syntax {
  const out: Syntax = { lang, decls: [], refs: [], imports: [], reexports: [] };
  const declNames = new Set<number>(); // node ids already counted as a declaration's name
  const decl = (nameNode: N | null, whole: N, top: boolean, member = false) => {
    if (!nameNode) return;
    declNames.add(nameNode.id);
    out.decls.push({ name: nameNode.text, line: line(nameNode), start: line(whole), end: whole.endPosition.row + 1, top, ...(member ? { member } : {}) });
  };
  const ref = (n: N, qual?: N | null) => {
    if (declNames.has(n.id)) return;
    out.refs.push({ name: n.text, line: line(n), col: col(n), ...(qual ? { qual: qual.text } : {}) });
  };
  const handlers = { ts: jsNode, tsx: jsNode, js: jsNode, py: pyNode, go: goNode, java: javaNode, rust: rustNode }[lang];
  // Iterative pre-order walk. depth: nesting inside function/class bodies, so top-level declarations can be told apart.
  const stack: Array<{ n: N; depth: number; imp: boolean }> = [{ n: root, depth: 0, imp: false }];
  while (stack.length) {
    const { n, depth, imp } = stack.pop()!;
    const r = handlers(n, depth, imp, { decl, ref, out });
    if (r === "skip") continue;
    const nested = depth + (BODY.has(n.type) ? 1 : 0);
    const inImport = imp || r === "import";
    for (let i = n.namedChildCount - 1; i >= 0; i--) stack.push({ n: n.namedChild(i)!, depth: nested, imp: inImport });
  }
  return out;
}
// Nodes whose contents are not at module level.
const BODY = new Set([
  "statement_block", "class_body", "function_body", "block", "body", "declaration_list", "field_declaration_list",
  "interface_body", "enum_body", "object_type", "arrow_function", "function_expression", "lambda", "func_literal",
  "constructor_body", "impl_item", "trait_item",
]);
interface Ctx { decl: (name: N | null, whole: N, top: boolean, member?: boolean) => void; ref: (n: N, qual?: N | null) => void; out: Syntax }
type Res = void | "skip" | "import";

// ---- TypeScript / TSX / JavaScript
function jsNode(n: N, depth: number, imp: boolean, c: Ctx): Res {
  const top = depth === 0;
  switch (n.type) {
    case "function_declaration": case "generator_function_declaration": case "class_declaration": case "abstract_class_declaration":
    case "interface_declaration": case "type_alias_declaration": case "enum_declaration": case "module":
      c.decl(n.childForFieldName("name"), n, top); return;
    case "method_definition": case "method_signature": case "abstract_method_signature": case "public_field_definition": case "property_signature":
      c.decl(n.childForFieldName("name"), n, false, true); return;
    case "variable_declarator": {
      const name = n.childForFieldName("name"), value = n.childForFieldName("value");
      if (value?.type === "call_expression" && value.childForFieldName("function")?.text === "require") { // const x = require("y")
        const src = value.childForFieldName("arguments")?.namedChild(0);
        if (src && /string/.test(src.type)) {
          if (name?.type === "identifier") c.out.imports.push({ local: name.text, name: "*", source: unquote(src.text) });
          else if (name?.type === "object_pattern") for (const p of name.namedChildren) {
            const key = p.type === "pair_pattern" ? p.childForFieldName("key") : p, val = p.type === "pair_pattern" ? p.childForFieldName("value") : p;
            if (key && val) c.out.imports.push({ local: val.text, name: key.text, source: unquote(src.text) });
          }
          return "skip";
        }
      }
      if (name?.type === "identifier" && (top || /^(arrow_function|function_expression|function|class)$/.test(value?.type ?? ""))) c.decl(name, n, top);
      return;
    }
    case "import_statement": {
      const src = unquote(n.childForFieldName("source")?.text ?? "");
      for (const cl of n.namedChildren) if (cl.type === "import_clause") for (const part of cl.namedChildren) {
        if (part.type === "identifier") c.out.imports.push({ local: part.text, name: "default", source: src });
        else if (part.type === "namespace_import") { const id = part.namedChildren.find((x) => x.type === "identifier"); if (id) c.out.imports.push({ local: id.text, name: "*", source: src }); }
        else if (part.type === "named_imports") for (const s of part.namedChildren) if (s.type === "import_specifier") {
          const name = s.childForFieldName("name")!, alias = s.childForFieldName("alias");
          c.out.imports.push({ local: (alias ?? name).text, name: name.text, source: src });
        }
      }
      return "skip";
    }
    case "export_statement": {
      const srcNode = n.childForFieldName("source");
      if (!srcNode) return; // export const x = …: walk into it
      const src = unquote(srcNode.text);
      const clause = n.namedChildren.find((x) => x.type === "export_clause");
      if (clause) for (const s of clause.namedChildren) {
        const name = s.childForFieldName("name"), alias = s.childForFieldName("alias");
        if (name) c.out.reexports.push({ name: name.text, local: (alias ?? name).text, source: src });
      }
      else c.out.reexports.push({ name: "*", local: "*", source: src });
      return "skip";
    }
    case "member_expression": { // a.b: b reached through a
      const obj = n.childForFieldName("object"), prop = n.childForFieldName("property");
      if (prop && obj) { if (obj.type === "identifier") c.ref(obj); else pushInner(obj, c); c.ref(prop, obj); }
      return "skip";
    }
    case "nested_type_identifier": { // ns.Type
      const mod = n.childForFieldName("module"), name = n.childForFieldName("name");
      if (mod && name) { c.ref(mod); c.ref(name, mod); }
      return "skip";
    }
    case "identifier": case "type_identifier": case "property_identifier": case "shorthand_property_identifier":
      if (!imp) c.ref(n);
      return;
  }
}
/** A member chain's inner part (a.b in a.b.c): walk it with the same rules. */
function pushInner(n: N, c: Ctx) {
  if (n.type === "member_expression") { const o = n.childForFieldName("object"), p = n.childForFieldName("property"); if (o && p) { if (o.type === "identifier") c.ref(o); else pushInner(o, c); c.ref(p, o); } return; }
  if (n.type === "identifier" || n.type === "property_identifier") return void c.ref(n);
  for (const ch of n.namedChildren) pushInner(ch, c);
}

// ---- Python
function pyNode(n: N, depth: number, imp: boolean, c: Ctx): Res {
  const top = depth === 0;
  switch (n.type) {
    case "function_definition": case "class_definition": {
      const host = n.parent?.type === "decorated_definition" ? n.parent.parent : n.parent; // block
      c.decl(n.childForFieldName("name"), n, top, !top && host?.parent?.type === "class_definition");
      return;
    }
    case "assignment": {
      const left = n.childForFieldName("left");
      if (top && left?.type === "identifier") c.decl(left, n, true);
      return;
    }
    case "import_statement": // import a.b, import a.b as c
      for (const x of n.namedChildren) {
        if (x.type === "dotted_name") c.out.imports.push({ local: x.text.split(".")[0], name: "*", source: x.text });
        else if (x.type === "aliased_import") c.out.imports.push({ local: x.childForFieldName("alias")!.text, name: "*", source: x.childForFieldName("name")!.text });
      }
      return "skip";
    case "import_from_statement": { // from .a import b as c
      const mod = n.childForFieldName("module_name");
      const text = mod?.text ?? "", level = text.match(/^\.*/)![0].length, source = text.slice(level);
      for (const x of n.namedChildren) {
        if (x === mod) continue;
        if (x.type === "dotted_name") c.out.imports.push({ local: x.text, name: x.text, source, level });
        else if (x.type === "aliased_import") c.out.imports.push({ local: x.childForFieldName("alias")!.text, name: x.childForFieldName("name")!.text, source, level });
        else if (x.type === "wildcard_import") c.out.imports.push({ local: "*", name: "*", source, level });
      }
      return "skip";
    }
    case "attribute": {
      const obj = n.childForFieldName("object"), attr = n.childForFieldName("attribute");
      if (obj && attr) { if (obj.type === "identifier") c.ref(obj); else pyInner(obj, c); c.ref(attr, obj); }
      return "skip";
    }
    case "identifier":
      if (!imp) c.ref(n);
      return;
  }
}
function pyInner(n: N, c: Ctx) {
  if (n.type === "attribute") { const o = n.childForFieldName("object"), a = n.childForFieldName("attribute"); if (o && a) { if (o.type === "identifier") c.ref(o); else pyInner(o, c); c.ref(a, o); } return; }
  if (n.type === "identifier") return void c.ref(n);
  for (const ch of n.namedChildren) pyInner(ch, c);
}

// ---- Go
function goNode(n: N, depth: number, imp: boolean, c: Ctx): Res {
  const top = depth === 0;
  switch (n.type) {
    case "package_clause": c.out.pkg = n.namedChildren[0]?.text; return "skip";
    case "function_declaration": case "type_spec": c.decl(n.childForFieldName("name"), n, top); return;
    case "method_declaration": c.decl(n.childForFieldName("name"), n, false, true); return;
    case "field_declaration": for (const x of n.namedChildren) if (x.type === "field_identifier") c.decl(x, n, false, true); return;
    case "const_spec": case "var_spec": for (const x of n.namedChildren) if (x.type === "identifier") c.decl(x, n, top); return;
    case "import_spec": {
      const path = unquote(n.childForFieldName("path")?.text ?? ""), name = n.childForFieldName("name")?.text;
      c.out.imports.push({ local: name ?? path.split("/").pop()!, name: "*", source: path });
      return "skip";
    }
    case "selector_expression": {
      const op = n.childForFieldName("operand"), f = n.childForFieldName("field");
      if (op && f) { if (op.type === "identifier") c.ref(op); else goInner(op, c); c.ref(f, op); }
      return "skip";
    }
    case "qualified_type": {
      const pkg = n.childForFieldName("package"), name = n.childForFieldName("name");
      if (pkg && name) c.ref(name, pkg);
      return "skip";
    }
    case "identifier": case "type_identifier": case "field_identifier":
      if (!imp) c.ref(n);
      return;
  }
}
function goInner(n: N, c: Ctx) {
  if (n.type === "selector_expression") { const o = n.childForFieldName("operand"), f = n.childForFieldName("field"); if (o && f) { if (o.type === "identifier") c.ref(o); else goInner(o, c); c.ref(f, o); } return; }
  if (n.type === "identifier" || n.type === "field_identifier" || n.type === "type_identifier") return void c.ref(n);
  for (const ch of n.namedChildren) goInner(ch, c);
}

// ---- Java
function javaNode(n: N, depth: number, imp: boolean, c: Ctx): Res {
  switch (n.type) {
    case "package_declaration": c.out.pkg = n.namedChildren[0]?.text; return "skip";
    case "class_declaration": case "interface_declaration": case "enum_declaration": case "record_declaration": case "annotation_type_declaration":
      c.decl(n.childForFieldName("name"), n, depth === 0); return;
    case "method_declaration": case "constructor_declaration": c.decl(n.childForFieldName("name"), n, false, true); return;
    case "variable_declarator": if (n.parent?.type === "field_declaration") c.decl(n.childForFieldName("name"), n, false, true); return;
    case "import_declaration": {
      const path = n.namedChildren.find((x) => x.type === "scoped_identifier" || x.type === "identifier")?.text ?? "";
      if (n.namedChildren.some((x) => x.type === "asterisk")) c.out.imports.push({ local: "*", name: "*", source: path });
      else c.out.imports.push({ local: path.split(".").pop()!, name: path.split(".").pop()!, source: path });
      return "skip";
    }
    case "method_invocation": case "field_access": {
      const obj = n.childForFieldName("object"), name = n.childForFieldName(n.type === "field_access" ? "field" : "name");
      if (name) c.ref(name, obj?.type === "identifier" ? obj : null);
      if (obj) { if (obj.type === "identifier") c.ref(obj); else javaInner(obj, c); }
      for (const ch of n.namedChildren) if (ch.id !== obj?.id && ch.id !== name?.id) javaInner(ch, c); // the arguments (node wrappers differ; compare ids)
      return "skip";
    }
    case "identifier": case "type_identifier":
      if (!imp) c.ref(n);
      return;
  }
}
function javaInner(n: N, c: Ctx) {
  if (n.type === "identifier" || n.type === "type_identifier") return void c.ref(n);
  if (n.type === "method_invocation" || n.type === "field_access") { javaNode(n, 1, false, c); return; }
  for (const ch of n.namedChildren) javaInner(ch, c);
}

// ---- Rust
function rustNode(n: N, depth: number, imp: boolean, c: Ctx): Res {
  switch (n.type) {
    case "function_item": case "function_signature_item": { // inside impl or trait: a method
      const owner = n.parent?.parent?.type;
      c.decl(n.childForFieldName("name"), n, depth === 0, owner === "impl_item" || owner === "trait_item");
      return;
    }
    case "field_declaration": c.decl(n.childForFieldName("name"), n, false, true); return;
    case "struct_item": case "enum_item": case "trait_item": case "type_item": case "const_item": case "static_item":
    case "mod_item": case "union_item": case "macro_definition":
      c.decl(n.childForFieldName("name"), n, depth === 0); return;
    case "use_declaration": {
      const arg = n.childForFieldName("argument");
      if (arg) rustUse(arg, "", c);
      return "skip";
    }
    case "scoped_identifier": case "scoped_type_identifier": {
      const path = n.childForFieldName("path"), name = n.childForFieldName("name");
      if (name) c.ref(name, path);
      return "skip";
    }
    case "field_expression": {
      const v = n.childForFieldName("value"), f = n.childForFieldName("field");
      if (f) c.ref(f, v?.type === "identifier" ? v : null);
      if (v) { if (v.type === "identifier") c.ref(v); else return; }
      return "skip";
    }
    case "identifier": case "type_identifier": case "field_identifier":
      if (!imp) c.ref(n);
      return;
  }
}
/** use a::b::{c, d as e, f::*}: one import per name, its source the path before it. */
function rustUse(n: N, prefix: string, c: Ctx) {
  const join = (a: string, b: string) => (a && b ? `${a}::${b}` : a || b);
  switch (n.type) {
    case "scoped_identifier": {
      const path = n.childForFieldName("path")?.text ?? "", name = n.childForFieldName("name")!.text;
      c.out.imports.push({ local: name, name, source: join(prefix, path) });
      return;
    }
    case "identifier": c.out.imports.push({ local: n.text, name: n.text, source: prefix }); return;
    case "use_as_clause": {
      const p = n.childForFieldName("path")!, alias = n.childForFieldName("alias")!.text;
      const full = join(prefix, p.text), cut = full.lastIndexOf("::");
      c.out.imports.push({ local: alias, name: full.slice(cut + 2), source: cut < 0 ? "" : full.slice(0, cut) });
      return;
    }
    case "scoped_use_list": {
      const path = n.childForFieldName("path")?.text ?? "", list = n.childForFieldName("list");
      for (const x of list?.namedChildren ?? []) rustUse(x, join(prefix, path), c);
      return;
    }
    case "use_list": for (const x of n.namedChildren) rustUse(x, prefix, c); return;
    case "use_wildcard": c.out.imports.push({ local: "*", name: "*", source: join(prefix, n.namedChildren[0]?.text ?? "") }); return;
  }
}
