// Go: gopls, which you install (go install golang.org/x/tools/gopls@latest): it needs the Go toolchain anyway, and
// most Go setups already have it. Bobby starts it locked down for code it hasn't vetted: no module or toolchain
// downloads, no cgo. Go loads a module's whole dependency graph or nothing, so in a PR's exported tree each required
// module missing from your module cache is replaced by an empty stub: the repo's own code resolves, and names from
// those modules aren't found. Modules you have cached resolve as usual.
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join, relative, sep } from "node:path";
import { dirsWith, type LanguageServer } from "./langserver.ts";
import { home } from "./state.ts";

const LOCKED = { GOTOOLCHAIN: "local", GOPROXY: "off", GOSUMDB: "off", GOFLAGS: "-mod=readonly", CGO_ENABLED: "0" };
const INSTALL = "go install golang.org/x/tools/gopls@latest";

type GoEnv = { go: string; gopls: string | null; GOROOT: string; GOMODCACHE: string };
let env: Promise<GoEnv | null> | null = null;
/** Where go and gopls are, asked once (again after "check again"). gopls is often in $GOPATH/bin, which isn't always on PATH. */
function goEnv(fresh = false): Promise<GoEnv | null> {
  if (env && !fresh) return env;
  return (env = (async () => {
    const go = Bun.which("go");
    if (!go) return null;
    const p = Bun.spawn([go, "env", "-json", "GOPATH", "GOROOT", "GOMODCACHE"], { cwd: home(), env: { ...process.env, GOTOOLCHAIN: "local" }, stdout: "pipe", stderr: "ignore" });
    const e = JSON.parse((await new Response(p.stdout).text()) || "{}") as Record<string, string>;
    await p.exited;
    const inGopath = (e.GOPATH ?? "").split(process.platform === "win32" ? ";" : ":").filter(Boolean).map((d) => join(d, "bin", process.platform === "win32" ? "gopls.exe" : "gopls"));
    const gopls = Bun.which("gopls") ?? inGopath.find((f) => Bun.file(f).size > 0) ?? null;
    return { go, gopls, GOROOT: e.GOROOT ?? "", GOMODCACHE: e.GOMODCACHE ?? "" };
  })());
}

const modules = new Map<string, string[]>(); // root → the module paths declared under it
function modulesUnder(root: string) {
  let m = modules.get(root);
  if (!m) {
    m = dirsWith(root, "go.mod").map((d) => /^module\s+(\S+)/m.exec(readFileSync(join(d, "go.mod"), "utf8"))?.[1]).filter((x): x is string => !!x);
    modules.set(root, m);
  }
  return m;
}

