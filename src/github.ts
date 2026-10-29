// Setting up GitHub's CLI, gh, which Bobby reads PRs and posts reviews through. The page offers it the first time Bobby
// runs without it (installed and signed in), as it does Claude Code (claude.ts). Installing downloads gh from GitHub's
// releases into ~/.local/bin, checked against its checksums, so it needs no sudo or package manager. Signing in runs
// `gh auth login --web`: it gives a one-time code, you enter it at github.com/login/device, and gh notices on its own,
// so it works on a remote machine too. (Signing in with Bobby's own GitHub app may come later.)
import { chmodSync, copyFileSync, existsSync, mkdirSync, mkdtempSync, readdirSync, rmSync } from "node:fs";
import { homedir, tmpdir } from "node:os";
import { join } from "node:path";
import type { Subprocess } from "bun";
import { run } from "./git.ts";

const WINDOWS = process.platform === "win32";
const LOCAL_BIN = join(homedir(), ".local", "bin");

/** The gh to run: on PATH, else where Bobby installs it (~/.local/bin may not be on PATH). */
export function ghBin(): string | null {
  const onPath = Bun.which("gh");
  if (onPath) return onPath;
  const local = join(LOCAL_BIN, WINDOWS ? "gh.exe" : "gh");
  return existsSync(local) ? local : null;
}

export interface GhStatus {
  installed: boolean; version?: string;
  loggedIn: boolean; login?: string; // the GitHub account it's signed in as
  step: "idle" | "installing" | "login"; // what the setup is doing now
  code?: string; url?: string; // the one-time code to enter, and where, while signing in
  error?: string; // why the last step failed
  log?: string; // the install's progress, while it runs
  dismissed?: boolean; // "not now", for this run of Bobby
}

const job: { step: GhStatus["step"]; code?: string; url?: string; error?: string; log: string[]; dismissed?: boolean;
  login?: Subprocess<"ignore", "pipe", "pipe"> } = { step: "idle", log: [] };

export async function ghStatus(): Promise<GhStatus> {
  const bin = ghBin();
  const base = { step: job.step, ...(job.step === "login" && job.code ? { code: job.code, url: job.url } : {}), ...(job.error ? { error: job.error } : {}),
    ...(job.step === "installing" ? { log: job.log.slice(-6).join("\n") } : {}), ...(job.dismissed ? { dismissed: true } : {}) };
  if (!bin) return { installed: false, loggedIn: false, ...base };
  if (ready?.bin === bin && Date.now() - ready.at < 60_000) return { ...ready.probe, ...base };
  const probe = await probeGh(bin);
  ready = probe.loggedIn ? { bin, at: Date.now(), probe } : null;
  return { ...probe, ...base };
}
// A signed-in gh is taken as still signed in for a minute: the home page and every review's start ask, and auth status
// checks the token with GitHub. One that isn't is asked afresh each time, so the setup page sees signing in land.
let ready: { bin: string; at: number; probe: Awaited<ReturnType<typeof probeGh>> } | null = null;
async function probeGh(bin: string) {
  const auth = Bun.spawn([bin, "auth", "status", "--hostname", "github.com"], { stdin: "ignore", stdout: "pipe", stderr: "pipe" });
  const slow = setTimeout(() => auth.kill(), 15_000); // it checks the token with GitHub: offline, it's not signed in
  const [version, out, err] = await Promise.all([
    run([bin, "--version"], { allowFail: true, timeoutMs: 15_000 }),
    new Response(auth.stdout).text(), new Response(auth.stderr).text(), auth.exited,
  ]).finally(() => clearTimeout(slow));
  // "Logged in to github.com account octocat", or an older gh's "… as octocat"; a GH_TOKEN counts too
  const login = /Logged in to \S+ (?:account|as) (\S+)/.exec(out + err)?.[1];
  return { installed: true, version: /\d+\.\d+\.\d+/.exec(version)?.[0], loggedIn: auth.exitCode === 0, ...(login ? { login } : {}) };
}

