// A node, laid out top to bottom: title, why it matters, the comments on it, then its code.
// Views show it as the level-2 page, or as the body of the focused card (no title block).
import { BAND_TEXT, DONE, LOW, api, esc } from "./core.js";
import { MOD } from "./palette.js";
import { keyHtml } from "./keys.js";

const EXT = {
  ts: "typescript", tsx: "typescript", mts: "typescript", cts: "typescript", js: "javascript", jsx: "javascript", mjs: "javascript", cjs: "javascript",
  py: "python", go: "go", rs: "rust", java: "java", kt: "kotlin", rb: "ruby", php: "php", cs: "csharp", c: "c", h: "c",
  cc: "cpp", cpp: "cpp", hpp: "cpp", swift: "swift", scala: "scala", sh: "bash", bash: "bash", zsh: "bash", yml: "yaml",
  yaml: "yaml", json: "json", md: "markdown", css: "css", scss: "scss", html: "xml", xml: "xml", vue: "xml", sql: "sql",
  toml: "ini", lua: "lua", ex: "elixir", exs: "elixir", dart: "dart",
};
const langOf = (path) => {
  const base = path.split("/").pop().toLowerCase();
  return base === "dockerfile" ? "dockerfile" : EXT[base.split(".").pop()];
};

// Highlight a whole block (so multi-line comments/strings colour correctly), then split per line.
function hlBlock(lines, lang) {
  if (!lang || !window.hljs?.getLanguage(lang)) return lines.map(esc);
  let html;
  try { html = hljs.highlight(lines.join("\n"), { language: lang, ignoreIllegals: true }).value; } catch { return lines.map(esc); }
  const out = [], open = [];
  let cur = "";
  for (const m of html.matchAll(/(<span[^>]*>)|(<\/span>)|(\n)|([^<\n]+|<)/g)) {
    if (m[1]) { open.push(m[1]); cur += m[1]; }
    else if (m[2]) { open.pop(); cur += m[2]; }
    else if (m[3]) { out.push(cur + "</span>".repeat(open.length)); cur = open.join(""); }
    else cur += m[4];
  }
  out.push(cur + "</span>".repeat(open.length));
  return out;
}

