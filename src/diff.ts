import { createHash } from "node:crypto";
import type { DiffLine, FileDiff, Hunk } from "./types.ts";

const LOCKFILES = /(^|\/)(package-lock\.json|yarn\.lock|pnpm-lock\.yaml|bun\.lockb?|Cargo\.lock|poetry\.lock|uv\.lock|Pipfile\.lock|Gemfile\.lock|composer\.lock|go\.sum|flake\.lock)$/;
const GENERATED = /(^|\/)(dist|build|vendor|node_modules|__generated__|generated)\/|\.min\.(js|css)$|\.map$|\.snap$|\.pb\.go$|_pb2(_grpc)?\.pyi?$|\.g\.dart$/;

const sha1 = (s: string) => createHash("sha1").update(s).digest("hex").slice(0, 16);

const stripPrefix = (p: string) => p.replace(/^[ab]\//, "");

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
      const m = raw.match(/^diff --git a\/(.*) b\/(.*)$/);
      file = { path: m?.[2] ?? "", oldPath: m?.[1] ?? "", status: "modified", binary: false, hunks: [] };
      files.push(file);
      continue;
    }
    if (!file) continue;
    if (!hunk) {
      if (raw.startsWith("new file mode")) file.status = "added";
      else if (raw.startsWith("deleted file mode")) file.status = "deleted";
      else if (raw.startsWith("rename from ")) { file.oldPath = raw.slice(12); file.status = "renamed"; }
      else if (raw.startsWith("rename to ")) file.path = raw.slice(10);
      else if (raw.startsWith("Binary files")) file.binary = true;
      else if (raw.startsWith("--- ") && raw !== "--- /dev/null") file.oldPath = stripPrefix(raw.slice(4));
      else if (raw.startsWith("+++ ") && raw !== "+++ /dev/null") file.path = stripPrefix(raw.slice(4));
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

  // Simple ids in file order; the path is assigned here because rename headers come after "diff --git".
  let i = 0;
  for (const f of files) for (const h of f.hunks) { h.id = `h${++i}`; h.file = f.path; h.oldFile = f.oldPath; }

  classifyNoise(files);
  return files;
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