/** The module cache's form of a module path: capitals escaped as !x. */
const escapeModule = (p: string) => p.replace(/[A-Z]/g, (c) => `!${c.toLowerCase()}`);
/** go.mod's requirements and replaced modules, in both the one-line and the block forms. */
function requirements(gomod: string) {
  const req: Array<{ path: string; version: string }> = [], replaced = new Set<string>();
  let block = "";
  for (const raw of gomod.split("\n")) {
    const line = raw.replace(/\/\/.*$/, "").trim();
    if (!line) continue;
    if (block) { if (line === ")") { block = ""; continue; } }
    else {
      const m = /^(require|replace)\s*(\(?)\s*(.*)$/.exec(line);
      if (!m) continue;
      if (m[2]) { block = m[1]; continue; }
      block = ""; if (m[1] === "require") { const [p, v] = m[3].split(/\s+/); if (p && v) req.push({ path: p, version: v }); } else replaced.add(m[3].split(/\s+/)[0]);
      continue;
    }
    const [p, v] = line.split(/\s+/);
    if (block === "require" && p && v) req.push({ path: p, version: v });
    if (block === "replace" && p) replaced.add(p);
  }
  return { req, replaced };
}
/** In an exported tree: each module the build needs that isn't in your module cache becomes an empty local stub.
 *  Go's own word on what's missing, asked offline and repeatedly: a cached module can need an uncached one in turn. */
async function stubMissingModules(dir: string) {
  const e = await goEnv();
  if (!e?.GOMODCACHE) return;
  for (const modDir of dirsWith(dir, "go.mod")) {
    const file = join(modDir, "go.mod"), { req, replaced } = requirements(readFileSync(file, "utf8"));
    const cached = (r: { path: string; version: string }) => existsSync(join(e.GOMODCACHE, `${escapeModule(r.path)}@${r.version}`))
      || existsSync(join(e.GOMODCACHE, "cache", "download", escapeModule(r.path), "@v", `${r.version}.zip`));
    const stubbed: string[] = [];
    const stub = (path: string) => {
      if (replaced.has(path) || stubbed.includes(path)) return false;
      const at = join(modDir, ".bobby-stubs", String(stubbed.length));
      mkdirSync(at, { recursive: true });
      writeFileSync(join(at, "go.mod"), `module ${path}\n`);
      stubbed.push(path);
      return true;
    };
    const write = () => writeFileSync(file, `${readFileSync(file, "utf8").replace(/\n\/\/ Bobby: stubbed[\s\S]*$/, "").replace(/\n*$/, "\n")}
// Bobby: stubbed, not in your module cache (the language server never downloads)
${stubbed.map((m, i) => `replace ${m} => ./.bobby-stubs/${i}`).join("\n")}\n`);
    for (const r of req) if (!cached(r)) stub(r.path);
    for (let round = 0; round < 60; round++) { // then what the graph needs beyond them
      if (stubbed.length) write();
      const p = Bun.spawn([e.go, "list", "-m", "all"], { cwd: modDir, env: { ...process.env, ...LOCKED }, stdout: "ignore", stderr: "pipe" });
      const [code, err] = [await p.exited, await new Response(p.stderr).text()];
      if (code === 0) break;
      const need = [...err.matchAll(/(\S+)@\S+: module lookup disabled/g)].map((m) => m[1].replace(/:$/, ""));
      if (!need.length || !need.map(stub).some(Boolean)) break; // something else is wrong: the server reports it
    }
  }
}

export const go: LanguageServer = {
  id: "go",
  title: "Go",
  languageId: (path) => (path.endsWith(".go") ? "go" : null),
  treeFiles: ["*.go", "*go.mod", "*go.sum", "*go.work", "*go.work.sum"],
  prepareTree: stubMissingModules,
  async missing() {
    const e = await goEnv(true);
    if (!e) return { hint: "Go types need Go and gopls on this machine. Until then, Go names are found through imports." };
    if (!e.gopls) return { hint: "Go types need gopls. Install it, then check again:", command: INSTALL };
    return null;
  },
  async installed() { return !!(await goEnv())?.gopls; },
  async version() {
    const e = await goEnv();
    const p = Bun.spawn([e!.gopls!, "version"], { stdout: "pipe", stderr: "ignore", env: { ...process.env, ...LOCKED } });
    const v = /gopls\s+(v\S+)/.exec(await new Response(p.stdout).text())?.[1] ?? "unknown";
    await p.exited;
    return `gopls-${v}`;
  },
  async command() {
    const e = (await goEnv())!;
    return {
      cmd: [e.gopls!, "serve"],
      env: { ...LOCKED, PATH: `${join(e.go, "..")}${process.platform === "win32" ? ";" : ":"}${process.env.PATH ?? ""}` }, // its go, first
      init: { "build.directoryFilters": ["-**/node_modules", "-**/.git"], "ui.diagnostic.analyses": {} },
    };
  },
  folders(root) {
    if (Bun.file(join(root, "go.work")).size > 0) return [root];
    const mods = dirsWith(root, "go.mod");
    return mods.length ? mods : [root];
  },
  outside(p) {
    const e = Bun.peek(env ?? Promise.resolve(null));
    const g = e && typeof e === "object" && "GOROOT" in e ? (e as GoEnv) : null;
    if (g?.GOROOT && !relative(join(g.GOROOT, "src"), p).startsWith("..")) return "Go's standard library";
    const path = p.split(sep).join("/");
    const m = /\/pkg\/mod\/(.+?)@v[^/]*\//.exec(path)?.[1];
    return m ? m.replace(/!([a-z])/g, (_, c: string) => c.toUpperCase()) : null; // the module cache escapes capitals as !x
  },
  importedPackage(line, root) {
    const pkg = /^\s*(?:import\s+)?(?:[\w.]+\s+)?"([^"]+)"\s*(?:\/\/.*)?$/.exec(line)?.[1];
    if (!pkg) return null;
    return modulesUnder(root).some((m) => pkg === m || pkg.startsWith(`${m}/`)) ? "" : pkg;
  },
};
