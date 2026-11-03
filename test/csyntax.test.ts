import { expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { resolveDef } from "../src/analyze.ts";
import { Repo } from "../src/resolve.ts";
import { langOf, parseSyntax } from "../src/syntax.ts";

const C = `#include "util/a.h"
#include <stdio.h>
#define LIMIT 10
#define MAX(a, b) ((a) > (b) ? (a) : (b))
typedef struct node { int value; struct node *next; } node_t;
enum color { RED, GREEN };
static int count = 0, *ptr;
int add(int a, int b);
static const char *name(void) { return "x"; }
int add(int a, int b) {
  int sum = a + b;
  node_t n;
  n.value = helper(sum);
  return p->next->value + LIMIT;
}
`;
const CPP = `#include "b.hpp"
namespace outer {
class Widget : public Base {
 public:
  Widget();
  ~Widget();
  int size() const { return size_; }
  static int make(int x);
 private:
  int size_;
};
int Widget::make(int x) { return other::run(x) + inner.count; }
template <typename T> T twice(T v) { return v + v; }
}
extern "C" { void plain(void); }
`;
const decl = (s: Awaited<ReturnType<typeof parseSyntax>>, name: string) => s!.decls.find((d) => d.name === name);

test("headers read as C++, .c as C", () => {
  expect(["a.c", "a.h", "a.cc", "a.cpp", "a.cxx", "a.hpp", "a.tpp"].map(langOf)).toEqual(["c", "cpp", "cpp", "cpp", "cpp", "cpp", "cpp"]);
});

test("C: what a file declares, and from which line to which", async () => {
  const s = await parseSyntax("a.c", C);
  for (const name of ["LIMIT", "MAX", "node", "node_t", "color", "RED", "GREEN", "count", "ptr", "name"]) expect(decl(s, name)?.top).toBe(true);
  expect(decl(s, "value")).toMatchObject({ top: false, member: true });
  expect(decl(s, "next")).toMatchObject({ top: false, member: true });
  expect(decl(s, "sum")?.top).toBe(false); // a local
  expect(s!.decls.filter((d) => d.name === "add").map((d) => [d.line, d.end])).toEqual([[8, 8], [10, 15]]); // the prototype, then the body
});

test("C: includes are imports, and carry on through a header", async () => {
  const s = await parseSyntax("a.c", C);
  expect(s!.imports.map((i) => i.source)).toEqual(["util/a.h", "stdio.h"]);
  expect(s!.reexports.map((r) => r.source)).toEqual(["util/a.h", "stdio.h"]);
});

test("C: uses, with what a member is reached through, and never a declaration's own name", async () => {
  const s = await parseSyntax("a.c", C);
  expect(s!.refs.find((r) => r.name === "helper")).toMatchObject({ line: 13 });
  expect(s!.refs.find((r) => r.name === "value" && r.line === 13)).toMatchObject({ qual: "n" });
  expect(s!.refs.some((r) => r.name === "LIMIT" && r.line === 14)).toBe(true);
  expect(s!.refs.some((r) => r.name === "sum" && r.line === 11)).toBe(false);
  expect(s!.refs.some((r) => r.name === "stdio")).toBe(false);
});

test("C++: a namespace and extern C keep the top level; a class's members don't", async () => {
  const s = await parseSyntax("a.cpp", CPP);
  for (const name of ["outer", "Widget", "twice", "plain"]) expect(decl(s, name)?.top).toBe(true);
  expect(decl(s, "size")).toMatchObject({ top: false, member: true });
  expect(decl(s, "size_")).toMatchObject({ top: false, member: true });
  expect(decl(s, "~Widget")).toMatchObject({ member: true });
});

test("C++: a method defined outside its class, and a qualified use", async () => {
  const s = await parseSyntax("a.cpp", CPP);
  expect(s!.decls.filter((d) => d.name === "make").map((d) => [d.line, d.top, !!d.member])).toEqual([[8, false, true], [12, true, true]]);
  expect(s!.refs.find((r) => r.name === "run")).toMatchObject({ qual: "other", line: 12 });
  expect(s!.refs.find((r) => r.name === "count")).toMatchObject({ qual: "inner", line: 12 });
  expect(s!.refs.some((r) => r.name === "other")).toBe(true);
});

test("includes are followed through a header, in circles, to the nearest declaration", async () => {
  const dir = mkdtempSync(join(tmpdir(), "bobby-c-"));
  const files: Record<string, string> = {
    "src/main.c": `#include "a.h"\nint main(void) { return from_b() + local(); }\nint local(void) { return 0; }\n`,
    "src/a.h": `#include "b.h"\nint from_a(void);\n`,
    "src/b.h": `#include "a.h"\n#include <proj/deep.h>\nint from_b(void);\n`, // back to a.h, and through an include folder
    "include/proj/deep.h": `int from_deep(void);\n`,
  };
  for (const [f, text] of Object.entries(files)) { mkdirSync(join(dir, dirname(f)), { recursive: true }); writeFileSync(join(dir, f), text); }
  const git = (...a: string[]) => Bun.spawnSync(["git", "-c", "user.name=t", "-c", "user.email=t@t", ...a], { cwd: dir });
  git("init", "-q"); git("add", "-A"); git("commit", "-qm", "x");
  const repo = await Repo.open(dir, Bun.spawnSync(["git", "rev-parse", "HEAD"], { cwd: dir }).stdout.toString().trim());
  const main = "src/main.c";
  expect(await repo.findDecl([main], "from_b")).toEqual({ path: "src/b.h", line: 3 });
  expect(await repo.findDecl([main], "from_deep")).toEqual({ path: "include/proj/deep.h", line: 1 });
  expect(await repo.findDecl([main], "nowhere")).toBeNull();
  expect(await repo.reaches([main], "include/proj/deep.h")).toBe(true);
  expect(await repo.reaches(["src/a.h"], main)).toBe(false);
  const syn = (await repo.syntax(main))!;
  expect(await resolveDef(repo, main, syn, syn.refs.find((r) => r.name === "from_b")!)).toEqual({ path: "src/b.h", line: 3 });
  expect(await resolveDef(repo, main, syn, syn.refs.find((r) => r.name === "local")!)).toEqual({ path: main, line: 3 });
  rmSync(dir, { recursive: true, force: true });
});
