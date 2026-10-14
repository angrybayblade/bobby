// Python: pyright's language server, installed from npm by Bobby itself. It never runs the code it reads.
import { existsSync } from "node:fs";
import { join, sep } from "node:path";
import { type LanguageServer, nodeCommand, npmInstall, serverDir } from "./langserver.ts";

const V = "1.1.414";
const NAME = `pyright-${V}`;
const SCRIPT = join("node_modules", "pyright", "langserver.index.js");

export const python: LanguageServer = {
  id: "python",
  title: "Python",
  languageId: (path) => (/\.pyi?$/.test(path) ? "python" : null),
  treeFiles: ["*.py", "*.pyi", "*pyproject.toml", "*pyrightconfig.json", "*setup.cfg"],
  async missing() { return null; },
  async installed() { return existsSync(join(serverDir(NAME), SCRIPT)); },
  installDir: NAME,
  offer: { size: "about 35 MB", from: `npm: pyright ${V}` },
  install: (log) => npmInstall(NAME, [`pyright@${V}`], SCRIPT, log),
  async version() { return NAME; },
  async command(_root, log) {
    return {
      ...(await nodeCommand(join(serverDir(NAME), SCRIPT), ["--stdio"], log)),
      settings: { "python.analysis": { diagnosticMode: "openFilesOnly", autoSearchPaths: true, useLibraryCodeForTypes: true } },
    };
  },
  outside(p) {
    const path = p.split(sep).join("/");
    if (/\/typeshed-fallback\/stdlib\//.test(path)) return "Python's standard library";
    const stub = /\/typeshed-fallback\/stubs\/([^/]+)\//.exec(path)?.[1];
    if (stub) return stub.replace(/^types-/, "");
    const pkg = /\/(?:site|dist)-packages\/([^/]+)/.exec(path)?.[1];
    return pkg ? pkg.replace(/\.py$|-stubs$/, "") : null;
  },
  importedPackage(line, root) {
    const m = /^\s*from\s+([\w.]+)\s+import\b/.exec(line) ?? /^\s*import\s+([\w.]+)/.exec(line);
    if (!m) return /^\s*from\s+\./.test(line) ? "" : null; // from .x import y: the repo's own
    const top = m[1].split(".")[0];
    const own = [top, `${top}.py`, join("src", top), join("src", `${top}.py`)].some((p) => existsSync(join(root, p)));
    return own ? "" : top; // a module of the repo that pyright couldn't place (a src layout it wasn't told about)
  },
};
