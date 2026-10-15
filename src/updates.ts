// Whether a newer Bobby is out: GitHub's releases for this repo, at most every few hours. On a stable release only
// stable ones count; on a pre-release (0.1.0-rc5), newer pre-releases too. Off with BOBBY_NO_UPDATE_CHECK=1, or the
// "updates" setting.
import { join } from "node:path";
import pkg from "../package.json" with { type: "json" };
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

/** The newest release after this one, or null; asks GitHub only when the last answer is older than maxAge. */
export async function newerRelease(maxAge = EVERY): Promise<Release | null> {
  const cache = Bun.file(join(home(), "cache", "release.json"));
  let latest: Release | null = null;
  if ((await cache.exists()) && Date.now() - cache.lastModified < maxAge) latest = (await cache.json().catch(() => null))?.latest ?? null;
  else {
    const r = await fetch(`https://api.github.com/repos/${REPO}/releases?per_page=30`, { headers: { accept: "application/vnd.github+json" }, signal: AbortSignal.timeout(5000) });
    if (!r.ok) return null;
    const pre = pkg.version.includes("-");
    const all = ((await r.json()) as Array<{ tag_name: string; html_url: string; draft: boolean; prerelease: boolean }>)
      .filter((x) => !x.draft && (pre || !x.prerelease)).map((x) => ({ version: x.tag_name.replace(/^v/, ""), url: x.html_url }));
    latest = all.sort((a, b) => compareVersions(b.version, a.version))[0] ?? null;
    await Bun.write(cache, JSON.stringify({ latest }));
  }
  return latest && compareVersions(latest.version, pkg.version) > 0 ? { ...latest, how: howToUpdate(latest.version) } : null;
}

/** The release binary updates through the install script; a checkout of the source, with git. */
function howToUpdate(version: string) {
  const binary = /\$bunfs|~BUN/.test(Bun.main);
  return binary ? `curl -fsSL https://raw.githubusercontent.com/${REPO}/main/install.sh | BOBBY_VERSION=${version} bash` : "git pull && bun install";
}
/** At start, then every few hours while Bobby runs: found() for each newer release seen. A failed check (offline) is quiet. */
export function watchReleases(found: (r: Release) => void) {
  if (!updateChecksOn()) return;
  let told = "";
  const check = () => newerRelease().then((r) => { if (r && r.version !== told) { told = r.version; found(r); } }, () => {});
  void check();
  setInterval(() => { if (updateChecksOn()) void check(); }, EVERY).unref();
}
