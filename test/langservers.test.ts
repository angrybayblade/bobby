import { expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { compileDatabase, cppOutside, includeDirs } from "../src/cpp.ts";
import { removeEverywhere } from "../src/langserver.ts";
import { cargoRoots, rustOutside } from "../src/rust.ts";

test("rust-analyzer gets the outermost folders with a Cargo.toml", () => {
  expect(cargoRoots(["/t", "/t/crates/a", "/t/crates/b"])).toEqual(["/t"]);
  expect(cargoRoots(["/t/rust/b", "/t/rust/a", "/t/tools"])).toEqual(["/t/tools", "/t/rust/b", "/t/rust/a"]);
  expect(cargoRoots(["/t/rust", "/t/rust-extras"])).toEqual(["/t/rust", "/t/rust-extras"]); // a prefix isn't a parent
});

test("a Rust declaration outside the repo is named", () => {
  expect(rustOutside("/h/.rustup/toolchains/stable/lib/rustlib/src/rust/library/core/src/option.rs")).toBe("Rust's standard library");
  expect(rustOutside("/h/.cargo/registry/src/index.crates.io-6f17d22bba15001f/aho-corasick-1.1.5/src/lib.rs")).toBe("aho-corasick");
  expect(rustOutside("/h/.cargo/git/checkouts/tokio-1a2b3c4d5e6f7a8b/abc123/src/lib.rs")).toBe("tokio");
  expect(rustOutside("/h/.bobby/trees/x/abc/crates/ignore/src/lib.rs")).toBeNull();
});

test("clangd's compile database lists sources, so headers take the language of those near them", () => {
  const db = compileDatabase("/t", ["src/a.c", "src/b.cc", "include/x.h", "lib/c.cpp", "lib/d.hpp"]);
  expect(db.map((e) => [e.file, e.arguments[0]])).toEqual([["src/a.c", "clang"], ["src/b.cc", "clang++"], ["lib/c.cpp", "clang++"]]);
  expect(db[0].directory).toBe("/t");
});

test("clangd searches the top, folders with headers, and the usual include folders", () => {
  expect(includeDirs(["include/proj/x.h", "src/deep/y.c", "a.h", "third_party/lib/z.cc"])).toEqual([".", "include", "src", "include/proj", "third_party/lib"]);
});

test("a C or C++ declaration outside the repo is named", () => {
  expect(cppOutside("/Library/Developer/CommandLineTools/SDKs/MacOSX.sdk/usr/include/c++/v1/algorithm")).toBe("C++'s standard library");
  expect(cppOutside("/usr/include/c++/13/vector")).toBe("C++'s standard library");
  expect(cppOutside("/usr/include/stdio.h")).toBe("C's standard library");
  expect(cppOutside("/usr/include/sys/types.h")).toBe("C's standard library");
  expect(cppOutside("/usr/lib/clang/17/include/stddef.h")).toBe("C's standard library");
  expect(cppOutside("/usr/include/openssl/ssl.h")).toBe("openssl");
  expect(cppOutside("/opt/homebrew/include/boost/any.hpp")).toBe("boost");
  expect(cppOutside("/h/.bobby/trees/x/abc/include/usr/include/mine.h")).toBeNull();
});

test("a file a server would trust goes, however deep and wherever", () => {
  const dir = mkdtempSync(join(tmpdir(), "bobby-rm-"));
  for (const d of ["", "vendor/a", ".hidden", "1/2/3/4/5/6/7/8/9/10"]) { mkdirSync(join(dir, d), { recursive: true }); writeFileSync(join(dir, d, "compile_commands.json"), "[]"); writeFileSync(join(dir, d, "keep.c"), ""); }
  removeEverywhere(dir, "compile_commands.json");
  const left = (readdirSync(dir, { recursive: true }) as string[]).filter((f) => f.endsWith(".json") || f.endsWith(".c"));
  expect(left.filter((f) => f.endsWith(".json"))).toEqual([]);
  expect(left.filter((f) => f.endsWith(".c")).length).toBe(4);
  rmSync(dir, { recursive: true, force: true });
});
