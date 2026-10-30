// Whether a newer Bobby is out: GitHub's releases for this repo, at most every few hours. On a stable release only
// stable ones count; on a pre-release (0.1.0-rc5), newer pre-releases too. Off with BOBBY_NO_UPDATE_CHECK=1, or the
// "updates" setting. `bobby update` installs one in place of the running binary.
import { chmodSync, existsSync, mkdtempSync, realpathSync, renameSync, rmSync } from "node:fs";
import { dirname, join } from "node:path";
import pkg from "../package.json" with { type: "json" };
import { run } from "./git.ts";
import { home, loadSettings } from "./state.ts";

export interface Release { version: string; url: string; how?: string }
const REPO = pkg.repository.url.match(/github\.com\/([^/]+\/[^/.]+)/)![1];
const EVERY = 6 * 3_600_000;

/** a < b: -1, equal: 0, a > b: 1. "1.2.3-rc5" is older than "1.2.3"; pre-release parts compare numbers as numbers. */
export function compareVersions(a: string, b: string): number {
  const [ma, pa = ""] = a.replace(/^v/, "").split("-", 2), [mb, pb = ""] = b.replace(/^v/, "").split("-", 2);
  const na = ma.split(".").map(Number), nb = mb.split(".").map(Number);
  for (let i = 0; i < 3; i++) if ((na[i] ?? 0) !== (nb[i] ?? 0)) return (na[i] ?? 0) < (nb[i] ?? 0) ? -1 : 1;
  if (pa === pb) return 0;
  if (!pa || !pb) return pa ? -1 : 1; // a release beats its pre-releases
  return Math.sign(pa.localeCompare(pb, "en", { numeric: true }));
}

export const updateChecksOn = () => !process.env.BOBBY_NO_UPDATE_CHECK && loadSettings().updates !== "off";

/** Bobby's releases on GitHub, newest first: on a stable release only stable ones, on a pre-release pre-releases too. */
async function releases(): Promise<Release[]> {
  const r = await fetch(`https://api.github.com/repos/${REPO}/releases?per_page=30`, { headers: { accept: "application/vnd.github+json" }, signal: AbortSignal.timeout(10_000) });
  if (!r.ok) throw new Error(`GitHub's releases API answered ${r.status}`);
  const pre = pkg.version.includes("-");
  return ((await r.json()) as Array<{ tag_name: string; html_url: string; draft: boolean; prerelease: boolean }>)
    .filter((x) => !x.draft && (pre || !x.prerelease)).map((x) => ({ version: x.tag_name.replace(/^v/, ""), url: x.html_url }))
    .sort((a, b) => compareVersions(b.version, a.version));
}

/** The newest release after this one, or null; asks GitHub only when the last answer is older than maxAge. */
export async function newerRelease(maxAge = EVERY): Promise<Release | null> {
  const cache = Bun.file(join(home(), "cache", "release.json"));
  let latest: Release | null = null;
  if ((await cache.exists()) && Date.now() - cache.lastModified < maxAge) latest = (await cache.json().catch(() => null))?.latest ?? null;
  else {
    latest = (await releases().catch(() => null))?.[0] ?? null;
    if (!latest) return null;
    await Bun.write(cache, JSON.stringify({ latest }));
  }
  return latest && compareVersions(latest.version, pkg.version) > 0 ? { ...latest, how: howToUpdate() } : null;
}

/** A compiled release binary, as opposed to `bun run src/cli.ts` in a checkout. */
export const isBinary = () => /\$bunfs|~BUN/.test(Bun.main);
const howToUpdate = () => (isBinary() ? "bobby update" : "git pull && bun install");

/** The release archive for a platform: bobby-<tag>-<os>-<arch>.tar.gz, or .zip on Windows. */
export function assetName(tag: string, platform: string = process.platform, arch: string = process.arch): string | null {
  const os = { darwin: "darwin", linux: "linux", win32: "windows" }[platform], cpu = { x64: "x64", arm64: "arm64" }[arch];
  if (!os || !cpu || (os === "windows" && cpu !== "x64")) return null;
  return `bobby-${tag}-${os}-${cpu}.${os === "windows" ? "zip" : "tar.gz"}`;
}

/** bobby update [version]: the newest release (or that one) in place of this binary. Downloads it from GitHub's releases,
 *  checks it against the release's SHA256SUMS and that it runs, then swaps it in with a rename, so a Bobby still
 *  running keeps working until it's restarted. */
