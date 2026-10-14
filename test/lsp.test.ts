import { expect, test } from "bun:test";
import { join } from "node:path";
import { LspClient } from "../src/lsp.ts";

test("reads answers split across chunks, two to a write, and large ones", async () => {
  const c = await LspClient.start(["bun", join(import.meta.dir, "fixtures", "fake-lsp.ts")], import.meta.dir);
  const sizes = [0, 10, 70_000, 3, 2_000_000, 1];
  const answers = await Promise.all(sizes.map((size, i) => c.request<{ echo: { i: number; size: number }; pad: string }>("test/echo", { i, size })));
  expect(answers.map((a) => [a.echo.i, a.pad.length])).toEqual(sizes.map((s, i) => [i, s]));
  await c.stop();
});
