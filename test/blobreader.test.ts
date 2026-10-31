import { expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { BlobReader } from "../src/git.ts";

test("one running git cat-file reads files in turn, skips what isn't one, and starts again once closed", async () => {
  const root = mkdtempSync(join(tmpdir(), "bobby-blobs-"));
  mkdirSync(join(root, "src"));
  const a = "first file\n", b = "ünïcode, and a longer second file\n".repeat(5000);
  writeFileSync(join(root, "a.txt"), a);
  writeFileSync(join(root, "src", "b.ts"), b);
  for (const cmd of [["init", "-q"], ["add", "."], ["-c", "user.name=t", "-c", "user.email=t@t", "commit", "-qm", "x"]]) await Bun.spawn(["git", ...cmd], { cwd: root }).exited;
  const r = new BlobReader(root);
  const got = await Promise.all([r.read("HEAD:a.txt"), r.read("HEAD:no/such/file"), r.read("HEAD:src"), r.read("HEAD:src/b.ts")]);
  expect(got).toEqual([a, null, null, b]); // a folder's listing comes back too, and is skipped whole
  r.close();
  expect(await r.read("HEAD:a.txt")).toBe(a);
  r.close();
});
