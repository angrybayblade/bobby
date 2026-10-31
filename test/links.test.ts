import { expect, test } from "bun:test";
import { existsSync, lstatSync, mkdirSync, mkdtempSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { dropOutsideLinks } from "../src/langserver.ts";

test("an exported tree keeps its links within it, and loses those that lead out", async () => {
  const repo = mkdtempSync(join(tmpdir(), "bobby-links-")), secret = join(mkdtempSync(join(tmpdir(), "bobby-secret-")), "credentials");
  writeFileSync(secret, "hush");
  mkdirSync(join(repo, "docs"));
  writeFileSync(join(repo, "README.md"), "hi");
  symlinkSync("../README.md", join(repo, "docs", "readme.md")); // within
  symlinkSync(secret, join(repo, "notes.md")); // out, absolute
  symlinkSync("../../../../../../../../etc/hosts", join(repo, "docs", "hosts")); // out, relative
  symlinkSync("docs/hosts", join(repo, "chain.md")); // in, but on through one that leads out
  symlinkSync("nowhere/at/all", join(repo, "dangling")); // within, dangling
  for (const cmd of [["init", "-q"], ["add", "."], ["-c", "user.name=t", "-c", "user.email=t@t", "commit", "-qm", "x"]]) await Bun.spawn(["git", ...cmd], { cwd: repo }).exited;
  const tree = mkdtempSync(join(tmpdir(), "bobby-tree-"));
  const archive = Bun.spawn(["git", "archive", "--format=tar", "HEAD"], { cwd: repo, stdout: "pipe" });
  await Bun.spawn(["tar", "-x", "-C", tree], { stdin: archive.stdout }).exited;
  expect((await dropOutsideLinks(repo, "HEAD", tree)).sort()).toEqual(["chain.md", "docs/hosts", "notes.md"]);
  expect(existsSync(join(tree, "notes.md"))).toBe(false);
  expect(lstatSync(join(tree, "docs", "readme.md")).isSymbolicLink()).toBe(true);
  expect(lstatSync(join(tree, "dangling")).isSymbolicLink()).toBe(true);
});
