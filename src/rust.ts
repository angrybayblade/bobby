// Rust: rust-analyzer, which you install (rustup component add rust-analyzer): it needs Cargo anyway, and most Rust
// setups already have it. Left to itself it builds what it reads: build scripts and proc macros are the PR's code, run
// on your machine. So it starts locked down for code it hasn't vetted: neither of those, no cargo check, nothing
// downloaded. And what could point it at something else never reaches the exported tree: .cargo/config.toml (a
// rustc-wrapper), rust-toolchain.toml (a toolchain's path), rust-analyzer.toml (a check command), rust-project.json.
// Names that a build script or a proc macro would generate aren't found.
import { sep } from "node:path";
import { dirsWith, removeEverywhere, type LanguageServer } from "./langserver.ts";

const LOCKED = { CARGO_NET_OFFLINE: "true", RUSTUP_AUTO_INSTALL: "0" };
const INSTALL = "rustup component add rust-analyzer rust-src";

/** The tool's version, or null if it isn't there or won't run: rustup puts a stand-in for rust-analyzer on PATH that
 *  fails until the component is added, so being on PATH says nothing. */
async function versionOf(tool: string): Promise<string | null> {
  const bin = Bun.which(tool);
  if (!bin) return null;
  const p = Bun.spawn([bin, "--version"], { stdout: "pipe", stderr: "ignore", env: { ...process.env, ...LOCKED } });
  const [out, code] = [await new Response(p.stdout).text(), await p.exited];
  return code === 0 ? out.trim() : null;
}

/** The outermost folders with a Cargo.toml: rust-analyzer looks only in a workspace folder and just under it, and a
 *  workspace's members load with it. */
export function cargoRoots(found: string[]): string[] {
  const top: string[] = [];
  for (const d of [...found].sort((a, b) => a.length - b.length)) if (!top.some((t) => d === t || d.startsWith(`${t}${sep}`))) top.push(d);
  return top;
}

/** A declaration outside the repo, by the path it's in: the standard library, or a crate as Cargo unpacked it. */
export function rustOutside(path: string): string | null {
  const p = path.split(sep).join("/");
  if (/\/rustlib\/src\/rust\/library\//.test(p)) return "Rust's standard library";
  const reg = /\/registry\/src\/[^/]+\/([^/]+?)-\d+\.\d+\.\d+[^/]*\//.exec(p)?.[1];
  if (reg) return reg;
  return /\/git\/checkouts\/([^/]+?)-[0-9a-f]{8,}\//.exec(p)?.[1] ?? null;
}

export const rust: LanguageServer = {
  id: "rust",
  title: "Rust",
  languageId: (path) => (path.endsWith(".rs") ? "rust" : null),
  treeFiles: ["*.rs", "*Cargo.toml", "*Cargo.lock"],
  loads: true,
  prepareTree(dir) { removeEverywhere(dir, "rust-project.json"); }, // *.json is exported for TypeScript
  async missing() {
    if (!Bun.which("cargo")) return { hint: "Rust types need Rust and rust-analyzer on this machine. Until then, Rust names are found through imports." };
    if (!(await versionOf("rust-analyzer"))) return { hint: "Rust types need rust-analyzer. Install it, then check again:", command: INSTALL };
    return null;
  },
  async installed() { return !!(await versionOf("rust-analyzer")); },
  async version() { return (await versionOf("rust-analyzer"))?.split(/\s+/).slice(0, 2).join("-") ?? "rust-analyzer-unknown"; },
  async command() {
    return {
      cmd: [Bun.which("rust-analyzer")!],
      env: LOCKED,
      init: {
        cargo: { buildScripts: { enable: false } },
        procMacro: { enable: false },
        checkOnSave: false,
        check: { workspace: false },
        diagnostics: { enable: false },
        cachePriming: { enable: false },
        lru: { capacity: 256 },
      },
    };
  },
  folders(root) {
    const roots = cargoRoots(dirsWith(root, "Cargo.toml"));
    return roots.length ? roots : [root];
  },
  outside: rustOutside,
};
