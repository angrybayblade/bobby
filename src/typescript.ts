// The TypeScript language server: pinned versions, installed once into ~/.bobby/servers by Bobby itself (a compiled
// Bobby binary acts as Bun when BUN_BE_BUN is set), so it needs no npm or global install. It runs on Node when there
// is one: tsserver loads a large project dozens of times faster there than on Bun (3 s against 230 s on a monorepo).
// And the code it reads: a PR's head commit exported to ~/.bobby/trees, since Bobby never checks out a PR.
import { existsSync, mkdirSync, readdirSync, readFileSync, renameSync, rmSync, statSync, symlinkSync, utimesSync, writeFileSync } from "node:fs";
import { dirname, join, relative } from "node:path";
import { git } from "./git.ts";
import { home } from "./state.ts";

export const TS_SERVER = { languageServer: "4.3.3", typescript: "5.8.3" };
export const TS_SERVER_ID = `typescript-${TS_SERVER.languageServer}-${TS_SERVER.typescript}`;
const AS_BUN = { BUN_BE_BUN: "1" };

export interface ServerCommand { cmd: string[]; env: Record<string, string>; init: unknown }

/** The command that runs the server, installing it first if it isn't there yet (about 24 MB from npm). */
export async function typescriptServer(log: (m: string) => void): Promise<ServerCommand> {
  const dir = join(home(), "servers", TS_SERVER_ID);
  const cli = join(dir, "node_modules", "typescript-language-server", "lib", "cli.mjs");
  if (!existsSync(cli)) {
    log(`  installing the TypeScript language server (first time only, about 24 MB)…`);
    const tmp = `${dir}.${process.pid}.tmp`; // installed beside, then moved into place: two Bobbys never see half an install
    rmSync(tmp, { recursive: true, force: true });
    mkdirSync(tmp, { recursive: true });
    writeFileSync(join(tmp, "package.json"), JSON.stringify({ private: true }));
    const p = Bun.spawn([process.execPath, "add", "--exact", "--no-summary", `typescript-language-server@${TS_SERVER.languageServer}`, `typescript@${TS_SERVER.typescript}`],
      { cwd: tmp, env: { ...process.env, ...AS_BUN }, stdout: "pipe", stderr: "pipe" });
    const [code, err] = [await p.exited, await new Response(p.stderr).text()];
    if (code !== 0) { rmSync(tmp, { recursive: true, force: true }); throw new Error(`couldn't install it (${code}): ${err.trim().split("\n").slice(-2).join(" ")}`); }
    if (!existsSync(cli)) { try { renameSync(tmp, dir); } catch { rmSync(tmp, { recursive: true, force: true }); } } else rmSync(tmp, { recursive: true, force: true });
  }
  const node = await nodeRuntime();
  if (!node) log(`  (no Node 18+ on PATH: running it on Bun, which loads large projects much more slowly)`);
  return {
    cmd: node ? [node, cli, "--stdio"] : [process.execPath, cli, "--stdio"],
    env: node ? {} : AS_BUN,
    init: { tsserver: { path: join(dir, "node_modules", "typescript", "lib", "tsserver.js"), useSyntaxServer: "never" }, hostInfo: "bobby", maxTsServerMemory: 4096 },
  };
}

/** Node 18 or later on PATH, or null. */
async function nodeRuntime(): Promise<string | null> {
  const node = Bun.which("node");
  if (!node) return null;
  const p = Bun.spawn([node, "--version"], { stdout: "pipe", stderr: "ignore" });
  const major = Number(/^v(\d+)/.exec((await new Response(p.stdout).text()).trim())?.[1]);
  return (await p.exited) === 0 && major >= 18 ? node : null;
}

// What the server needs to see: code, declarations and the configs that tie them together.
const TREE_EXTS = ["ts", "tsx", "mts", "cts", "js", "jsx", "mjs", "cjs", "json"];
const KEEP_TREES = 3; // per repo, most recently used first; beyond that, ones unused for a day are removed
const IN_USE = 24 * 3_600_000; // a running Bobby marks its tree hourly, so a tree marked within a day may still be in use

