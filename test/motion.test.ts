import { expect, test } from "bun:test";
import { Glob } from "bun";

// CSS can turn off every transition, but not a scroll asked to be smooth: each must ask glide() (core.js), or Motion: Off
// leaves it moving.
test("every smooth scroll in the app respects the Motion setting", async () => {
  const found: string[] = [];
  for await (const path of new Glob("**/*.js").scan("public/app")) {
    const text = await Bun.file(`public/app/${path}`).text();
    text.split("\n").forEach((line, i) => { if (/["']smooth["']/.test(line) && !/glide\(\) === "smooth"|const glide =/.test(line)) found.push(`${path}:${i + 1}`); });
  }
  expect(found).toEqual([]);
});