// ---- word-level diff: pair removed/added runs line by line, LCS over tokens.
const tok = (s) => s.match(/\w+|\s+|[^\w\s]/g) ?? [];
function changedRanges(a, b) {
  const A = tok(a), B = tok(b);
  if (A.length * B.length > 40000) return [[[0, a.length]], [[0, b.length]]];
  const dp = Array.from({ length: A.length + 1 }, () => new Uint16Array(B.length + 1));
  for (let i = A.length - 1; i >= 0; i--) for (let j = B.length - 1; j >= 0; j--)
    dp[i][j] = A[i] === B[j] ? dp[i + 1][j + 1] + 1 : Math.max(dp[i + 1][j], dp[i][j + 1]);
  const ra = [], rb = [];
  let i = 0, j = 0, pa = 0, pb = 0;
  const push = (r, s, e) => { if (e > s) { const last = r[r.length - 1]; last && last[1] === s ? (last[1] = e) : r.push([s, e]); } };
  while (i < A.length || j < B.length) {
    if (i < A.length && j < B.length && A[i] === B[j]) { pa += A[i++].length; pb += B[j++].length; }
    else if (j < B.length && (i === A.length || dp[i][j + 1] >= dp[i + 1][j])) { push(rb, pb, pb + B[j].length); pb += B[j++].length; }
    else { push(ra, pa, pa + A[i].length); pa += A[i++].length; }
  }
  return [ra, rb];
}
function wordRanges(lines) {
  const ranges = new Array(lines.length).fill(null);
  for (let i = 0; i < lines.length;) {
    if (lines[i].t !== "-") { i++; continue; }
    const ds = i; while (i < lines.length && lines[i].t === "-") i++;
    const as = i; while (i < lines.length && lines[i].t === "+") i++;
    const pairs = Math.min(as - ds, i - as);
    for (let k = 0; k < pairs; k++) {
      const [rd, ra] = changedRanges(lines[ds + k].s, lines[as + k].s);
      const tiny = (r, s) => r.reduce((n, [x, y]) => n + y - x, 0) < s.length * 0.7; // whole-line changes read better without marks
      if (tiny(rd, lines[ds + k].s)) ranges[ds + k] = rd;
      if (tiny(ra, lines[as + k].s)) ranges[as + k] = ra;
    }
  }
  return ranges;
}
// Wrap text ranges of an HTML string in <mark>, re-opening across tag boundaries.
function applyRanges(html, ranges, cls) {
  if (!ranges?.length) return html;
  let out = "", pos = 0, ri = 0, on = false;
  for (const m of html.matchAll(/(<[^>]+>)|(&[#\w]+;)|([^<&])/g)) {
    if (m[1]) { out += on ? `</mark>${m[1]}<mark class="${cls}">` : m[1]; continue; }
    while (ri < ranges.length && pos >= ranges[ri][1]) ri++;
    const want = ri < ranges.length && pos >= ranges[ri][0];
    if (want && !on) { out += `<mark class="${cls}">`; on = true; }
    if (!want && on) { out += "</mark>"; on = false; }
    out += m[0];
    pos++;
  }
  return on ? out + "</mark>" : out;
}

const hunkCache = new Map();
function hunkHtml(h) {
  if (hunkCache.has(h.hash)) return hunkCache.get(h.hash);
  const lang = langOf(h.file);
  const nw = hlBlock(h.lines.filter((l) => l.t !== "-").map((l) => l.s), lang);
  const od = hlBlock(h.lines.filter((l) => l.t !== "+").map((l) => l.s), lang);
  const words = wordRanges(h.lines);
  let ni = 0, oi = 0;
  const html = h.lines.map((l, i) => {
    const raw = l.t === "-" ? od[oi++] : l.t === "+" ? nw[ni++] : (oi++, nw[ni++]);
    return applyRanges(raw, words[i], l.t === "+" ? "wa" : "wd");
  });
  hunkCache.set(h.hash, html);
  return html;
}

// ---- files for context expansion
const files = new Map();
function fileLines(app, path, rerender) {
  if (!app.caps.files) return null;
  const f = files.get(path);
  if (f === undefined) {
    files.set(path, "loading");
    api(`/api/file?path=${encodeURIComponent(path)}`).then((r) => { files.set(path, r.lines ?? []); rerender(); });
    return null;
  }
  return f === "loading" ? null : f;
}

// ---- rendering
function row(app, { t, o, n }, html, target, half) {
  const side = t === "-" ? "LEFT" : "RIGHT";
  const line = t === "-" ? o : n;
  const key = `${target.path}|${side}|${line}`;
  const cls = t === "+" ? "add" : t === "-" ? "del" : t === "x" ? "exp" : "ctx";
  const mirror = half === "L" && t !== "-"; // the left copy of an unchanged line in split view: the right copy carries its marks
  const at = (c) => c.path === target.path && c.side === side && c.line === line;
  const count = mirror ? 0 : app.state.comments.filter(at).length + (app.graph.discussion ?? []).filter(at).length + app.state.notes.filter(at).length;
  const nums = half === "L" ? `<span class="no">${o ?? ""}</span>` : half === "R" ? `<span class="no">${n ?? ""}</span>` : `<span class="no">${o ?? ""}</span><span class="no">${n ?? ""}</span>`;
  const composing = !half && app.page.composing?.key === key;
  const sel = !mirror && (app.page.selKeys ? app.page.selKeys.has(key) : app.page.sel?.key === key);
  return `<div class="ln ${cls}${count ? " hasc" : ""}${sel ? " sel" : ""}${!mirror && target.hi === n && t !== "-" ? " target" : ""}" data-key="${esc(key)}" data-path="${esc(target.path)}" data-line="${line}" data-side="${side}" data-indiff="${target.inDiff && t !== "x" ? 1 : 0}">
    <span class="bar"></span>${nums}<span class="sg">${t === "+" ? "+" : t === "-" ? "−" : ""}</span><code${count ? ` data-cn="${count}"` : ""}>${html}</code></div>`
    + (composing ? composer(app.page.composing) : "");
}
/** Diff lines as rows: one column (inline), or old beside new (split), pairing each run of removals with the additions after it. */
function diffRows(app, lines, html, target) {
  if (app.layoutOf(target.path) !== "split") return lines.map((l, i) => row(app, l, html[i], target)).join("");
  const pair = (L, R) => {
    const cell = (i, half) => i == null ? `<div class="ln none"></div>` : row(app, lines[i], html[i], target, half);
    const c = app.page.composing;
    const composing = c && [L, R].some((i) => i != null && c.key === `${target.path}|${lines[i].t === "-" ? "LEFT" : "RIGHT"}|${lines[i].t === "-" ? lines[i].o : lines[i].n}`);
    return `<div class="srow">${cell(L, "L")}${cell(R, "R")}</div>${composing ? composer(c) : ""}`;
  };
  let out = "";
  for (let i = 0; i < lines.length;) {
    if (lines[i].t !== "-" && lines[i].t !== "+") { out += pair(i, i); i++; continue; }
    const d = [], a = [];
    while (i < lines.length && lines[i].t === "-") d.push(i++);
    while (i < lines.length && lines[i].t === "+") a.push(i++);
    for (let k = 0; k < Math.max(d.length, a.length); k++) out += pair(d[k], a[k]);
  }
  return out;
}
// A line can take a GitHub draft or a private note; c.file composes a note on a whole file (notes only).
function composer(c) {
  const note = c.kind === "note";
  const lines = c.start && !c.file ? `<div class="crange">${note ? "Note" : "Comment"} on ${rangeLabel({ side: c.side, line: c.line, startLine: Number(c.start.line), startSide: c.start.side })}</div>` : "";
  const kinds = c.file ? "" : `<div class="ckind" role="group" aria-label="Kind">${[["comment", "GitHub draft"], ["note", "Private note"]].map(([k, t]) =>
    `<button data-ckind="${k}" aria-pressed="${c.kind === k}">${t}</button>`).join("")}</div>`;
  const hint = note ? "A private note: only you see it, and it's never posted to GitHub." : "Draft a comment for your GitHub review.";
  return `<div class="cmt${note ? " private" : ""}">${kinds}${lines}<textarea data-composer placeholder="${hint}  ⌘/Ctrl+Enter to save · Esc to cancel">${esc(c.text ?? "")}</textarea></div>`;
}

// ---- selecting lines: click one, shift-click (or drag down the line numbers) for a range, like GitHub's diff.
/** Selects the lines from the anchor row to `end` (same file; in split view, the end's side unless the ends differ). */
function selectRange(app, el, anchor, end) {
  const rows = [...el.querySelectorAll(".ln[data-key]")];
  let i = rows.findIndex((r) => r.dataset.key === anchor?.key && r.dataset.path === end.path), j = rows.findIndex((r) => r.dataset.key === end.key);
  if (j < 0) return;
  if (i < 0) i = j;
  if (i > j) [i, j] = [j, i];
  const a = rows[i].dataset, b = rows[j].dataset;
  const keys = new Set(rows.slice(i, j + 1).filter((r) => r.dataset.path === b.path && (a.side !== b.side || r.dataset.side === b.side)).map((r) => r.dataset.key));
  app.page.sel = { ...b, ...(i < j && a.key !== b.key ? { start: { line: a.line, side: a.side, key: a.key, indiff: a.indiff } } : {}) };
  app.page.selKeys = keys;
  for (const r of el.querySelectorAll(".ln[data-key]")) r.classList.toggle("sel", keys.has(r.dataset.key));
  syncPop(app, el);
}
const ICON_COMMENT = `<svg viewBox="0 0 16 16" width="14" height="14" aria-hidden="true"><path fill="currentColor" d="M1.75 1h12.5c.97 0 1.75.78 1.75 1.75v8.5A1.75 1.75 0 0 1 14.25 13H8.06l-2.57 2.57A1.46 1.46 0 0 1 3 14.54V13H1.75A1.75 1.75 0 0 1 0 11.25v-8.5C0 1.78.78 1 1.75 1ZM1.5 2.75v8.5c0 .14.11.25.25.25h2a.75.75 0 0 1 .75.75v2.19l2.72-2.72a.75.75 0 0 1 .53-.22h6.5a.25.25 0 0 0 .25-.25v-8.5a.25.25 0 0 0-.25-.25H1.75a.25.25 0 0 0-.25.25Z"/></svg>`;
const ICON_NOTE = `<svg viewBox="0 0 16 16" width="14" height="14" aria-hidden="true"><path fill="currentColor" d="M11.01 1.01a1.75 1.75 0 0 1 2.47 0l1.51 1.51c.68.68.68 1.79 0 2.47l-8.4 8.4c-.2.2-.46.35-.74.42l-3.43.86a.75.75 0 0 1-.91-.91l.86-3.43c.07-.28.21-.53.42-.74Zm1.41 1.06a.25.25 0 0 0-.35 0l-1.1 1.1 1.86 1.86 1.1-1.1a.25.25 0 0 0 0-.35ZM11.77 6.59 9.91 4.73 3.34 11.3a.25.25 0 0 0-.06.11l-.55 2.2 2.2-.55a.25.25 0 0 0 .11-.06Z"/></svg>`;
/** The popover on a selection: comment on it (a GitHub draft) or keep a private note. Sits on the selection's last
 *  line, at the right of its code box, and goes away while a composer is open. */
function syncPop(app, el) {
  el.querySelectorAll(".selpop").forEach((p) => p.remove());
  const sel = app.page.sel;
  if (!sel || app.page.composing) return;
  const rows = [...el.querySelectorAll(`.ln[data-key="${CSS.escape(sel.key)}"]`)].filter((r) => r.classList.contains("sel"));
  const row = rows.at(-1), box = row?.closest(".code");
  if (!row || !box) return;
  const n = app.page.selKeys?.size ?? 1;
  const pop = document.createElement("div");
  pop.className = "selpop";
  const lines = n > 1 ? ` on ${n} lines` : "";
  pop.innerHTML = `<button data-compose="comment" aria-label="Comment${lines}" title="Comment${lines}: a draft for your GitHub review (c)">${ICON_COMMENT}</button><button data-compose="note" aria-label="Private note${lines}" title="Private note${lines}: only you see it, never posted (m)">${ICON_NOTE}</button>`;
  box.appendChild(pop);
  let top = 0; // in the code box's own layout: on-screen measures are scaled by the canvas's zoom
  for (let n = row; n && n !== box; n = n.offsetParent) top += n.offsetTop;
  const below = top + row.offsetHeight + 2;
  pop.style.top = `${below + pop.offsetHeight <= box.clientHeight ? below : Math.max(0, top - pop.offsetHeight - 2)}px`; // above the line when it's the box's last
}
/** Esc on the code, innermost first: an open composer closes (its text kept as an unfinished draft), then a line
 *  selection clears. Returns whether it did either. */
export function escapeCode(app) {
  if (app.page.peek) { // a peek is innermost: back a step, then closed
    if (app.page.peek.stack.length > 1) app.page.peek.stack.pop(); else app.page.peek = null;
    drawPeek(app);
    return true;
  }
  const ta = document.querySelector("textarea[data-composer]");
  if (app.page.composing && ta) { closeComposer(app, ta); return true; }
  if (app.page.sel && document.querySelector(".ln.sel")) {
    app.page.sel = app.page.selKeys = app.page.anchor = null;
    document.querySelectorAll(".ln.sel").forEach((r) => r.classList.remove("sel"));
    document.querySelectorAll(".selpop").forEach((p) => p.remove());
    return true;
  }
  return false;
}
const owner = (node) => { for (let n = node; n; n = n.parentElement) if (bound.has(n)) return n; return null; };
/** Closes the composer. Anything written in it is kept as an unfinished draft on the same lines, to continue later. */
async function closeComposer(app, ta) {
  const el = owner(ta), c = app.page.composing, text = ta.value.trim();
  app.page.composing = null;
  if (text && c && !c.file) {
    if (c.editing) await dropDraft(app, c.editing);
    const range = c.start ? { startLine: Number(c.start.line), startSide: c.start.side } : {};
    const d = await api("/api/comment", { path: c.path, line: Number(c.line), side: c.side, body: text, inDiff: c.indiff === "1" && (!c.start || c.start.indiff === "1"), wip: true, ...(c.kind === "note" ? { kind: "note" } : {}), ...range });
    app.state.comments.push(d);
    app.emit("comments");
  }
  if (el) bound.get(el)?.();
}
async function dropDraft(app, id) {
  await api(`/api/comment/${id}`, null, "DELETE");
  app.state.comments = app.state.comments.filter((c) => c.id !== id);
}
const rangeLabel = (c) => {
  const old = (s) => (s === "LEFT" ? "old " : "");
  if (!c.startLine || c.startLine === c.line) return `${old(c.side)}L${c.line}`;
  return (c.startSide ?? c.side) === c.side ? `${old(c.side)}L${c.startLine}–L${c.line}` : `${old(c.startSide)}L${c.startLine}–${old(c.side)}L${c.line}`;
};
const jumpKey = (c) => `${c.path}|${c.side}|${c.line}${c.startLine && c.startLine !== c.line ? `|${c.startSide ?? c.side}|${c.startLine}` : ""}`;

// ---- comments: your drafts plus existing GitHub discussion on the lines this node shows.
function spans(app, pid) {
  const node = app.nodeOf(pid);
  if (!node) return [];
  if (node.kind === "context") {
    const { path, line } = node.location, sn = node.snippet, r = app.page.exp[`ctx:${path}:${line}`];
    return [{ path, side: "RIGHT", lo: Math.min(sn.start, r?.start ?? sn.start), hi: Math.max(sn.start + sn.lines.length - 1, r?.end ?? 0) }];
  }
  return app.hunksOf(pid).flatMap((h) => {
    const e = app.page.exp[h.id] ?? { above: 0, below: 0 };
    const nNew = h.lines.filter((l) => l.t !== "-").length, nOld = h.lines.filter((l) => l.t !== "+").length;
    return [
      { path: h.file, side: "RIGHT", lo: h.newStart - e.above, hi: h.newStart + nNew - 1 + e.below },
      { path: h.file, side: "LEFT", lo: h.oldStart, hi: h.oldStart + nOld - 1 },
    ];
  });
}
export function nodeComments(app, pid) {
  const sp = spans(app, pid);
  const hit = (c) => sp.some((s) => s.path === c.path && s.side === c.side && c.line >= s.lo && c.line <= s.hi);
  const notes = app.state.notes.filter((n) => n.line && hit(n)).map((n) => ({ ...n, private: true }));
  return [...(app.graph.discussion ?? []).filter(hit), ...app.state.comments.filter(hit), ...notes]
    .sort((a, b) => a.path.localeCompare(b.path) || a.line - b.line || !!b.url - !!a.url || String(a.createdAt).localeCompare(String(b.createdAt)));
}
// Other reviewers' comments start hidden behind a toggle (settings.prComments), so the code comes first.
function notesHtml(app, pid) {
  const all = nodeComments(app, pid), gh = all.filter((c) => c.url).length;
  const shown = app.settings.prComments === "show" || app.page.open.has(`gh:${pid}`);
  const list = shown ? all : all.filter((c) => !c.url);
  if (!all.length) return "";
  const toggle = gh && app.settings.prComments !== "show"
    ? `<button class="ghtoggle" data-ghshow="${pid}">${shown ? "Hide" : "Show"} ${gh} comment${gh > 1 ? "s" : ""} from the PR</button>` : "";
  if (!list.length) return `<section class="notes">${toggle}</section>`;
  return `<section class="notes"><h4>${list.some((c) => c.private) ? "Comments & notes" : "Comments"} · ${list.length}</h4>${toggle}${list.map((c) => {
    const key = esc(jumpKey(c));
    const where = rangeLabel(c);
    if (c.private) return privateNote(c, where, key);
    if (c.url) {
      const link = /^https:\/\//.test(c.url) ? `<a href="${esc(c.url)}" target="_blank" rel="noopener">${where} ↗</a>` : where;
      return `<div class="note gh${c.replyTo ? " reply" : ""}" data-jump="${key}"><div class="who">@${esc(c.author)} · ${link}</div><div class="body">${esc(c.body)}</div></div>`;
    }
    if (c.wip) return `<div class="note draft wip" data-jump="${key}"><div class="who">You · unfinished ${c.kind === "note" ? "private note" : "comment"} · ${where}<button class="cont" data-wip="${c.id}" title="Open it again to finish">Continue</button><button class="x" data-del="${c.id}" title="Discard">✕</button></div><div class="body">${esc(c.body)}</div></div>`;
    return `<div class="note draft" data-jump="${key}"><div class="who">You · draft · ${where}<button class="x" data-del="${c.id}" title="Delete draft">✕</button></div><div class="body">${esc(c.body)}</div>${c.inDiff ? "" : `<div class="hint">Outside the diff, so this goes into the review summary.</div>`}</div>`;
  }).join("")}</section>`;
}

function privateNote(n, where, key) {
  return `<div class="note mine"${key ? ` data-jump="${key}"` : ""}><div class="who">You · private note${where ? ` · ${where}` : ""}<button class="x" data-delnote="${n.id}" title="Delete note">✕</button></div><div class="body">${esc(n.body)}</div></div>`;
}

// Notes on a whole file, plus the composer while you're writing one.
const pathOf = (node) => (node.kind === "change" ? node.file : node.location.path);
function fileNotesHtml(app, path) {
  const list = app.state.notes.filter((n) => n.path === path && !n.line);
  const c = app.page.composing, writing = c?.key === `file:${path}`;
  if (!list.length && !writing) return "";
  return `<section class="notes fnotes"><h4>Your notes on this file${list.length ? ` · ${list.length}` : ""}</h4>${list.map((n) => privateNote(n, "", "")).join("")}${writing ? composer(c) : ""}</section>`;
}
/** Starts a private note on a whole file shown in el (a renderFile container). */
export function startFileNote(app, el, path) {
  app.page.composing = { key: `file:${path}`, kind: "note", file: true, path };
  bound.get(el)?.();
  el.scrollTop = 0;
  el.querySelector("textarea[data-composer]")?.focus();
}

function fileHead(path, extra = "", stat = "") {
  const dir = path.includes("/") ? path.slice(0, path.lastIndexOf("/") + 1) : "";
  return `<div class="fh"><span>${esc(dir)}<b>${esc(path.split("/").pop())}</b>${extra}</span><span class="ctx"></span>${stat}${layoutBtn(path)}</div>`;
}
/** Switch one file between inline and split; the label names what you'd switch to. */
export const layoutBtn = (path, cls = "lay") => {
  const split = window.bobby?.layoutOf(path) === "split";
  return `<button class="${cls}" data-flayout="${esc(path)}" title="${split ? "Show this file inline" : "Show this file split: old beside new"} (d for every file)">${split ? "Inline" : "Split"}</button>`;
};

// ---- folding: pure additions/removals and untouched snippets start collapsed; a mixed diff is always open.
const statusByGraph = new WeakMap();
function fileStatus(app, path) {
  let m = statusByGraph.get(app.graph);
  if (!m) statusByGraph.set(app.graph, (m = new Map(app.graph.files.map((f) => [f.path, f.status]))));
  return m.get(path);
}
function foldLabel(app, h) {
  let a = 0, d = 0; for (const l of h.lines) l.t === "+" ? a++ : l.t === "-" ? d++ : 0;
  if (a && d) return null;
  const st = fileStatus(app, h.file);
  if (st === "added") return `new file · +${a}`;
  if (st === "deleted") return `deleted file · −${d}`;
  return a ? `${a} line${a > 1 ? "s" : ""} added` : d ? `${d} line${d > 1 ? "s" : ""} removed` : null;
}
const folded = (app, id) => !app.page.open.has(id);
function foldedBox(id, path, label) {
  const dir = path.includes("/") ? path.slice(0, path.lastIndexOf("/") + 1) : "";
  return `<div class="code folded"><button class="fh" data-fold="${esc(id)}"><span>▸ ${esc(dir)}<b>${esc(path.split("/").pop())}</b></span><span class="ctx"></span><span class="st">${esc(label)} · show</span></button></div>`;
}
const hideBtn = (id) => `<button class="fold-t" data-fold="${esc(id)}">hide</button>`;

// opts.whole: inside a whole-file viewer, so nothing folds and the header names lines, not the file.
const lineHead = (label, extra = "", stat = "") => `<div class="fh"><span><b>${esc(label)}</b>${extra}</span><span class="ctx"></span>${stat}</div>`;

function hunkBox(app, h, rerender, opts = {}) {
  const fold = opts.whole ? null : foldLabel(app, h);
  if (fold && folded(app, h.id)) return foldedBox(h.id, h.file, fold);
  const e = app.page.exp[h.id] ?? { above: 0, below: 0 };
  const file = e.above || e.below ? fileLines(app, h.file, rerender) : null;
  const target = { path: h.file, inDiff: true };
  const lastN = h.newStart + h.lines.filter((l) => l.t !== "-").length - 1;
  const lastO = h.oldStart + h.lines.filter((l) => l.t !== "+").length - 1;
  const ctxRows = (from, to, offset) => {
    if (!file || to < from) return "";
    const nums = []; for (let n = from; n <= Math.min(to, file.length); n++) nums.push(n);
    const html = hlBlock(nums.map((n) => file[n - 1] ?? ""), langOf(h.file));
    return diffRows(app, nums.map((n) => ({ t: "x", o: n + offset, n })), html, target);
  };
  const html = hunkHtml(h);
  let a = 0, d = 0; for (const l of h.lines) l.t === "+" ? a++ : l.t === "-" ? d++ : 0;
  const canExpand = app.caps.files;
  const ctx = h.context ? ` <span style="color:var(--faint)">· ${esc(h.context)}</span>` : "";
  const stat = `<span class="st"><span style="color:var(--ok)">+${a}</span> <span style="color:var(--risk)">−${d}</span>${fold ? hideBtn(h.id) : ""}</span>`;
  const head = opts.whole ? lineHead(`L${h.newStart}`, ctx, stat) : fileHead(h.file, ctx, stat);
  return `<div class="code">
    ${head}
    ${canExpand && h.newStart > 1 ? `<button class="more" data-exp="${h.id}:above">⋯ more above</button>` : ""}
    <div class="lines">${ctxRows(Math.max(1, h.newStart - e.above), h.newStart - 1, h.oldStart - h.newStart)}${diffRows(app, h.lines, html, target)}${ctxRows(lastN + 1, lastN + e.below, lastO - lastN)}</div>
    ${canExpand ? `<button class="more" data-exp="${h.id}:below">⋯ more below</button>` : ""}
  </div>`;
}

function contextBox(app, node, rerender, opts = {}) {
  const { path, line } = node.location;
  const key = `ctx:${path}:${line}`;
  const r = app.page.exp[key] ?? { start: Math.max(1, line - 6), end: line + 6 };
  if (!opts.whole && folded(app, key)) return foldedBox(key, `${path}:${line}`, `untouched · ${r.end - r.start + 1} lines`);
  const snip = node.snippet;
  const inSnippet = r.start >= snip.start && r.end < snip.start + snip.lines.length;
  const file = inSnippet ? null : fileLines(app, path, rerender);
  const src = (n) => (file ? file[n - 1] : snip.lines[n - snip.start]);
  const lo = file ? Math.max(1, r.start) : Math.max(r.start, snip.start);
  const hi = file ? Math.min(file.length, r.end) : Math.min(r.end, snip.start + snip.lines.length - 1);
  const nums = []; for (let n = lo; n <= hi; n++) nums.push(n);
  const html = hlBlock(nums.map((n) => src(n) ?? ""), langOf(path));
  const target = { path, inDiff: false, hi: line };
  const canMore = app.caps.files || lo > snip.start || hi < snip.start + snip.lines.length - 1;
  return `<div class="code">
    ${opts.whole
      ? lineHead(`L${line}`, ` <span style="color:var(--faint)">· not changed in this PR</span>`)
      : fileHead(path, `<span style="color:var(--faint)">:${line} · not changed in this PR</span>`, `<span class="st">${hideBtn(key)}</span>`)}
    ${canMore && lo > 1 ? `<button class="more" data-exp="${esc(key)}:above">⋯ more above</button>` : ""}
    <div class="lines">${nums.map((n, i) => row(app, { t: " ", o: null, n }, html[i], target)).join("")}</div>
    ${canMore ? `<button class="more" data-exp="${esc(key)}:below">⋯ more below</button>` : ""}
  </div>`;
}

function lowPage(app) {
  const byFile = new Map();
  for (const h of app.hunksOf(LOW)) (byFile.get(h.file) ?? byFile.set(h.file, []).get(h.file)).push(h);
  const open = app.page.lowOpen ?? new Set();
  return `<div class="band">Low-signal changes</div>
    <h1>Skim, don't read${app.isReviewed(LOW) ? `<span class="badges"><span class="badge done">✓ reviewed</span></span>` : ""}</h1>
    <p class="why">Lockfiles, generated output and whitespace-only edits. Open anything that looks surprising, then press ${keyHtml(app.settings, "reviewed")}.</p>
    ${[...byFile].map(([file, hs]) => {
      let a = 0, d = 0; for (const h of hs) for (const l of h.lines) l.t === "+" ? a++ : l.t === "-" ? d++ : 0;
      return `<div class="code"><button class="fh" style="width:100%;text-align:left" data-low="${esc(file)}"><span><b>${esc(file)}</b> <span style="color:var(--faint)">· ${esc(hs[0].lowSignal)}</span></span><span class="ctx"></span><span class="st">+${a} −${d} · ${open.has(file) ? "hide" : "show"}</span></button>
        ${open.has(file) ? `<div class="lines">${hs.flatMap((h) => h.lines.slice(0, 300).map((l) => row(app, l, esc(l.s), { path: file, inDiff: true }))).join("")}</div>` : ""}</div>`;
    }).join("")}`;
}

function donePage(app) {
  const { done, total } = app.progress();
  const flagged = app.index.walk.filter((p) => p !== DONE && app.isFlagged(p));
  return `<div style="text-align:center;margin-top:12vh">
    <h1 style="font-family:var(--font-ui)">${done === total ? "All reviewed ✓" : "End of the walk"}</h1>
    <p class="why" style="margin:0 auto 24px">${done === total
      ? `${app.state.comments.length} draft comment(s). Press ${keyHtml(app.settings, "submit")} to submit your review.`
      : `${total - done} page(s) still unreviewed. Press ${keyHtml(app.settings, "nextUnreviewed")} to jump to the next one.`}</p>
    ${flagged.length ? `<div class="band" style="justify-content:center;margin-top:30px">Flagged for a second look</div>${flagged.map((p) => `<p><button class="pill" data-go="${p}">${esc(app.get(p)?.pl.title ?? "Low-signal changes")}</button></p>`).join("")}` : ""}
  </div>`;
}

/** head: false renders only comments + code, for a card that already shows the title and why. */
export function renderNode(app, el, pid, { head = true } = {}) {
  const rerender = () => renderNode(app, el, pid, { head });
  bind(app, el, rerender);
  let body;
  if (pid === DONE) body = donePage(app);
  else if (pid === LOW) body = lowPage(app);
  else if (!head) {
    const node = app.nodeOf(pid);
    body = fileNotesHtml(app, pathOf(node)) + notesHtml(app, pid) + (node.kind === "change" ? app.hunksOf(pid).map((h) => hunkBox(app, h, rerender)).join("") : contextBox(app, node, rerender));
  } else {
    const { pl } = app.get(pid);
    const node = app.nodeOf(pid);
    const badges = [
      pl.risk === "high" ? `<span class="badge risk">high risk</span>` : "",
      app.isReviewed(pid) ? `<span class="badge done">✓ reviewed</span>` : "",
      app.isFlagged(pid) ? `<span class="badge flag">⚑ flagged</span>` : "",
    ].join("");
    const glyph = pl.band === "core" ? "core" : node.kind;
    body = `<div class="band"><i class="glyph ${glyph}"></i>${BAND_TEXT[pl.band]}</div>
      <h1>${esc(pl.title)}${badges ? `<span class="badges">${badges}</span>` : ""}</h1>
      <p class="why">${esc(pl.why)}</p>
      ${fileNotesHtml(app, pathOf(node))}
      ${notesHtml(app, pid)}
      ${node.kind === "change" ? app.hunksOf(pid).map((h) => hunkBox(app, h, rerender)).join("") : contextBox(app, node, rerender)}`;
  }
  el.innerHTML = `<div class="node ${head ? "page" : "body"}">${body}</div>`;
  const ta = el.querySelector("textarea[data-composer]");
  if (ta) ta.focus({ preventScroll: !head });
  syncPop(app, el);
}
export const renderPage = (app, el, pid) => renderNode(app, el, pid);

/** A whole file for file-level viewers: one section per node in file order, each with its comments, nothing collapsed. */
export function renderFile(app, el, pids) {
  const rerender = () => renderFile(app, el, pids);
  bind(app, el, rerender);
  const opts = { whole: true };
  const path = pids.length ? pathOf(app.nodeOf(pids[0])) : "";
  el.innerHTML = `<div class="node file">${fileNotesHtml(app, path)}${pids.map((pid) => {
    const { pl } = app.get(pid), node = app.nodeOf(pid), done = app.isReviewed(pid);
    const code = node.kind === "change" ? app.hunksOf(pid).map((h) => hunkBox(app, h, rerender, opts)).join("") : contextBox(app, node, rerender, opts);
    return `<section class="sec ${pid === app.focus ? "cur" : ""} ${done ? "done" : ""}" data-pid="${pid}">
      <div class="sech"><i class="glyph ${pl.band === "core" ? "core" : node.kind}"></i><span>${esc(pl.title)}</span>${pl.risk === "high" ? `<i class="riskdot"></i>` : ""}${app.isFlagged(pid) ? `<span class="status flag">⚑</span>` : ""}<button class="vw" data-viewed="${pid}" title="Mark viewed: tracks your progress here only, not on GitHub"><span class="on"><i class="cb">✓</i>Viewed</span><span class="off"><i class="cb"></i>Viewed</span></button></div>
      ${notesHtml(app, pid)}${code}</section>`;
  }).join("")}</div>`;
  const ta = el.querySelector("textarea[data-composer]");
  if (ta) ta.focus({ preventScroll: true });
  syncPop(app, el);
}

// ---- the inspector: ⌘/ctrl-click a name to see where it's declared (and, with a language server, its type) without
// leaving your place. It opens a window over the app; ⌘/ctrl-click inside it to go deeper, esc to go back a step and
// then close, or ✕ (or a click outside) to close.
/** The name under a click inside a line's code, and its column (UTF-16 units, as the source counts them). */
function wordAt(ev, code) {
  const p = document.caretPositionFromPoint?.(ev.clientX, ev.clientY), r = p ? null : document.caretRangeFromPoint?.(ev.clientX, ev.clientY);
  const node = p?.offsetNode ?? r?.startContainer, off = p?.offset ?? r?.startOffset;
  if (!node || !code.contains(node)) return null;
  let at = 0;
  for (const w = document.createTreeWalker(code, NodeFilter.SHOW_TEXT); w.nextNode();) {
    if (w.currentNode === node) { at += off; break; }
    at += w.currentNode.length;
  }
  const text = code.textContent, isW = (c) => /[\w$]/.test(c ?? "");
  let a = at, b = at;
  if (!isW(text[a]) && isW(text[a - 1])) a = b = at - 1; // just past a word's end
  if (!isW(text[a])) return null;
  while (a > 0 && isW(text[a - 1])) a--;
  while (b < text.length && isW(text[b])) b++;
  const name = text.slice(a, b);
  return /^\d/.test(name) ? null : { name, col: a };
}
async function inspect(app, at, deeper) {
  const entry = { ...at, loading: true };
  if (deeper && app.page.peek) app.page.peek.stack.push(entry); else app.page.peek = { stack: [entry] };
  drawPeek(app);
  const stored = (app.graph.definitions?.[at.path] ?? []).find((d) => d.line === at.line && at.col >= d.col && at.col < d.col + d.len);
  let res = app.caps.inspect ? await api(`/api/inspect?path=${encodeURIComponent(at.path)}&line=${at.line}&col=${at.col}`).catch(() => null) : null;
  if (!res && stored) res = { to: stored.to, ext: stored.ext, via: stored.via ?? "syntax" };
  entry.res = res ?? { via: "none" };
  const srv = res?.server, known = srv && app.servers.find((x) => x.id === srv.id);
  if (known && known.state !== srv.state) { Object.assign(known, srv); app.emit("llm"); } // e.g. its server stopped
  if (entry.res.to) await loadCode(app, entry, entry.res.to.line, Math.min(entry.res.to.end ?? entry.res.to.line + 12, entry.res.to.line + 300)); // the whole declaration: the window scrolls
  entry.loading = false;
  if (app.page.peek?.stack.includes(entry)) drawPeek(app);
}
async function loadCode(app, entry, from, to) {
  if (!app.caps.files) return;
  const r = await api(`/api/file?path=${encodeURIComponent(entry.res.to.path)}`).catch(() => null);
  if (!r?.lines?.length) return;
  entry.start = from; entry.lines = r.lines.slice(from - 1, to); entry.more = (entry.res.to.end ?? 0) > to;
}

// ---- uses: ⌘⇧-click a name to list where it's used, in three groups: in the diff (what you're reviewing), in the PR's
// files but outside the diff, and elsewhere in the codebase. A use in the diff jumps there; any other opens its code here.
const USE_GROUPS = ["In the diff", "In the PR's files, outside the diff", "Elsewhere in the codebase"];
const diffLines = new WeakMap(); // graph → "path:line" of every new-side line its hunks show
function inDiff(app, path, line) {
  let set = diffLines.get(app.graph);
  if (!set) {
    set = new Set(app.graph.hunks.flatMap((h) => h.lines.filter((l) => l.t !== "-" && l.n != null).map((l) => `${h.file}:${l.n}`)));
    diffLines.set(app.graph, set);
  }
  return set.has(`${path}:${line}`);
}
async function uses(app, at, deeper) {
  const entry = { ...at, kind: "uses", loading: true };
  if (deeper && app.page.peek) app.page.peek.stack.push(entry); else app.page.peek = { stack: [entry] };
  drawPeek(app);
  const r = app.caps.inspect ? await api(`/api/references?path=${encodeURIComponent(at.path)}&line=${at.line}&col=${at.col}`).catch(() => null) : null;
  const pr = new Set(app.graph.files.filter((f) => f.status !== "deleted").map((f) => f.path));
  entry.res = r ?? { via: "none", refs: [], total: 0 };
  entry.name = r?.name || at.name;
  entry.list = (r?.refs ?? []).map((u) => ({ ...u, group: inDiff(app, u.path, u.line) ? 0 : pr.has(u.path) ? 1 : 2 }))
    .sort((a, b) => a.group - b.group || (b.path === at.path) - (a.path === at.path) || a.path.localeCompare(b.path) || a.line - b.line); // yours first
  entry.loading = false;
  if (app.page.peek?.stack.includes(entry)) drawPeek(app);
}
const SHOW_ELSEWHERE = 200; // the first two groups always show in full; the third up to this
function usesHtml(app, e) {
  const groups = USE_GROUPS.map(() => []);
  for (const [i, u] of (e.list ?? []).entries()) groups[u.group].push([i, u]);
  const room = Math.max(0, SHOW_ELSEWHERE - groups[0].length - groups[1].length);
  const hidden = Math.max(0, groups[2].length - room) + Math.max(0, (e.res?.total ?? 0) - (e.list?.length ?? 0));
  const counts = groups.map((g) => g.length);
  groups[2] = groups[2].slice(0, room);
  return groups.map((g, gi) => {
    if (!counts[gi]) return "";
    let html = `<div class="ugroup"><div class="uhead">${USE_GROUPS[gi]} <span>${counts[gi]}</span></div>`, file = "", last = 0;
    for (const [i, u] of g) {
      if (u.path !== file) { file = u.path; last = 0; html += `<div class="ufile">${esc(u.path)}</div>`; }
      if (u.line === last) continue; // two uses on one line: one row
      last = u.line;
      html += `<div class="pl urow" data-use="${i}" title="${gi === 0 ? "Go there" : "Open it here"}"><span class="no">${u.line}</span><code>${hlBlock([(u.text ?? "").trim()], langOf(u.path))[0]}</code></div>`;
    }
    return html + (gi === 2 && hidden ? `<div class="pkmore">and ${hidden} more</div>` : "") + `</div>`;
  }).join("");
}
/** A use clicked in the list: in the diff, go there and select its line; anywhere else, its code in the window. */
async function openUse(app, u) {
  const pid = u.group === 0 && app.pidAt(u.path, u.line);
  if (pid) {
    app.page.peek = null;
    drawPeek(app);
    app.setFocus(pid);
    return setTimeout(() => selectLine(app, `${u.path}|RIGHT|${u.line}`), 350); // once the view has moved there
  }
  const entry = { kind: "code", name: `${u.path.split("/").pop()}:${u.line}`, path: u.path, line: u.line, loading: true, res: { to: { path: u.path, line: u.line } } };
  app.page.peek.stack.push(entry);
  drawPeek(app);
  await loadCode(app, entry, Math.max(1, u.line - 8), u.line + 16);
  entry.loading = false;
  if (app.page.peek?.stack.includes(entry)) drawPeek(app);
}
/** Selects a line wherever it's on screen, and scrolls the code it's in (never the canvas) to show it. */
function selectLine(app, key) {
  const row = [...document.querySelectorAll(`.ln[data-key="${CSS.escape(key)}"]`)].find((r) => r.offsetParent);
  const el = row && owner(row);
  if (!el) return;
  app.page.anchor = { ...row.dataset };
  selectRange(app, el, app.page.anchor, { ...row.dataset });
  let sc = row.parentElement;
  while (sc && !(sc.scrollHeight > sc.clientHeight && /auto|scroll/.test(getComputedStyle(sc).overflowY))) sc = sc.parentElement;
  if (!sc) return;
  const k = sc.clientHeight / (sc.getBoundingClientRect().height || 1); // on-screen px to the scroller's own (zoom)
  sc.scrollTo({ top: sc.scrollTop + (row.getBoundingClientRect().top - sc.getBoundingClientRect().top) * k - sc.clientHeight / 3, behavior: "smooth" });
}
const VIA = { lsp: ["types", "Found by the language server"], syntax: ["imports", "Found through imports and the syntax tree, without types"] };
/** The inspector's window: a trail of what you inspected, then where the last one is declared, its type and its code. */
function peekHtml(app) {
  const pk = app.page.peek, e = pk.stack.at(-1), res = e.res, pr = app.graph.pr;
  const trail = pk.stack.map((x, i) => i === pk.stack.length - 1 ? `<code class="pkn">${esc(x.name)}</code>`
    : `<button class="pkcrumb" data-peekto="${i}" title="Back to ${esc(x.name)}">${esc(x.name)}${x.kind === "uses" ? " · uses" : ""}</button><span class="pksep">›</span>`).join("");
  const via = res && VIA[res.via] ? `<span class="pkv" title="${VIA[res.via][1]}">${VIA[res.via][0]}</span>` : "";
  const gh = res?.to && pr.provider !== "local" ? `https://github.com/${pr.owner}/${pr.repo}/blob/${pr.headSha}/${res.to.path}#L${res.to.line}${res.to.end ? `-L${res.to.end}` : ""}` : "";
  if (e.kind === "uses") {
    const n = e.list?.length ?? 0, counts = USE_GROUPS.map((_, g) => (e.list ?? []).filter((u) => u.group === g).length);
    const summary = e.loading ? "looking for its uses…"
      : !n ? `no uses found${res?.pending ? ": types are still loading, try again in a moment" : res?.via === "syntax" ? " through imports (uses through a value need the language server)" : ""}`
      : `${res.total} use${res.total === 1 ? "" : "s"} · ${counts.map((c, g) => `${c} ${["in the diff", "in the PR's files", "elsewhere"][g]}`).join(" · ")}`;
    const head = `<div class="pkh"><div class="pktrail">${trail}<span class="pktag">uses</span></div>${via}<button class="pkx" data-peekclose title="Close · esc" aria-label="Close">✕</button></div><div class="pkw">${summary}</div>`;
    const hint = e.loading || !n ? "" : `<div class="pkhint">Click a use to go there (in the diff) or open it · ${MOD}⇧-click a name for its uses · esc to go back</div>`;
    return `<div class="pkwin" role="dialog" aria-label="Uses of ${esc(e.name)}">${head}<div class="pkbody">${e.loading ? "" : usesHtml(app, e)}</div>${hint}</div>`;
  }
  const where = e.note ? esc(e.note)
    : e.loading ? "looking…"
    : res?.to ? `${esc(res.to.path)}:${res.to.line}${gh ? ` <a href="${esc(gh)}" target="_blank" rel="noopener" title="Open on GitHub">GitHub ↗</a>` : ""}`
    : res?.ext ? `in <b>${esc(res.ext)}</b>, outside this repo`
    : `not found${res?.pending ? ": types are still loading, try again in a moment" : res?.changed ? "" : res?.server && res.server.state !== "done" ? `: locals and members of values need the ${esc(res.server.title)} language server` : ""}`;
  const changed = res?.changed ? `<div class="pkw">This file has changed since the review started, so it's answered from imports alone. Restart Bobby to inspect it with types.</div>` : "";
  const head = `<div class="pkh"><div class="pktrail">${trail}</div>${via}<button class="pkx" data-peekclose title="Close · esc" aria-label="Close">✕</button></div>
    <div class="pkw">${where}</div>${changed}`;
  const types = res?.hover ? hoverHtml(res.hover) : "";
  const code = e.lines ? `<div class="pkc">${hlBlock(e.lines, langOf(res.to.path)).map((h, i) =>
    `<div class="pl${e.start + i === res.to.line ? " at" : ""}" data-path="${esc(res.to.path)}" data-line="${e.start + i}"><span class="no">${e.start + i}</span><code>${h}</code></div>`).join("")}${e.more ? `<div class="pkmore">⋯ ${res.to.end - (e.start + e.lines.length - 1)} more lines</div>` : ""}</div>` : "";
  const hint = e.loading || !e.lines ? "" : `<div class="pkhint">${MOD}-click a name to go deeper · esc to go back</div>`;
  return `<div class="pkwin" role="dialog" aria-label="Inspect ${esc(e.name)}">${head}<div class="pkbody">${types}${code}</div>${hint}</div>`;
}
/** A hover's markdown: its code blocks highlighted, then its prose (doc comment) as one short paragraph. */
function hoverHtml(md) {
  const blocks = [];
  const prose = md.replace(/```(\w*)\n([\s\S]*?)```/g, (_, lang, code) => { blocks.push(`<pre class="pkt">${hlBlock(code.replace(/\n$/, "").split("\n"), lang || "typescript").join("\n")}</pre>`); return "\n"; })
    .replace(/\n{3,}/g, "\n\n").trim().slice(0, 1200);
  const doc = prose ? `<div class="pkd">${esc(prose).replace(/`([^`\n]+)`/g, "<code>$1</code>")}</div>` : "";
  return blocks.join("") + doc;
}
/** The window over the app, or nothing. It lives outside every view, so it's never clipped, zoomed or re-rendered with the code. */
let peekEl = null, downOnBackdrop = false;
export const inspectorOpen = () => !!peekEl;
function drawPeek(app) {
  if (!app.page.peek) { peekEl?.remove(); peekEl = null; return; }
  if (!peekEl) {
    peekEl = document.createElement("div");
    peekEl.className = "inspector";
    peekEl.addEventListener("mousedown", (ev) => { downOnBackdrop = ev.target === peekEl; });
    peekEl.addEventListener("click", (ev) => onPeekClick(app, ev));
    document.body.appendChild(peekEl);
  }
  const keep = peekEl.querySelector(".pkbody")?.dataset.at, at = `${app.page.peek.stack.length}:${app.page.peek.stack.at(-1).loading ? 0 : 1}`;
  const top = keep === at ? peekEl.querySelector(".pkbody").scrollTop : 0;
  peekEl.innerHTML = peekHtml(app);
  const body = peekEl.querySelector(".pkbody");
  body.dataset.at = at;
  body.scrollTop = top;
}
function onPeekClick(app, ev) {
  // ✕, or a click on the dimmed backdrop: pressed there too, so selecting code and letting go outside doesn't close it
  if ((ev.target === peekEl && downOnBackdrop) || ev.target.closest("[data-peekclose]")) { app.page.peek = null; return drawPeek(app); }
  const to = ev.target.closest("[data-peekto]");
  if (to) { app.page.peek.stack.length = Number(to.dataset.peekto) + 1; return drawPeek(app); }
  const use = !(ev.metaKey || ev.ctrlKey) && ev.target.closest("[data-use]");
  if (use) return openUse(app, app.page.peek.stack.at(-1).list[Number(use.dataset.use)]);
  const code = (ev.metaKey || ev.ctrlKey) && ev.target.closest(".pl:not(.urow) code");
  if (!code) return;
  ev.preventDefault();
  const w = wordAt(ev, code), line = code.closest(".pl");
  if (w) (ev.shiftKey ? uses : inspect)(app, { ...w, path: line.dataset.path, line: Number(line.dataset.line) }, true);
}
// Holding ⌘/ctrl shows which code can be inspected.
addEventListener("keydown", (e) => { if (e.key === "Meta" || e.key === "Control") document.body.classList.add("inspecting"); });
for (const ev of ["keyup", "blur"]) addEventListener(ev, () => document.body.classList.remove("inspecting"));

// ---- symbol highlights: hovering a name lights up every use of the same symbol on screen, in any file. Two names
// are one symbol when they're declared at the same place (graph.definitions), so a local and an import that share
// a name stay apart. Painted with the CSS Highlight API: no element is added, so nothing re-renders or reflows.
let symFor, symIndex, hoverApp = null, hoverRaf = 0, lastMove = null, hoverSym = null, hoverRanges = [];
/** The definitions indexed by line (what's under the pointer) and by symbol (where else it's used); rebuilt when the
 *  language server's definitions replace the syntax-only ones. */
function symbols(app) {
  const defs = app.graph.definitions;
  if (symFor === defs) return symIndex;
  const byLine = new Map(), bySym = new Map();
  for (const [path, list] of Object.entries(defs ?? {})) for (const d of list) {
    const sym = d.to ? `${d.to.path}:${d.to.line}:${d.name}` : d.ext ? `${d.ext}:${d.name}` : null; // unplaced: no highlight, not a guess
    if (!sym) continue;
    const at = { path, line: d.line, col: d.col, len: d.len, sym };
    const k = `${path}|RIGHT|${d.line}`;
    (byLine.get(k) ?? byLine.set(k, []).get(k)).push(at);
    (bySym.get(sym) ?? bySym.set(sym, []).get(sym)).push(at);
  }
  symFor = defs; symIndex = { byLine, bySym }; hoverSym = null;
  return symIndex;
}
/** Text from col to col + len inside a line's code, across the highlighter's spans. */
function textRange(code, col, len) {
  let at = 0, r = null;
  for (const w = document.createTreeWalker(code, NodeFilter.SHOW_TEXT); w.nextNode();) {
    const n = w.currentNode, end = at + n.length;
    if (!r && col < end) { r = new Range(); r.setStart(n, col - at); }
    if (r && col + len <= end) { r.setEnd(n, col + len - at); return r; }
    at = end;
  }
  return null;
}
function showSymbol(sym) {
  if (sym === hoverSym && (!sym || hoverRanges[0]?.startContainer.isConnected)) return; // same symbol, still drawn
  hoverSym = sym; hoverRanges = [];
  if (!sym) return CSS.highlights.delete("bobby-sym");
  const uses = symIndex.bySym.get(sym) ?? [], want = new Map();
  for (const u of uses) (want.get(`${u.path}|RIGHT|${u.line}`) ?? want.set(`${u.path}|RIGHT|${u.line}`, []).get(`${u.path}|RIGHT|${u.line}`)).push(u);
  for (const row of document.querySelectorAll(".ln[data-key]")) { // one pass over the rows, whatever the symbol's count
    const list = want.get(row.dataset.key), code = list && row.querySelector("code");
    if (code) for (const u of list) { const r = textRange(code, u.col, u.len); if (r) hoverRanges.push(r); }
  }
  CSS.highlights.set("bobby-sym", new Highlight(...hoverRanges));
}
function hoverTick() {
  hoverRaf = 0;
  const e = lastMove, app = hoverApp;
  if (!app || !e || e.buttons) return showSymbol(null); // dragging the canvas or a selection: nothing to point at
  const code = e.target.closest?.(".ln[data-key] code"), row = code?.closest(".ln");
  const here = row && symbols(app).byLine.get(row.dataset.key);
  if (!here) return showSymbol(null);
  const w = wordAt(e, code);
  showSymbol(w && here.find((u) => w.col >= u.col && w.col < u.col + u.len)?.sym || null);
}
if (window.CSS?.highlights) {
  addEventListener("mousemove", (e) => { lastMove = e; hoverRaf ||= requestAnimationFrame(hoverTick); }, { passive: true });
  document.documentElement.addEventListener("mouseleave", () => showSymbol(null)); // off the page
}

// One delegated listener per container.
const bound = new WeakMap();
function bind(app, el, rerender) {
  bound.set(el, rerender);
  hoverApp = app;
  if (el.dataset.bound) return;
  el.dataset.bound = "1";
  el.addEventListener("click", (ev) => {
    if (ev.target.closest("a")) return;
    const code = (ev.metaKey || ev.ctrlKey) && ev.target.closest(".ln[data-key] code");
    if (code) { // the inspector: where it's declared, or (with shift) where it's used
      ev.preventDefault();
      const w = wordAt(ev, code), line = code.closest(".ln");
      if (!w) return;
      if (line.dataset.side === "LEFT") { // removed code isn't at head, where names are looked up
        app.page.peek = { stack: [{ ...w, note: "Removed lines can't be inspected yet: this code isn't at the PR's head." }] };
        return drawPeek(app);
      }
      return (ev.shiftKey ? uses : inspect)(app, { ...w, path: line.dataset.path, line: Number(line.dataset.line) }, false);
    }
    const t = ev.target.closest("[data-compose],[data-wip],[data-ghshow],[data-ckind],[data-delnote],[data-viewed],[data-exp],[data-del],[data-low],[data-go],[data-jump],[data-fold],.ln[data-key]");
    if (!t || !el.contains(t)) return;
    const again = () => bound.get(el)();
    const ds = t.dataset;
    if (ds.compose) { if (app.page.sel) { app.page.composing = { ...app.page.sel, kind: ds.compose }; app.page.kind = ds.compose; } return again(); }
    if (ds.wip) { // continue an unfinished draft: its lines selected, its text back in the composer
      const d = app.state.comments.find((c) => c.id === ds.wip);
      if (!d) return;
      const key = `${d.path}|${d.side}|${d.line}`, row = el.querySelector(`.ln[data-key="${CSS.escape(key)}"]`);
      app.page.sel = { ...(row?.dataset ?? { key, path: d.path, side: d.side, line: String(d.line), indiff: d.inDiff ? "1" : "0" }), ...(d.startLine ? { start: { line: String(d.startLine), side: d.startSide ?? d.side, key: `${d.path}|${d.startSide ?? d.side}|${d.startLine}`, indiff: d.inDiff ? "1" : "0" } } : {}) };
      app.page.selKeys = null;
      app.page.composing = { ...app.page.sel, kind: d.kind === "note" ? "note" : "comment", text: d.body, editing: d.id };
      return again();
    }
    if (ds.ckind) { // switch the composer between a GitHub draft and a private note, keeping the text
      app.page.composing.text = el.querySelector("textarea[data-composer]")?.value ?? "";
      app.page.composing.kind = app.page.kind = ds.ckind;
      return again();
    }
    if (ds.delnote) { app.deleteNote(ds.delnote); return again(); }
    if (ds.ghshow) { const k = `gh:${ds.ghshow}`; app.page.open.has(k) ? app.page.open.delete(k) : app.page.open.add(k); return again(); }
    if (ds.viewed) return app.mark(ds.viewed, app.isReviewed(ds.viewed) ? null : "reviewed"); // views restyle .sec.done
    if (ds.go) app.setFocus(ds.go);
    else if (ds.fold) {
      app.page.open.has(ds.fold) ? app.page.open.delete(ds.fold) : app.page.open.add(ds.fold);
      again();
    } else if (ds.jump) {
      const [path, side, line, startSide, startLine] = ds.jump.split("|"), endKey = `${path}|${side}|${line}`, startKey = startLine ? `${path}|${startSide}|${startLine}` : endKey;
      let ln = el.querySelector(`.ln[data-key="${CSS.escape(endKey)}"]`);
      if (!ln) { unfoldAll(app); again(); ln = el.querySelector(`.ln[data-key="${CSS.escape(endKey)}"]`); }
      if (!ln) return;
      selectRange(app, el, { key: startKey }, { ...ln.dataset });
      el.querySelector(`.ln[data-key="${CSS.escape(startKey)}"]`)?.scrollIntoView({ block: "center", behavior: "smooth" });
    } else if (ds.exp) {
      const i = ds.exp.lastIndexOf(":"), id = ds.exp.slice(0, i), dir = ds.exp.slice(i + 1);
      if (id.startsWith("ctx:")) {
        const line = Number(id.slice(id.lastIndexOf(":") + 1));
        const r = (app.page.exp[id] ??= { start: Math.max(1, line - 6), end: line + 6 });
        dir === "above" ? (r.start = Math.max(1, r.start - 12)) : (r.end += 12);
      } else {
        const e = (app.page.exp[id] ??= { above: 0, below: 0 });
        e[dir] += 12;
      }
      again();
    } else if (ds.del) {
      api(`/api/comment/${ds.del}`, null, "DELETE");
      app.state.comments = app.state.comments.filter((c) => c.id !== ds.del);
      app.emit("comments");
      again();
    } else if (ds.low) {
      const open = (app.page.lowOpen ??= new Set());
      open.has(ds.low) ? open.delete(ds.low) : open.add(ds.low);
      again();
    } else if (ds.key) {
      if (el._dragged) return; // the end of a drag across line numbers, not a click
      if (ev.shiftKey && app.page.anchor) return selectRange(app, el, app.page.anchor, { ...ds });
      if (app.page.sel?.key === ds.key && !app.page.composing) { app.page.composing = { ...app.page.sel, kind: app.page.kind ?? "comment" }; return again(); }
      app.page.anchor = { ...ds };
      selectRange(app, el, app.page.anchor, { ...ds });
    }
  });
  // Drag down the line numbers to select several lines (the code itself stays selectable as text).
  el.addEventListener("mousedown", (ev) => {
    const gutter = ev.target.closest(".ln .no, .ln .bar, .ln .sg"), row = gutter?.closest(".ln[data-key]");
    if (!row || ev.button !== 0 || ev.shiftKey) return;
    ev.preventDefault(); // a press on the numbers drags a range; it mustn't start a text selection
    const start = { ...row.dataset };
    let last = row.dataset.key;
    const move = (e) => { // only a drag onto another line selects here; a plain click is the click handler's
      const over = document.elementFromPoint(e.clientX, e.clientY)?.closest?.(".ln[data-key]");
      if (!over || !el.contains(over) || over.dataset.key === last) return;
      last = over.dataset.key;
      if (!el._dragged) { el._dragged = true; app.page.anchor = start; }
      selectRange(app, el, start, { ...over.dataset });
    };
    const up = () => { window.removeEventListener("mousemove", move); window.removeEventListener("mouseup", up); setTimeout(() => (el._dragged = false)); };
    window.addEventListener("mousemove", move);
    window.addEventListener("mouseup", up);
  });
  el.addEventListener("keydown", (ev) => {
    if (!ev.target.matches("textarea[data-composer]")) return;
    ev.stopPropagation();
    if (ev.key === "Escape") { ev.preventDefault(); closeComposer(app, ev.target); }
    if (ev.key === "Enter" && (ev.metaKey || ev.ctrlKey)) { ev.preventDefault(); saveComment(app, ev.target.value).then(() => bound.get(el)()); }
  });
}

async function saveComment(app, text) {
  const t = app.page.composing;
  app.page.composing = null;
  if (!t || !text.trim()) return;
  if (t.editing) await dropDraft(app, t.editing); // a continued draft becomes the real thing
  const range = t.start ? { startLine: Number(t.start.line), startSide: t.start.side } : {};
  if (t.kind === "note") return void (await app.addNote({ body: text.trim(), path: t.path, ...(t.line ? { line: Number(t.line), side: t.side, ...range } : {}) }));
  // GitHub only takes inline comments inside the diff: a range counts when both ends are.
  const c = await api("/api/comment", { path: t.path, line: Number(t.line), side: t.side, body: text.trim(), inDiff: t.indiff === "1" && (!t.start || t.start.indiff === "1"), ...range });
  app.state.comments.push(c);
  app.emit("comments");
}

/** `c` key (kind "comment") or `m` key (kind "note"): compose on the selected line, else the most relevant line on the page. */
export function startComment(app, el, kind = "comment") {
  if (!app.page.sel) {
    if (!el.querySelector(".ln[data-key]") && unfoldAll(app)) bound.get(el)?.(); // nothing to point at while collapsed
    const rows = [...el.querySelectorAll(".ln[data-key]")];
    const pick = rows.find((r) => r.classList.contains("target")) ?? rows.find((r) => r.classList.contains("add") || r.classList.contains("del")) ?? rows[0];
    if (!pick) return;
    app.page.sel = { ...pick.dataset };
    app.page.selKeys = new Set([pick.dataset.key]);
  }
  app.page.composing = { ...app.page.sel, kind };
  bound.get(el)?.();
}

function foldIds(app, pid) {
  const node = app.nodeOf(pid);
  if (!node) return [];
  if (node.kind === "context") return [`ctx:${node.location.path}:${node.location.line}`];
  return app.hunksOf(pid).filter((h) => foldLabel(app, h)).map((h) => h.id);
}
/** Opens every collapsed block of the focused node; returns false if nothing was collapsed. */
function unfoldAll(app) {
  const ids = foldIds(app, app.focus).filter((id) => folded(app, id));
  for (const id of ids) app.page.open.add(id);
  return ids.length > 0;
}

/** `e` key: open what's collapsed, then more context around everything. */
export function expandAll(app, el) {
  const pid = app.focus;
  const node = app.nodeOf(pid);
  if (!node) return;
  if (unfoldAll(app)) {
    // opened collapsed blocks; that's this press
  } else if (node.kind === "context") {
    const id = `ctx:${node.location.path}:${node.location.line}`;
    const r = (app.page.exp[id] ??= { start: Math.max(1, node.location.line - 6), end: node.location.line + 6 });
    r.start = Math.max(1, r.start - 10); r.end += 10;
  } else if (app.caps.files) {
    for (const h of app.hunksOf(pid)) { const e = (app.page.exp[h.id] ??= { above: 0, below: 0 }); e.above += 10; e.below += 10; }
  }
  bound.get(el)?.();
}
