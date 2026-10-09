#!/usr/bin/env bun
// Builds standalone bobby binaries: the CLI, the server and the UI in one file, no bun needed to run it.
//   bun run build            this machine → dist/bobby
//   bun run build --all      every target → dist/bobby-<os>-<arch>[.exe]
// git and gh are still needed at runtime, and claude for the smarter tree.
import { mkdirSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import { join, relative } from "node:path";

const root = join(import.meta.dir, "..");
const gen = join(root, "dist", ".build");
rmSync(gen, { recursive: true, force: true });
mkdirSync(gen, { recursive: true });

// 1. Every file under public/, as [content type, base64].
const walk = (dir: string): string[] => readdirSync(dir).flatMap((n) => (statSync(join(dir, n)).isDirectory() ? walk(join(dir, n)) : [join(dir, n)]));
const assets: Record<string, [string, string]> = {};
for (const file of walk(join(root, "public"))) {
  assets[relative(join(root, "public"), file).split("\\").join("/")] = [Bun.file(file).type, readFileSync(file).toString("base64")];
}
writeFileSync(join(gen, "assets.gen.ts"), `export default ${JSON.stringify(assets)} as Record<string, [string, string]>;\n`);

// 2. An entry that embeds them before the CLI runs (a dynamic import, so it runs second).
writeFileSync(join(gen, "entry.ts"), `import { embed } from "../../src/assets.ts";
import assets from "./assets.gen.ts";
embed(assets);
await import("../../src/cli.ts");
`);

// 3. Compile.
const targets = Bun.argv.includes("--all")
  ? ["darwin-arm64", "darwin-x64", "linux-x64", "linux-arm64", "windows-x64"]
  : [null];
for (const t of targets) {
  const out = join(root, "dist", t ? `bobby-${t}${t.startsWith("windows") ? ".exe" : ""}` : "bobby");
  const args = ["bun", "build", "--compile", "--minify", join(gen, "entry.ts"), "--outfile", out, ...(t ? [`--target=bun-${t}`] : [])];
  const proc = Bun.spawnSync(args, { cwd: root, stdout: "inherit", stderr: "inherit" });
  if (proc.exitCode !== 0) process.exit(proc.exitCode ?? 1);
  console.log(`✓ ${relative(root, out)}`);
}
rmSync(gen, { recursive: true, force: true });
