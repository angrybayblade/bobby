import { expect, test } from "bun:test";
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
