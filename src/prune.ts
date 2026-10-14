// Housekeeping: what Bobby keeps under ~/.bobby that nothing will read again. At most once a day, in the background.
// Your reviews' state (marks, drafts, notes) is never pruned, nor are the repos Bobby cloned: `bobby clean` does those.
import { existsSync, lstatSync, readdirSync, readFileSync, rmSync, statSync, utimesSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import type { LanguageServer } from "./langserver.ts";
import { home } from "./state.ts";

const DAY = 86_400_000, STALE = 30 * DAY;
const alive = (pid: number) => { try { process.kill(pid, 0); return true; } catch (e) { return (e as { code?: string }).code === "EPERM"; } };
const ls = (dir: string) => { try { return readdirSync(dir).map((n) => join(dir, n)); } catch { return []; } };
const age = (p: string) => { try { return Date.now() - statSync(p).mtimeMs; } catch { return 0; } };
const rm = (p: string) => { try { rmSync(p, { recursive: true, force: true }); return 1; } catch { return 0; } };
/** A half-made folder or file left by a Bobby that stopped: <name>.<pid>.tmp, its pid gone. */
const orphan = (p: string) => { const m = /\.(\d+)\.tmp$/.exec(p); return !!m && !alive(Number(m[1])); };

export function prune(servers: LanguageServer[], force = false): number {
  const root = home(), mark = join(root, "cache", ".pruned");
  if (!force && existsSync(mark) && age(mark) < DAY) return 0;
  if (!existsSync(join(root, "cache"))) return 0;
  writeFileSync(mark, ""); utimesSync(mark, new Date(), new Date());
  let n = 0;
  // cached graphs, Claude trees and language-server answers for commits not opened in a month; avatars a month old
  for (const f of ls(join(root, "cache"))) if (f !== mark && !f.endsWith("avatars") && age(f) > STALE) n += rm(f);
  for (const f of ls(join(root, "cache", "avatars"))) if (age(f) > STALE) n += rm(f);
  // language servers Bobby installed at another version (a day on, in case an older Bobby still runs one); installs and
  // exports a stopped Bobby left half done
  const current = new Set(servers.map((s) => s.installDir).filter(Boolean));
  for (const d of ls(join(root, "servers"))) if (orphan(d) || (!d.endsWith(".tmp") && !current.has(d.split("/").pop()) && age(d) > DAY)) n += rm(d);
  for (const repo of ls(join(root, "trees"))) for (const t of ls(repo)) if (orphan(t)) n += rm(t);
  // locks of Bobbys no longer running, and unreadable state set aside a month ago
  for (const f of ls(join(root, "state"))) {
    if (f.endsWith(".lock")) { try { if (!alive(JSON.parse(readFileSync(f, "utf8")).pid)) n += rm(f); } catch { n += rm(f); } }
    else if (/\.corrupt-\d+$/.test(f) && age(f) > STALE) n += rm(f);
  }
  return n;
}

/** Bytes under a path, symlinks not followed. */
export function sizeOf(p: string): number {
  let st;
  try { st = lstatSync(p); } catch { return 0; }
  return st.isDirectory() ? ls(p).reduce((n, c) => n + sizeOf(c), 0) : st.size;
}
/** `bobby clean`: the caches and exported trees, other versions of language servers, and with repos, the clones Bobby
 *  made. Never your reviews' state or settings. Returns what it freed, by folder. */
export function clean(servers: LanguageServer[], repos: boolean): Array<[string, number]> {
  const root = home(), out: Array<[string, number]> = [];
  const take = (name: string, path: string) => { if (!existsSync(path)) return; const b = sizeOf(path); if (rm(path)) out.push([name, b]); };
  take("cache", join(root, "cache"));
  take("trees", join(root, "trees"));
  const before = sizeOf(join(root, "servers"));
  const current = new Set(servers.map((s) => s.installDir).filter(Boolean));
  for (const d of ls(join(root, "servers"))) if (d.endsWith(".tmp") ? orphan(d) : !current.has(d.split("/").pop())) rm(d);
  if (before - sizeOf(join(root, "servers")) > 0) out.push(["old language servers", before - sizeOf(join(root, "servers"))]);
  if (repos) take("repos", join(root, "repos"));
  return out;
}
