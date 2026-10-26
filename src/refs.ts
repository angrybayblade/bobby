// References to code in what Claude writes (agent.ts, ask.ts), made real: each one it gives as a Markdown link
// ([label](path#L12-L20), or path#base-L12 for the code before the PR), as `path:12` in backticks, or as a bare
// path:12-20, is checked against the commit's files and lines and rewritten as [label](ref://head/path#L12-L20),
// which the page opens in its code viewer. A short path (index.ts) is completed when one file fits (preferring the
// PR's files). One that doesn't resolve is left as its text: a link always opens real code.
import { fileLines, git } from "./git.ts";
import type { ReviewGraph } from "./graph.ts";

export type Side = "head" | "base";
export interface RefContext {
  files: (side: Side) => Promise<string[]>; // every file at that commit
  lineCount: (side: Side, path: string) => Promise<number>; // 0: no such file
  prFiles: string[]; // the PR's, preferred when a short path fits several
}
interface Ref { path: string; side: Side; start: number; end?: number }

/** What the page needs to open a reference: the canonical link target. */
const target = (r: Ref) => `ref://${r.side}/${r.path.split("/").map(encodeURIComponent).join("/")}#L${r.start}${r.end && r.end > r.start ? `-L${r.end}` : ""}`;

/** A reference as written: path, then :12, :12-20, #L12, #L12-L20 or #base-L12 (an en dash for the range too). */
const REF = /^(?<path>[\w@.$~+\[\]\/-]*[\w\]])(?:(?<base>#base-L)|:L?|#L)(?<start>\d+)(?:\s*[-–]\s*L?(?<end>\d+))?$/;
const parse = (s: string): (Omit<Ref, "side"> & { base: boolean }) | null => {
  const m = REF.exec(s.trim());
  return m ? { path: m.groups!.path.replace(/^\.?\//, ""), base: !!m.groups!.base, start: Number(m.groups!.start), ...(m.groups!.end ? { end: Number(m.groups!.end) } : {}) } : null;
};
/** Looks like a file, not a time (12:30) or a host:port: has a slash or an extension. */
const fileish = (p: string) => /\//.test(p) || /\.[A-Za-z]\w{0,9}$/.test(p);

/** Resolves a parsed reference: its full path (completed from a short one), its side, and lines that exist. */
async function resolve(ctx: RefContext, r: Omit<Ref, "side"> & { base: boolean }): Promise<Ref | null> {
  const find = async (side: Side) => {
    const files = await ctx.files(side);
    if (files.includes(r.path)) return r.path;
    const fits = files.filter((f) => f.endsWith(`/${r.path}`));
    if (fits.length === 1) return fits[0];
    const inPr = fits.filter((f) => ctx.prFiles.includes(f));
    return inPr.length === 1 ? inPr[0] : null;
  };
  let side: Side = r.base ? "base" : "head";
  let path = await find(side);
  if (!path && !r.base) { path = await find("base"); side = "base"; } // a file the PR deletes
  if (!path) return null;
  const n = await ctx.lineCount(side, path);
  if (r.start < 1 || r.start > n) return null;
  return { path, side, start: r.start, ...(r.end && r.end > r.start ? { end: Math.min(r.end, n) } : {}) };
}

/** Rewrites the references in Markdown text as ref:// links; code blocks are left alone. */
export async function resolveRefs(text: string, ctx: RefContext): Promise<string> {
  const parts = text.split(/(```[\s\S]*?```)/g); // odd ones: fenced code
  for (let i = 0; i < parts.length; i += 2) parts[i] = await inline(parts[i], ctx);
  return parts.join("");
}
async function inline(text: string, ctx: RefContext): Promise<string> {
  // tokens: a Markdown link, an inline code span, or plain text between them
  const out: string[] = [];
  const re = /\[([^\]\n]+)\]\(([^)\s]+)\)|`([^`\n]+)`/g;
  let at = 0, m: RegExpExecArray | null;
  while ((m = re.exec(text))) {
    out.push(await bare(text.slice(at, m.index), ctx));
    at = re.lastIndex;
    if (m[1] !== undefined) { // a link: one to code is resolved; one to the web is kept
      if (/^(https?|ref):/.test(m[2])) { out.push(m[0]); continue; }
      const p = parse(decodeURI(m[2])), r = p && (await resolve(ctx, p));
      out.push(r ? `[${m[1]}](${target(r)})` : m[1]);
      continue;
    }
    const p = parse(m[3]), r = p && fileish(p.path) && (await resolve(ctx, p)); // `path:12`
    out.push(r ? `[${m[0]}](${target(r)})` : m[0]);
  }
  out.push(await bare(text.slice(at), ctx));
  return out.join("");
}
/** path:12 in running text. */
async function bare(text: string, ctx: RefContext): Promise<string> {
  const re = /(?<![\w/@.\[-])([\w@.$~+\[\]\/-]*[\w\]](?::|#L)\d+(?:\s?[-–]\s?L?\d+)?)(?![\w])/g;
  let out = "", at = 0, m: RegExpExecArray | null;
  while ((m = re.exec(text))) {
    const p = parse(m[1]), r = p && fileish(p.path) && (await resolve(ctx, p));
    out += text.slice(at, m.index) + (r ? `[${m[1]}](${target(r)})` : m[1]);
    at = re.lastIndex;
  }
  return out + text.slice(at);
}

/** The context for a review: the files at its head and base commits, read from the clone and cached here. */
export function refContext(cwd: string, g: ReviewGraph): RefContext {
  const lists = new Map<Side, Promise<string[]>>();
  const sha = (side: Side) => (side === "base" ? g.pr.baseSha : g.pr.headSha);
  return {
    files: (side) => {
      if (!lists.has(side)) lists.set(side, git(cwd, ["ls-tree", "-r", "--name-only", sha(side)], true).then((t) => t.split("\n").filter(Boolean)));
      return lists.get(side)!;
    },
    lineCount: async (side, path) => {
      const lines = await fileLines(cwd, sha(side), path).catch(() => []);
      return lines.length > 1 || lines[0] ? lines.length - (lines.at(-1) === "" ? 1 : 0) : 0;
    },
    prFiles: g.files.map((f) => f.path),
  };
}

/** For a comment posted to GitHub: each ref:// link as a link to those lines on GitHub (or, with no PR, the path and
 *  lines as text). */
export function refsForGitHub(text: string, pr: ReviewGraph["pr"]): string {
  return text.replace(/\[([^\]\n]+)\]\(ref:\/\/(head|base)\/([^#)\s]+)#L(\d+)(?:-L(\d+))?\)/g, (_, label, side, enc, a, b) =>
    pr.provider === "local" ? label : `[${label}](https://github.com/${pr.owner}/${pr.repo}/blob/${side === "base" ? pr.baseSha : pr.headSha}/${enc}#L${a}${b ? `-L${b}` : ""})`);
}
