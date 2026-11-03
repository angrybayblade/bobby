// C and C++: clangd, which you install (it comes with LLVM, and with Xcode's command line tools). It parses what it
// reads and runs nothing, as long as it isn't told to: a compile_commands.json can carry any flag, and a .clangd config
// more, and a PR could bring both. So in a PR's exported tree the only one it reads is Bobby's: each source file, with
// include folders guessed from where the headers are, since the build's flags aren't known; a header's language follows
// from the sources near it. Names behind a generated header or an unusual flag aren't found. A local review reads your
// own compile_commands.json, as your editor does.
import { existsSync, readdirSync, writeFileSync } from "node:fs";
import { join, relative, sep } from "node:path";
import { removeEverywhere, type LanguageServer } from "./langserver.ts";

const SOURCE = ["c", "cc", "cpp", "cxx", "c++"], HEADER = ["h", "hh", "hpp", "hxx", "ipp", "inl", "tpp"];
const READS = new RegExp(`\\.(${[...SOURCE, ...HEADER].join("|").replace(/\+/g, "\\+")})$`, "i");
const IS_HEADER = new RegExp(`\\.(${HEADER.join("|")})$`, "i");
const RSP = ".bobby-includes.rsp"; // the include folders, once: a large repo has thousands of sources and hundreds of folders
const INCLUDE_DIRS = 400; // past this, the folders nearest the top: every one is searched for every include
const INSTALL = process.platform === "darwin" ? "xcode-select --install" : "sudo apt install clangd";

/** clangd, if it's here and runs. macOS's /usr/bin/clangd is a stand-in that pops up an installer without the command
 *  line tools, so it's only run once they're known to be there. */
async function clangd(): Promise<{ bin: string; version: string } | null> {
  const bin = Bun.which("clangd") ?? ["/opt/homebrew/opt/llvm/bin/clangd", "/usr/local/opt/llvm/bin/clangd"].find(existsSync);
  if (!bin) return null;
  if (process.platform === "darwin" && bin === "/usr/bin/clangd" && (await Bun.spawn(["xcode-select", "-p"], { stdout: "ignore", stderr: "ignore" }).exited) !== 0) return null;
  const p = Bun.spawn([bin, "--version"], { stdout: "pipe", stderr: "ignore" });
  const [out, code] = [await new Response(p.stdout).text(), await p.exited];
  const version = /clangd version (\S+)/.exec(out)?.[1];
  return code === 0 && version ? { bin, version } : null;
}

/** The folders to search for includes: the top, every folder with a header (#include "x.h"), and any named include,
 *  src or lib (#include <project/x.h>), the nearest the top first. Relative to the tree: it's moved after this. */
export function includeDirs(files: string[]): string[] {
  const dirs = new Set<string>(["."]);
  for (const f of files) {
    const at = f.lastIndexOf("/"), dir = at < 0 ? "." : f.slice(0, at);
    if (IS_HEADER.test(f)) dirs.add(dir);
    const parts = dir.split("/");
    parts.forEach((p, i) => { if (["include", "src", "lib"].includes(p)) dirs.add(parts.slice(0, i + 1).join("/")); });
  }
  const depth = (d: string) => (d === "." ? 0 : d.split("/").length);
  return [...dirs].sort((a, b) => depth(a) - depth(b) || a.localeCompare(b)).slice(0, INCLUDE_DIRS);
}
function filesUnder(root: string): string[] {
  return (readdirSync(root, { recursive: true, withFileTypes: true }) as Array<{ name: string; parentPath: string; isFile(): boolean }>)
    .filter((e) => e.isFile() && READS.test(e.name)).map((e) => relative(root, join(e.parentPath, e.name)).split(sep).join("/"));
}

const SYSTEM = new Set(["sys", "bits", "machine", "arpa", "net", "netinet", "linux", "asm", "asm-generic", "gnu", "mach", "os", "xlocale", "secure", "_types", "libkern", "malloc", "i386", "arm"]);
/** The compile database for an exported tree. Paths are absolute, as the format wants, so it's written once the tree
 *  is where it will stay; the include folders are relative to it. */
export function compileDatabase(root: string, files: string[]) {
  return files.filter((f) => !IS_HEADER.test(f)).map((file) => ({ directory: root, file, arguments: [/\.c$/i.test(file) ? "clang" : "clang++", `@${RSP}`, "-c", file] }));
}

/** A declaration outside the repo, by the header it's in. */
export function cppOutside(path: string): string | null {
  const p = path.split(sep).join("/");
  if (/\/c\+\+\/(v\d+|\d[^/]*)\//.test(p)) return "C++'s standard library";
  if (/\/lib\/clang\/[^/]+\/include\//.test(p)) return "C's standard library";
  const under = /(?:^\/usr(?:\/local)?|^\/opt\/homebrew|\/SDKs\/[^/]+\/usr)\/include\/(.+)$/.exec(p)?.[1];
  if (!under) return null;
  const parts = under.split("/");
  return parts.length === 1 || SYSTEM.has(parts[0]) ? "C's standard library" : parts[0];
}

export const cpp: LanguageServer = {
  id: "cpp",
  title: "C/C++",
  languageId: (path) => (/\.c$/i.test(path) ? "c" : READS.test(path) ? "cpp" : null),
  treeFiles: [...SOURCE, ...HEADER, "inc", "def"].map((e) => `*.${e}`), // .inc and .def: not read on their own, but included
  prepareTree(dir) {
    removeEverywhere(dir, "compile_commands.json"); // *.json is exported for TypeScript
    writeFileSync(join(dir, RSP), `${includeDirs(filesUnder(dir)).map((d) => `-I${d}`).join("\n")}\n`);
  },
  async missing() {
    return (await clangd()) ? null : { hint: "C and C++ types need clangd. Install it, then check again:", command: INSTALL };
  },
  async installed() { return !!(await clangd()); },
  async version() { return `clangd-${(await clangd())?.version ?? "unknown"}`; },
  async command(root) {
    const exported = existsSync(join(root, ".bobby-tree"));
    if (exported) writeFileSync(join(root, "compile_commands.json"), JSON.stringify(compileDatabase(root, filesUnder(root))));
    return {
      cmd: [(await clangd())!.bin, "--enable-config=false", "--clang-tidy=false", "--header-insertion=never", "--log=error", "--pretty=false",
        // Only there: the index is written beside the code, and a working copy is never modified.
        ...(exported ? [`--compile-commands-dir=${root}`, "--background-index", "--background-index-priority=low"] : ["--background-index=false"])],
      env: {},
    };
  },
  outside: cppOutside,
};
