// TypeScript and JavaScript: typescript-language-server over a pinned TypeScript, installed from npm by Bobby itself.
import { existsSync, mkdirSync, readdirSync, readFileSync, symlinkSync } from "node:fs";
import { dirname, join, relative, resolve, sep } from "node:path";
import { type LanguageServer, nodeCommand, npmInstall, serverDir } from "./langserver.ts";

const V = { languageServer: "4.3.3", typescript: "5.8.3" };
const NAME = `typescript-${V.languageServer}-${V.typescript}`;
const CLI = join("node_modules", "typescript-language-server", "lib", "cli.mjs");

export const typescript: LanguageServer = {
  id: "typescript",
  title: "TypeScript",
  languageId: tsLanguageId,
  treeFiles: ["*.ts", "*.tsx", "*.mts", "*.cts", "*.js", "*.jsx", "*.mjs", "*.cjs", "*.json"],
  prepareTree: linkWorkspaces,
  async missing() { return null; },
  async installed() { return existsSync(join(serverDir(NAME), CLI)); },
  installDir: NAME,
  offer: { size: "about 24 MB", from: `npm: typescript-language-server ${V.languageServer} and TypeScript ${V.typescript}` },
  install: (log) => npmInstall(NAME, [`typescript-language-server@${V.languageServer}`, `typescript@${V.typescript}`], CLI, log),
  async version() { return NAME; },
  async command(_root, log) {
    const dir = serverDir(NAME);
    return {
      ...(await nodeCommand(join(dir, CLI), ["--stdio"], log)),
      // Not the syntax-only server: it answers an import with the import line itself.
      init: { tsserver: { path: join(dir, "node_modules", "typescript", "lib", "tsserver.js"), useSyntaxServer: "never" }, hostInfo: "bobby", maxTsServerMemory: 4096 },
    };
  },
  outside(p) {
    const path = p.split(sep).join("/");
    if (/\/typescript\/lib\/lib\.[^/]*\.d\.ts$/.test(path)) return "TypeScript's built-in types";
    const m = /node_modules\/((?:@[^/]+\/)?[^/]+)/.exec(path);
    return m ? m[1].replace(/^@types\//, "") : null;
  },
  importedPackage(line) {
    const pkg = /^\s*import\b/.test(line) && /from\s+['"]([^'"]+)['"]/.exec(line)?.[1];
    if (!pkg) return null;
    return pkg.startsWith(".") || /^[@~#]\//.test(pkg) ? "" : pkg; // a relative import or a tsconfig alias is the repo's own
  },
};

/** The languageId LSP expects for a file, or null if the TypeScript server doesn't read it. */
export function tsLanguageId(path: string): string | null {
  if (/\.(ts|mts|cts)$/.test(path)) return "typescript";
  if (/\.tsx$/.test(path)) return "typescriptreact";
  if (/\.(js|mjs|cjs)$/.test(path)) return "javascript";
  if (/\.jsx$/.test(path)) return "javascriptreact";
  return null;
}

/** node_modules/<name> → the workspace package's folder, so imports between packages of a monorepo resolve
 *  without installing anything. Third-party packages stay missing: their names come back as outside the repo. */
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
    // Windows: a junction, which needs no Developer Mode (a symlink does), and takes an absolute target
    try { process.platform === "win32" ? symlinkSync(resolve(at), link, "junction") : symlinkSync(relative(dirname(link), at), link, "dir"); } catch { /* a name taken twice: the first wins */ }
  }
}
