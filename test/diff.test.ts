import { describe, expect, test } from "bun:test";
import { parseDiff, unquote } from "../src/diff.ts";
import { parseGrep } from "../src/analyze.ts";

const diff = (...files: string[]) => files.join("\n") + "\n";

describe("parseDiff", () => {
  test("numbers old and new lines through a hunk", () => {
    const [f] = parseDiff(diff(
      "diff --git a/src/a.ts b/src/a.ts",
      "index 1111111..2222222 100644",
      "--- a/src/a.ts",
      "+++ b/src/a.ts",
      "@@ -10,3 +10,4 @@ function f() {",
      " keep",
      "-old",
      "+new",
      "+added",
      " tail",
    ));
    expect(f).toMatchObject({ path: "src/a.ts", oldPath: "src/a.ts", status: "modified", binary: false });
    expect(f.hunks).toHaveLength(1);
    const h = f.hunks[0];
    expect(h).toMatchObject({ id: "h1", file: "src/a.ts", oldStart: 10, newStart: 10, ctx: "function f() {" });
    expect(h.lines).toEqual([
      { t: " ", o: 10, n: 10, s: "keep" },
      { t: "-", o: 11, n: null, s: "old" },
      { t: "+", o: null, n: 11, s: "new" },
      { t: "+", o: null, n: 12, s: "added" },
      { t: " ", o: 12, n: 13, s: "tail" },
    ]);
    expect(h.hash).toMatch(/^[0-9a-f]{16}$/);
  });

  test("reads added, deleted and renamed files", () => {
    const files = parseDiff(diff(
      "diff --git a/new.ts b/new.ts",
      "new file mode 100644",
      "--- /dev/null",
      "+++ b/new.ts",
      "@@ -0,0 +1 @@",
      "+x",
      "diff --git a/gone.ts b/gone.ts",
      "deleted file mode 100644",
      "--- a/gone.ts",
      "+++ /dev/null",
      "@@ -1 +0,0 @@",
      "-y",
      "diff --git a/old/name.ts b/new/name.ts",
      "similarity index 90%",
      "rename from old/name.ts",
      "rename to new/name.ts",
      "--- a/old/name.ts",
      "+++ b/new/name.ts",
      "@@ -1 +1 @@",
      "-a",
      "+b",
    ));
    expect(files.map((f) => [f.status, f.path, f.oldPath])).toEqual([
      ["added", "new.ts", "new.ts"],
      ["deleted", "gone.ts", "gone.ts"],
      ["renamed", "new/name.ts", "old/name.ts"],
    ]);
    expect(files.flatMap((f) => f.hunks.map((h) => h.id))).toEqual(["h1", "h2", "h3"]);
    expect(files[2].hunks[0]).toMatchObject({ file: "new/name.ts", oldFile: "old/name.ts" });
  });

  test("skips the no-newline marker", () => {
    const [f] = parseDiff(diff(
      "diff --git a/a b/a",
      "--- a/a",
      "+++ b/a",
      "@@ -1 +1 @@",
      "-x",
      "\\ No newline at end of file",
      "+x",
    ));
    expect(f.hunks[0].lines.map((l) => l.t)).toEqual(["-", "+"]);
  });

  test("marks binary, lockfile, generated and whitespace-only changes as noise", () => {
    const files = parseDiff(diff(
      "diff --git a/img.png b/img.png",
      "Binary files a/img.png and b/img.png differ",
      "diff --git a/bun.lock b/bun.lock",
      "--- a/bun.lock",
      "+++ b/bun.lock",
      "@@ -1 +1 @@",
      "-a",
      "+b",
      "diff --git a/dist/out.js b/dist/out.js",
      "--- a/dist/out.js",
      "+++ b/dist/out.js",
      "@@ -1 +1 @@",
      "-a",
      "+b",
      "diff --git a/src/x.ts b/src/x.ts",
      "--- a/src/x.ts",
      "+++ b/src/x.ts",
      "@@ -1 +1 @@",
      "-if (a) {",
      "+if (a)  {",
    ));
    expect(files.map((f) => f.noise)).toEqual(["binary", "lockfile", "generated", "whitespace only"]);
  });

  test("reads the paths git quotes, and the tab it ends a spaced name with", () => {
    const files = parseDiff(diff(
      'diff --git a/ünï.ts "b/ren\\"amed.ts"',
      "similarity index 50%",
      "rename from ünï.ts",
      'rename to "ren\\"amed.ts"',
      "--- a/ünï.ts",
      '+++ "b/ren\\"amed.ts"',
      "@@ -1 +1,2 @@",
      " x",
      "+y",
      "diff --git a/sp b/ace.ts b/sp b/ace.ts",
      "--- a/sp b/ace.ts\t",
      "+++ b/sp b/ace.ts\t",
      "@@ -1 +1,2 @@",
      " x",
      "+y",
      'diff --git "a/tab\\tname.ts" "b/tab\\tname.ts"',
      '--- "a/tab\\tname.ts"',
      '+++ "b/tab\\tname.ts"',
      "@@ -1 +1,2 @@",
      " x",
      "+y",
    ));
    expect(files.map((f) => [f.status, f.oldPath, f.path])).toEqual([
      ["renamed", "ünï.ts", 'ren"amed.ts'],
      ["modified", "sp b/ace.ts", "sp b/ace.ts"],
      ["modified", "tab\tname.ts", "tab\tname.ts"],
    ]);
  });

  test("unquotes octal bytes as UTF-8", () => {
    expect(unquote('"\\303\\274ber.ts"')).toBe("über.ts");
    expect(unquote("plain.ts")).toBe("plain.ts");
  });

  test("gives the same hunk the same hash", () => {
    const one = diff("diff --git a/a b/a", "--- a/a", "+++ b/a", "@@ -1 +1 @@", "-x", "+y");
    const moved = diff("diff --git a/a b/a", "--- a/a", "+++ b/a", "@@ -40 +41 @@", "-x", "+y");
    expect(parseDiff(one)[0].hunks[0].hash).toBe(parseDiff(moved)[0].hunks[0].hash);
  });
});

describe("parseGrep", () => {
  test("reads git grep output, with or without the commit prefix", () => {
    expect(parseGrep("abc123:src/a.ts:12:const x = 1;\nsrc/b:c.ts:3:y: 2\n\n", "abc123")).toEqual([
      { path: "src/a.ts", line: 12, text: "const x = 1;" },
      { path: "src/b:c.ts", line: 3, text: "y: 2" }, // a colon in the path: the first :<digits>: ends it
    ]);
  });
  test("cuts long lines", () => {
    expect(parseGrep(`a.ts:1:${"x".repeat(500)}`, "s")[0].text).toHaveLength(300);
  });
});