export async function selfUpdate(want: string | undefined, say: (m: string) => void): Promise<void> {
  if (!isBinary()) throw new Error("this Bobby runs from a checkout of the source: update it with git pull && bun install");
  let tag = want?.replace(/^v/, "");
  if (!tag) {
    say("  Asking GitHub for the newest release…");
    const latest = (await releases())[0];
    if (!latest) throw new Error(`GitHub lists no releases of ${REPO}`);
    if (compareVersions(latest.version, pkg.version) <= 0) { say(`✓ Bobby ${pkg.version} is the newest`); return; }
    tag = latest.version;
  } else if (tag === pkg.version) { say(`✓ Bobby ${pkg.version} is already installed`); return; }
  const name = assetName(tag);
  if (!name) throw new Error(`there's no Bobby build for ${process.platform} ${process.arch}`);
  const target = realpathSync(process.execPath), dir = dirname(target);
  const base = `https://github.com/${REPO}/releases/download/${tag}`;
  say(`  Downloading Bobby ${tag} (${name})…`);
  const get = (u: string) => fetch(u, { signal: AbortSignal.timeout(300_000) });
  const [res, sums] = await Promise.all([get(`${base}/${name}`), get(`${base}/SHA256SUMS`)]);
  if (res.status === 404) throw new Error(`there's no release ${tag} with ${name}: see https://github.com/${REPO}/releases`);
  if (!res.ok) throw new Error(`downloading ${name} failed (${res.status})`);
  const bytes = await res.arrayBuffer();
  if (sums.ok) {
    const sum = (await sums.text()).split("\n").find((l) => l.trim().endsWith(` ${name}`))?.split(/\s+/)[0];
    if (!sum || sum !== new Bun.CryptoHasher("sha256").update(bytes).digest("hex")) throw new Error(`${name} doesn't match the release's SHA256SUMS`);
    say("  ✓ checksum verified");
  } else say("  ! this release has no SHA256SUMS; skipping the checksum");
  const denied = (e: unknown) => ["EACCES", "EPERM"].includes((e as NodeJS.ErrnoException).code ?? "")
    ? new Error(`can't write to ${dir}: run it with the rights to, or reinstall with the install script`) : e;
  let tmp: string;
  try { tmp = mkdtempSync(join(dir, ".bobby-update-")); } // beside the binary, so the swap is a rename on one disk
  catch (e) { throw denied(e); }
  try {
    await Bun.write(join(tmp, name), bytes);
    await run(["tar", "-xf", join(tmp, name), "-C", tmp]); // tar reads zips too, on Windows
    const exe = process.platform === "win32" ? "bobby.exe" : "bobby", fresh = join(tmp, exe);
    if (!existsSync(fresh)) throw new Error(`${name} has no ${exe}`);
    if (process.platform !== "win32") chmodSync(fresh, 0o755);
    if (process.platform === "darwin") await run(["xattr", "-d", "com.apple.quarantine", fresh], { allowFail: true }).catch(() => {});
    const runs = (await run([fresh, "--version"], { allowFail: true, timeoutMs: 30_000 }).catch(() => "")).trim();
    if (runs !== tag) throw new Error(`the downloaded Bobby doesn't run here (it said "${runs || "nothing"}")`);
    if (process.platform === "win32") { rmSync(`${target}.old`, { force: true }); renameSync(target, `${target}.old`); } // Windows won't replace a running .exe, but renames it
    renameSync(fresh, target);
  } catch (e) {
    throw denied(e);
  } finally {
    rmSync(tmp, { recursive: true, force: true });
  }
  say(`✓ Bobby ${tag} installed at ${target} (was ${pkg.version})`);
}

/** The binary a Windows update set aside (it can't be removed while it runs): gone the next time Bobby starts. */
export function tidyUpdate() {
  if (process.platform === "win32" && isBinary()) try { rmSync(`${process.execPath}.old`, { force: true }); } catch { /* another Bobby still runs it */ }
}

/** At start, then every few hours while Bobby runs: found() for each newer release seen. A failed check (offline) is quiet. */
export function watchReleases(found: (r: Release) => void) {
  if (!updateChecksOn()) return;
  let told = "";
  const check = () => newerRelease().then((r) => { if (r && r.version !== told) { told = r.version; found(r); } }, () => {});
  void check();
  setInterval(() => { if (updateChecksOn()) void check(); }, EVERY).unref();
}