/** A PR's head commit as plain files (its TS, JS and JSON only), exported once per commit and reused. */
export async function headTree(cwd: string, pr: { owner: string; repo: string; headSha: string }): Promise<string> {
  const base = join(home(), "trees", `${pr.owner}_${pr.repo}`), dir = join(base, pr.headSha.slice(0, 12)), done = join(dir, ".bobby-tree");
  if (existsSync(done)) { keepTree(dir); return dir; }
  // Exported beside, then moved into place: another Bobby on the same commit never sees, or deletes, half a tree.
  const tmp = `${dir}.${process.pid}.tmp`;
  rmSync(tmp, { recursive: true, force: true });
  mkdirSync(tmp, { recursive: true });
  // git archive fails on a pathspec that matches nothing, so only ask for extensions the commit has.
  const names = (await git(cwd, ["ls-tree", "-r", "--name-only", pr.headSha])).split("\n");
  const exts = TREE_EXTS.filter((e) => names.some((n) => n.endsWith(`.${e}`)));
  if (exts.length) {
    const archive = Bun.spawn(["git", "archive", "--format=tar", pr.headSha, "--", ...exts.map((e) => `*.${e}`)], { cwd, stdout: "pipe", stderr: "pipe" });
    const tar = Bun.spawn(["tar", "-x", "-C", tmp], { stdin: archive.stdout, stderr: "pipe" });
    const [a, t] = await Promise.all([archive.exited, tar.exited]);
    if (a !== 0 || t !== 0) {
      rmSync(tmp, { recursive: true, force: true });
      throw new Error(`couldn't export ${pr.headSha.slice(0, 7)}: ${(await new Response(archive.stderr).text()) || (await new Response(tar.stderr).text())}`.trim());
    }
  }
  linkWorkspaces(tmp);
  writeFileSync(join(tmp, ".bobby-tree"), pr.headSha);
  if (existsSync(dir) && !existsSync(done)) rmSync(dir, { recursive: true, force: true }); // half a tree, from a crash
  try { renameSync(tmp, dir); } catch { rmSync(tmp, { recursive: true, force: true }); } // another Bobby got there first: use its tree
  if (!existsSync(done)) throw new Error(`couldn't export ${pr.headSha.slice(0, 7)} to ${dir}`);
  prune(base);
  return dir;
}
/** Marks a tree as just used, so pruning keeps it. */
export function keepTree(dir: string) { try { const now = new Date(); utimesSync(join(dir, ".bobby-tree"), now, now); } catch { /* best effort */ } }

/** node_modules/<name> → the workspace package's folder, so imports between packages of a monorepo resolve
 *  without installing anything. Third-party packages stay missing: their types come back unresolved. */
function linkWorkspaces(dir: string) {
  const pkgs: Array<{ name: string; at: string }> = [];
  const walk = (d: string, depth: number) => {
    if (depth > 6) return;
    for (const e of readdirSync(d, { withFileTypes: true })) {
      if (e.name === "node_modules" || e.name.startsWith(".")) continue;
      const p = join(d, e.name);
      if (e.isDirectory()) walk(p, depth + 1);
      else if (e.name === "package.json" && d !== dir) {
        try { const name = JSON.parse(readFileSync(p, "utf8")).name; if (typeof name === "string" && /^(@[\w.-]+\/)?[\w.-]+$/.test(name)) pkgs.push({ name, at: d }); } catch { /* not JSON we can read */ }
      }
    }
  };
  walk(dir, 0);
  for (const { name, at } of pkgs) {
    const link = join(dir, "node_modules", name);
    if (existsSync(link)) continue;
    mkdirSync(dirname(link), { recursive: true });
    try { symlinkSync(relative(dirname(link), at), link, "dir"); } catch { /* a name taken twice: the first wins */ }
  }
}

function prune(base: string) {
  const used = (p: string) => statSync(join(p, ".bobby-tree")).mtimeMs;
  const trees = readdirSync(base).map((n) => join(base, n)).filter((p) => !p.endsWith(".tmp") && existsSync(join(p, ".bobby-tree"))).sort((a, b) => used(b) - used(a));
  for (const old of trees.slice(KEEP_TREES)) if (Date.now() - used(old) > IN_USE) rmSync(old, { recursive: true, force: true });
}

/** The languageId LSP expects for a file, or null if the TypeScript server doesn't read it. */
export function tsLanguageId(path: string): string | null {
  if (/\.(ts|mts|cts)$/.test(path)) return "typescript";
  if (/\.tsx$/.test(path)) return "typescriptreact";
  if (/\.(js|mjs|cjs)$/.test(path)) return "javascript";
  if (/\.jsx$/.test(path)) return "javascriptreact";
  return null;
}
