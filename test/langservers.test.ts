import { expect, test } from "bun:test";
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
