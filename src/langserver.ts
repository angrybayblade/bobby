// Language servers, plug and play: each language is one LanguageServer (typescript.ts, python.ts, go.ts), and
// everything else (starting it, placing names, the inspector) is shared. Here: the interface, installing from npm,
// and the code a server reads, a PR's head commit exported to ~/.bobby/trees, since Bobby never checks out a PR.
import { existsSync, mkdirSync, readdirSync, readFileSync, renameSync, rmSync, statSync, utimesSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { git } from "./git.ts";
import { home } from "./state.ts";

export interface ServerCommand {
  cmd: string[];
  env: Record<string, string>;
  init?: unknown; // initializationOptions
  settings?: Record<string, unknown>; // answers to workspace/configuration, by section
}
/** What Bobby can install for you, said before asking. */
export interface Offer { size: string; from: string }

export interface LanguageServer {
  id: string; // "typescript", "python", "go": the key in settings and on the command line
  title: string; // "Go", for the UI
  languageId(path: string): string | null; // the LSP languageId of a file it reads, or null
  treeFiles: string[]; // git pathspecs the server needs from a PR's head: its sources and configs
  prepareTree?(dir: string): void | Promise<void>; // on the exported tree, before any server reads it (never a working copy)
  /** A prerequisite Bobby can't install (Go, gopls), as what to do about it; null when nothing is missing. */
  missing(): Promise<{ hint: string; command?: string } | null>;
  installed(): Promise<boolean>;
  offer?: Offer; // set when Bobby can install it, after asking
  install?(log: (m: string) => void): Promise<void>;
  version(): Promise<string>; // part of the cache key: other versions may place names differently
  command(root: string, log: (m: string) => void): Promise<ServerCommand>;
  folders?(root: string): string[]; // workspace folders; the root alone if absent
  /** A declaration outside the repo, named: a package, a module, the standard library. Null: one of the repo's own. */
  outside(absPath: string): string | null;
  /** The server stopped at an import line (the package isn't installed): which package, "" for one of the repo's own
   *  (a path alias, a module of the repo), null if the line isn't an import. root: the tree the server reads. */
  importedPackage?(line: string, root: string): string | null;
}

const AS_BUN = { BUN_BE_BUN: "1" };

/** Node 18 or later on PATH, or null. Node-based servers run there when they can: tsserver loads a large project
 *  dozens of times faster on Node than on Bun (3 s against 230 s on a monorepo). */
export async function nodeRuntime(): Promise<string | null> {
  const node = Bun.which("node");
  if (!node) return null;
  const p = Bun.spawn([node, "--version"], { stdout: "pipe", stderr: "ignore" });
  const major = Number(/^v(\d+)/.exec((await new Response(p.stdout).text()).trim())?.[1]);
  return (await p.exited) === 0 && major >= 18 ? node : null;
}
/** How to run a script from an npm package: on Node when there is one, else on Bobby itself, as Bun. */
export async function nodeCommand(script: string, args: string[], log: (m: string) => void): Promise<Pick<ServerCommand, "cmd" | "env">> {
  const node = await nodeRuntime();
  if (!node) log(`  (no Node 18+ on PATH: running it on Bun, which is much slower on large projects)`);
  return node ? { cmd: [node, script, ...args], env: {} } : { cmd: [process.execPath, script, ...args], env: AS_BUN };
}

export const serverDir = (name: string) => join(home(), "servers", name);
/** Installs pinned npm packages into ~/.bobby/servers/<name>, with Bobby itself as the package manager (a compiled
 *  Bobby binary acts as Bun), so it needs no npm. Installed beside, then moved into place: two Bobbys never see half. */
export async function npmInstall(name: string, packages: string[], done: string, log: (m: string) => void) {
  const dir = serverDir(name);
  if (existsSync(join(dir, done))) return;
  const tmp = `${dir}.${process.pid}.tmp`;
  rmSync(tmp, { recursive: true, force: true });
  mkdirSync(tmp, { recursive: true });
  writeFileSync(join(tmp, "package.json"), JSON.stringify({ private: true }));
  log(`  installing ${packages.join(", ")} into ${dir}…`);
  const p = Bun.spawn([process.execPath, "add", "--exact", "--no-summary", ...packages], { cwd: tmp, env: { ...process.env, ...AS_BUN }, stdout: "pipe", stderr: "pipe" });
  const [code, err] = [await p.exited, await new Response(p.stderr).text()];
  if (code !== 0 || !existsSync(join(tmp, done))) {
    rmSync(tmp, { recursive: true, force: true });
    throw new Error(`couldn't install ${packages.join(", ")} (${code}): ${err.trim().split("\n").slice(-2).join(" ")}`);
  }
  if (existsSync(join(dir, done))) rmSync(tmp, { recursive: true, force: true });
  else { rmSync(dir, { recursive: true, force: true }); renameSync(tmp, dir); }
}

const KEEP_TREES = 3; // per repo, most recently used first; beyond that, ones unused for a day are removed
const IN_USE = 24 * 3_600_000; // a running Bobby marks its tree hourly, so a tree marked within a day may still be in use

/** A PR's head commit as plain files, only what the servers read (their pathspecs), exported once per commit and
 *  reused; again if the pathspecs changed (a language added). */
export async function headTree(cwd: string, pr: { owner: string; repo: string; headSha: string }, servers: LanguageServer[]): Promise<string> {
  const specs = [...new Set(servers.flatMap((s) => s.treeFiles))].sort();
  const stamp = `${pr.headSha}\n${specs.join(" ")}`;
  const base = join(home(), "trees", `${pr.owner}_${pr.repo}`), dir = join(base, pr.headSha.slice(0, 12)), done = join(dir, ".bobby-tree");
  if (existsSync(done) && readFileSync(done, "utf8") === stamp) { keepTree(dir); return dir; }
  // Exported beside, then moved into place: another Bobby on the same commit never sees, or deletes, half a tree.
  const tmp = `${dir}.${process.pid}.tmp`;
  rmSync(tmp, { recursive: true, force: true });
  mkdirSync(tmp, { recursive: true });
  // git archive fails on a pathspec that matches nothing, so only ask for what the commit has.
  const names = (await git(cwd, ["ls-tree", "-r", "-z", "--name-only", pr.headSha])).split("\0");
  const has = specs.filter((s) => { const re = globRe(s); return names.some((n) => re.test(n)); });
  if (has.length) {
    const archive = Bun.spawn(["git", "archive", "--format=tar", pr.headSha, "--", ...has], { cwd, stdout: "pipe", stderr: "pipe" });
    const tar = Bun.spawn(["tar", "-x", "-C", tmp], { stdin: archive.stdout, stderr: "pipe" });
    const [a, t] = await Promise.all([archive.exited, tar.exited]);
    if (a !== 0 || t !== 0) {
      rmSync(tmp, { recursive: true, force: true });
      throw new Error(`couldn't export ${pr.headSha.slice(0, 7)}: ${(await new Response(archive.stderr).text()) || (await new Response(tar.stderr).text())}`.trim());
    }
  }
  for (const s of servers) await s.prepareTree?.(tmp);
  writeFileSync(join(tmp, ".bobby-tree"), stamp);
  if (existsSync(dir) && (!existsSync(done) || readFileSync(done, "utf8") !== stamp)) rmSync(dir, { recursive: true, force: true }); // half a tree, or an older export
  try { renameSync(tmp, dir); } catch { rmSync(tmp, { recursive: true, force: true }); } // another Bobby got there first: use its tree
  if (!existsSync(done)) throw new Error(`couldn't export ${pr.headSha.slice(0, 7)} to ${dir}`);
  prune(base);
  return dir;
}
/** A git pathspec ("*.go", "*go.mod"), as git matches it without magic: * crosses directories. */
const globRe = (spec: string) => new RegExp(`^${spec.replace(/[.+^${}()|[\]\\]/g, "\\$&").replace(/\*/g, ".*").replace(/\?/g, ".")}$`);

/** Marks a tree as just used, so pruning keeps it. */
export function keepTree(dir: string) { try { const now = new Date(); utimesSync(join(dir, ".bobby-tree"), now, now); } catch { /* best effort */ } }
function prune(base: string) {
  const used = (p: string) => statSync(join(p, ".bobby-tree")).mtimeMs;
  const trees = readdirSync(base).map((n) => join(base, n)).filter((p) => !p.endsWith(".tmp") && existsSync(join(p, ".bobby-tree"))).sort((a, b) => used(b) - used(a));
  for (const old of trees.slice(KEEP_TREES)) if (Date.now() - used(old) > IN_USE) rmSync(old, { recursive: true, force: true });
}

/** Directories under root holding a file named `name` (go.mod, tsconfig.json…), skipping dependencies and dot folders. */
export function dirsWith(root: string, name: string, limit = 50): string[] {
  const out: string[] = [];
  const walk = (d: string, depth: number) => {
    if (depth > 8 || out.length >= limit) return;
    let entries;
    try { entries = readdirSync(d, { withFileTypes: true }); } catch { return; }
    if (entries.some((e) => e.isFile() && e.name === name)) out.push(d);
    for (const e of entries) if (e.isDirectory() && !e.name.startsWith(".") && !["node_modules", "vendor", "testdata"].includes(e.name)) walk(join(d, e.name), depth + 1);
  };
  walk(root, 0);
  return out;
}
