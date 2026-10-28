import { createHash } from "node:crypto";
import type { DiffLine, FileDiff, Hunk } from "./types.ts";

const LOCKFILES = /(^|\/)(package-lock\.json|yarn\.lock|pnpm-lock\.yaml|bun\.lockb?|Cargo\.lock|poetry\.lock|uv\.lock|Pipfile\.lock|Gemfile\.lock|composer\.lock|go\.sum|flake\.lock)$/;
const GENERATED = /(^|\/)(dist|build|vendor|node_modules|__generated__|generated)\/|\.min\.(js|css)$|\.map$|\.snap$|\.pb\.go$|_pb2(_grpc)?\.pyi?$|\.g\.dart$/;

const sha1 = (s: string) => createHash("sha1").update(s).digest("hex").slice(0, 16);

const stripPrefix = (p: string) => p.replace(/^[ab]\//, "");

/** A path as git prints it: as is, or (with a ", \\, a tab or a newline in it) in double quotes with C escapes, bytes
 *  above ASCII as octal when core.quotePath is on. */
export function unquote(p: string): string {
  if (!p.startsWith('"') || !p.endsWith('"') || p.length < 2) return p;
  const bytes: number[] = [], src = p.slice(1, -1);
  const ESC: Record<string, number> = { a: 7, b: 8, t: 9, n: 10, v: 11, f: 12, r: 13, '"': 34, "\\": 92 };
  for (let i = 0; i < src.length; i++) {
    const c = src[i];
    if (c !== "\\") { bytes.push(...new TextEncoder().encode(c)); continue; }
    const o = src.slice(i + 1, i + 4);
    if (/^[0-7]{3}$/.test(o)) { bytes.push(parseInt(o, 8)); i += 3; }
    else { bytes.push(ESC[src[i + 1]] ?? src.charCodeAt(i + 1)); i++; }
  }
  return new TextDecoder().decode(new Uint8Array(bytes));
}
/** The path on a ---/+++ line; git ends one with a space in it with a tab. */
const fileLine = (raw: string) => raw.slice(4).replace(/\t$/, "");
/** The two paths of a "diff --git" line: quoted ones are unambiguous; unquoted, " b/" splits them (the ---/+++ and
 *  rename lines after it say for sure). */
function headerPaths(rest: string): [string, string] {
  const q = rest.match(/^("(?:[^"\\]|\\.)*"|\S+(?: \S+)*?) ("(?:[^"\\]|\\.)*"|b\/.*)$/);
  if (q && (q[1].startsWith('"') || q[2].startsWith('"'))) return [stripPrefix(unquote(q[1])), stripPrefix(unquote(q[2]))];
  const m = rest.match(/^a\/(.*) b\/(.*)$/);
  return [m?.[1] ?? "", m?.[2] ?? ""];
}

export function parseDiff(text: string): FileDiff[] {
  const files: FileDiff[] = [];
  let file: FileDiff | null = null;
  let hunk: Hunk | null = null;
  let o = 0, n = 0;

  const finishHunk = () => {
    if (hunk && file) {
      hunk.hash = sha1(file.path + "\n" + hunk.lines.map((l) => l.t + l.s).join("\n"));
      file.hunks.push(hunk);
    }
    hunk = null;
  };

  for (const raw of text.split("\n")) {
    if (raw.startsWith("diff --git ")) {
      finishHunk();
      const [oldPath, path] = headerPaths(raw.slice(11));
      file = { path, oldPath, status: "modified", binary: false, hunks: [] };
      files.push(file);
      continue;
    }
    if (!file) continue;
    if (!hunk) {
      if (raw.startsWith("new file mode")) file.status = "added";
      else if (raw.startsWith("deleted file mode")) file.status = "deleted";
      else if (raw.startsWith("rename from ")) { file.oldPath = unquote(raw.slice(12)); file.status = "renamed"; }
      else if (raw.startsWith("rename to ")) file.path = unquote(raw.slice(10));
      else if (raw.startsWith("Binary files")) file.binary = true;
      else if (raw.startsWith("--- ") && raw !== "--- /dev/null") file.oldPath = stripPrefix(unquote(fileLine(raw)));
      else if (raw.startsWith("+++ ") && raw !== "+++ /dev/null") file.path = stripPrefix(unquote(fileLine(raw)));
      if (file.status === "deleted" && raw === "+++ /dev/null") file.path = file.oldPath;
    }
    const hm = raw.match(/^@@ -(\d+)(?:,\d+)? \+(\d+)(?:,\d+)? @@ ?(.*)$/);
    if (hm) {
      finishHunk();
      o = Number(hm[1]);
      n = Number(hm[2]);
      hunk = {
        id: "",
        file: file.path, oldFile: file.oldPath, header: raw, ctx: hm[3] ?? "",
        oldStart: o, newStart: n, lines: [], hash: "",
      };
      continue;
    }
    if (!hunk) continue;
    const t = raw[0];
    const s = raw.slice(1);
    let line: DiffLine;
    if (t === "+") line = { t: "+", o: null, n: n++, s };
    else if (t === "-") line = { t: "-", o: o++, n: null, s };
    else if (t === " ") line = { t: " ", o: o++, n: n++, s };
    else continue; // "\ No newline at end of file" or trailing blank
    hunk.lines.push(line);
  }
  finishHunk();

  // A change with no lines to show (a binary file, a pure rename, a mode change, an empty file) still gets a hunk, with
  // none, so it's listed with the low-signal changes instead of missing from the review.
  for (const f of files) {
    if (f.hunks.length) continue;
    f.noise = f.binary ? "binary" : f.status === "renamed" ? "renamed, unchanged" : f.status === "modified" ? "mode change" : "empty file";
    f.hunks.push({ id: "", file: f.path, oldFile: f.oldPath, header: "", ctx: "", oldStart: 0, newStart: 0, lines: [], hash: sha1(`${f.status}\n${f.oldPath}\n${f.path}`), noise: f.noise });
  }

  numberHunks(files);
  classifyNoise(files);
  return files;
}
/** Simple ids in file order; the path is assigned here because rename headers come after "diff --git". */
function numberHunks(files: FileDiff[]) {
  let i = 0;
  for (const f of files) for (const h of f.hunks) { h.id = `h${++i}`; h.file = f.path; h.oldFile = f.oldPath; }
}

/** Moves among a diff's deletions and additions, from a looser rename search (`moved`): each pairs a deleted file
 *  with an added one of the same name, replacing the two with one renamed file where the added one was. */
export function pairMoves(files: FileDiff[], moved: FileDiff[]): FileDiff[] {
  const name = (p: string) => p.slice(p.lastIndexOf("/") + 1);
  const status = new Map(files.map((f) => [f.path, f.status]));
  const pairs = moved.filter((m) => m.status === "renamed" && name(m.oldPath) === name(m.path) && status.get(m.oldPath) === "deleted" && status.get(m.path) === "added");
  if (!pairs.length) return files;
  const gone = new Set(pairs.map((m) => m.oldPath)), into = new Map(pairs.map((m) => [m.path, m]));
  const out = files.filter((f) => !(f.status === "deleted" && gone.has(f.path))).map((f) => (f.status === "added" && into.get(f.path)) || f);
  numberHunks(out);
  return out;
}

function classifyNoise(files: FileDiff[]) {
  for (const f of files) {
    if (LOCKFILES.test(f.path)) f.noise = "lockfile";
    else if (GENERATED.test(f.path)) f.noise = "generated";
    else if (f.binary) f.noise = "binary";
    for (const h of f.hunks) {
      if (f.noise) { h.noise = f.noise; continue; }
      if (isWhitespaceOnly(h)) h.noise = "whitespace only";
    }
    if (!f.noise && f.hunks.length && f.hunks.every((h) => h.noise)) f.noise = "whitespace only";
  }
}

function isWhitespaceOnly(h: Hunk): boolean {
  const norm = (t: string) => h.lines.filter((l) => l.t === t).map((l) => l.s.replace(/\s+/g, "")).filter(Boolean).sort().join("\n");
  const added = norm("+"), removed = norm("-");
  return added === removed && h.lines.some((l) => l.t !== " ");
}

export const changedLines = (h: Hunk) => h.lines.filter((l) => l.t !== " ");