/** Downloads gh's latest release for this machine into ~/.local/bin, in the background; ghStatus says how it's going. */
export function installGh() {
  if (job.step !== "idle") return;
  Object.assign(job, { step: "installing", error: undefined, log: [] });
  const say = (m: string) => { job.log.push(m); };
  void (async () => {
    const tmp = mkdtempSync(join(tmpdir(), "bobby-gh-"));
    try {
      const os = { darwin: "macOS", linux: "linux", win32: "windows" }[process.platform as string];
      const arch = { x64: "amd64", arm64: "arm64" }[process.arch as string];
      if (!os || !arch) throw new Error(`there's no gh build for ${process.platform} ${process.arch}`);
      say("Asking GitHub for gh's latest release…");
      const rel = (await (await fetch("https://api.github.com/repos/cli/cli/releases/latest", { headers: { accept: "application/vnd.github+json" } })).json()) as { tag_name?: string; message?: string; assets?: { name: string; browser_download_url: string }[] };
      const version = rel.tag_name?.replace(/^v/, "");
      if (!version) throw new Error(`GitHub didn't say (${rel.message ?? "no release"})`);
      const name = `gh_${version}_${os}_${arch}.${os === "linux" ? "tar.gz" : "zip"}`;
      const asset = rel.assets?.find((a) => a.name === name), sums = rel.assets?.find((a) => a.name === `gh_${version}_checksums.txt`);
      if (!asset || !sums) throw new Error(`gh ${version} has no ${name}`);
      say(`Downloading gh ${version} (${os} ${arch})…`);
      const get = async (u: string) => { const r = await fetch(u); if (!r.ok) throw new Error(`downloading ${u} failed (${r.status})`); return r; };
      const [bytes, sumText] = await Promise.all([get(asset.browser_download_url).then((r) => r.arrayBuffer()), get(sums.browser_download_url).then((r) => r.text())]);
      const want = sumText.split("\n").find((l) => l.trim().endsWith(` ${name}`))?.split(/\s+/)[0];
      const got = new Bun.CryptoHasher("sha256").update(bytes).digest("hex");
      if (!want || want !== got) throw new Error(`${name} doesn't match GitHub's checksum`);
      say("✓ checksum verified");
      const archive = join(tmp, name);
      await Bun.write(archive, bytes);
      await run(["tar", "-xf", archive, "-C", tmp]); // tar reads zips too, on macOS and Windows
      const dir = readdirSync(tmp).find((d) => d.startsWith("gh_") && !d.endsWith(".zip") && !d.endsWith(".tar.gz"));
      const exe = WINDOWS ? "gh.exe" : "gh", from = dir ? join(tmp, dir, "bin", exe) : join(tmp, "bin", exe);
      if (!existsSync(from)) throw new Error(`${name} has no bin/${exe}`);
      mkdirSync(LOCAL_BIN, { recursive: true });
      copyFileSync(from, join(LOCAL_BIN, exe));
      if (!WINDOWS) chmodSync(join(LOCAL_BIN, exe), 0o755);
      say(`✓ gh ${version} installed at ${join(LOCAL_BIN, exe)}`);
    } catch (e) {
      job.error = `Couldn't install gh: ${(e as Error).message}. You can install it yourself: https://cli.github.com`;
    } finally {
      rmSync(tmp, { recursive: true, force: true });
      job.step = "idle";
    }
  })();
}

/** Starts `gh auth login --web` and returns its one-time code. gh then waits for the code to be entered on GitHub, and
 *  ends by itself: ghStatus says signed in, or why not. Its own attempt to open a browser is turned off: on a remote
 *  machine there's none, and here the page opens the link. */
export async function startGhLogin(): Promise<{ code: string; url: string }> {
  const bin = ghBin();
  if (!bin) throw new Error("gh isn't installed yet");
  cancelGhLogin();
  Object.assign(job, { step: "login", code: undefined, url: undefined, error: undefined });
  const p = Bun.spawn([bin, "auth", "login", "--hostname", "github.com", "--git-protocol", "https", "--web"], { stdin: "ignore", stdout: "pipe", stderr: "pipe",
    env: { ...process.env, GH_BROWSER: "true", BROWSER: "true" } });
  job.login = p;
  const dec = new TextDecoder();
  let out = "";
  const read = async (s: ReadableStream<Uint8Array>) => { for await (const c of s) out += dec.decode(c); };
  void read(p.stdout); void read(p.stderr);
  for (let i = 0; i < 100 && !job.code; i++) { // up to 20 s for it to print the code
    const code = /\b([A-Z0-9]{4}-[A-Z0-9]{4})\b/.exec(out)?.[1];
    if (code) Object.assign(job, { code, url: /https:\/\/\S+\/login\/device\b/.exec(out)?.[0] ?? "https://github.com/login/device" });
    else if (p.exitCode !== null) break;
    else await Bun.sleep(200);
  }
  if (!job.code) {
    cancelGhLogin();
    job.error = `gh auth login didn't give a code${out.trim() ? `: ${out.trim().split("\n").at(-1)}` : ""}`;
    throw new Error(job.error);
  }
  void p.exited.then((code) => {
    if (job.login !== p) return; // cancelled, or a newer sign-in
    Object.assign(job, { login: undefined, code: undefined, url: undefined, step: "idle" });
    if (code !== 0) job.error = `GitHub didn't sign you in (${out.trim().split("\n").at(-1) || `gh exited ${code}`}). Get a new code and try again.`;
  });
  return { code: job.code, url: job.url! };
}

export function cancelGhLogin() {
  const p = job.login;
  Object.assign(job, { login: undefined, code: undefined, url: undefined, step: job.step === "installing" ? job.step : "idle" });
  p?.kill();
}
export const dismissGh = () => { job.dismissed = true; };
