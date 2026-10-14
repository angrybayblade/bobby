// A node, laid out top to bottom: title, why it matters, the comments on it, then its code.
// Views show it as the level-2 page, or as the body of the focused card (no title block).
import { BAND_TEXT, DONE, LOW, api, esc } from "./core.js";
import { MOD } from "./palette.js";
import { keyHtml } from "./keys.js";
import { bubble, notesFor, outside, placeNotes, showFull, threadsAt, toggleItem } from "./comments.js";

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
    api(`/api/file?path=${encodeURIComponent(path)}`).then((r) => { files.set(path, r.lines ?? []); rerender(); }, () => files.delete(path)); // asked again next time
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
  if (!mirror) target.keys?.push(key); // the lines this box shows, for its floating notes
  const nums = half === "L" ? `<span class="no">${o ?? ""}</span>` : half === "R" ? `<span class="no">${n ?? ""}</span>` : `<span class="no">${o ?? ""}</span><span class="no">${n ?? ""}</span>`;
  const composing = !half && app.page.composing?.key === key;
  const sel = !mirror && (app.page.selKeys ? app.page.selKeys.has(key) : app.page.sel?.key === key);
  return `<div class="ln ${cls}${sel ? " sel" : ""}${!mirror && target.hi === n && t !== "-" ? " target" : ""}" data-key="${esc(key)}" data-path="${esc(target.path)}" data-line="${line}" data-side="${side}" data-indiff="${target.inDiff && t !== "x" ? 1 : 0}">
    <span class="bar"></span>${nums}<span class="sg">${t === "+" ? "+" : t === "-" ? "−" : ""}</span><code>${html}</code></div>`
    + (!half ? cmLine(threadsAt(app, key) + (composing ? composer(app, app.page.composing) : "")) : ""); // inline: under the line, the width of the node
}
/** Diff lines as rows: one column (inline), or old beside new (split), pairing each run of removals with the additions after it. */
function diffRows(app, lines, html, target) {
  if (app.layoutOf(target.path) !== "split") return lines.map((l, i) => row(app, l, html[i], target)).join("");
  const pair = (L, R) => {
    const cell = (i, half) => i == null ? `<div class="ln none"></div>` : row(app, lines[i], html[i], target, half);
    const c = app.page.composing, keyAt = (i) => `${target.path}|${lines[i].t === "-" ? "LEFT" : "RIGHT"}|${lines[i].t === "-" ? lines[i].o : lines[i].n}`;
    const composing = c && [L, R].some((i) => i != null && c.key === keyAt(i));
    // split: a thread sits on the side it was made on, as wide as that side; an unchanged line's are on the right
    const lk = L != null && lines[L].t === "-" ? keyAt(L) : null, rk = R != null && lines[R].t !== "-" ? keyAt(R) : null;
    const side = (k) => (k ? threadsAt(app, k) + (composing && c.key === k ? composer(app, c) : "") : ""); // the box sits on its line's side
    const left = side(lk), right = side(rk);
    return `<div class="srow">${cell(L, "L")}${cell(R, "R")}</div>${left || right ? `<div class="srow cmrow"><div class="cmcell">${left}</div><div class="cmcell">${right}</div></div>` : ""}`;
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
const cmLine = (html) => (html ? `<div class="cmline">${html}</div>` : "");
/** The floating notes on a code box's lines, and "N comments above/below" for comments just outside what it shows. */
function boxExtras(app, target) {
  const notes = notesFor(app, [...new Set(target.keys)]);
  return notes ? `<div class="nlayer">${notes}</div>` : "";
}
function cmMore(app, h, dir, list, lines) {
  if (!list.length) return "";
  const n = list.reduce((k, x) => k + (x.items?.length ?? 1), 0), what = list.every((x) => x.note) ? `note${n > 1 ? "s" : ""}` : `comment${n > 1 ? "s" : ""}`;
  return app.caps.files ? `<button class="more cmore" data-expto="${esc(h.id)}:${dir}:${lines}">${bubble(false)} ${n} ${what} ${dir}</button>`
    : `<div class="more cmore">${bubble(false)} ${n} ${what} ${dir}, outside the diff</div>`;
}

// A line can take a GitHub draft or a private note; c.file composes a note on a whole file (notes only). It looks like
// the thread it becomes, and sits where that thread will.
function composer(app, c) {
  const note = c.kind === "note", me = app.me;
  const face = me ? `<img class="cav" src="/api/avatar?u=${encodeURIComponent(me.avatar ?? me.login)}" alt="" onerror="this.style.visibility='hidden'">` : "";
  const range = c.start && !c.file ? `<span class="crange">${rangeLabel({ side: c.side, line: c.line, startLine: Number(c.start.line), startSide: c.start.side })}</span>` : "";
  const kinds = c.file ? `<span class="ccap">Private note on this file</span>` : `<div class="ckind" role="group" aria-label="Kind">${[["comment", "Comment"], ["note", "Private note"]].map(([k, t]) =>
    `<button data-ckind="${k}" aria-pressed="${c.kind === k}">${t}</button>`).join("")}</div>`;
  const hint = note ? "A private note: only you see it, and it's never posted to GitHub" : "Leave a comment: saved as a draft for your review";
  return `<div class="cthread ccompose${note ? " note" : ""}"><div class="citem">${face}<div class="cmain">
    <div class="cwho">${kinds}<span class="cgrow"></span>${range}</div>
    <textarea data-composer placeholder="${hint}">${esc(c.text ?? "")}</textarea>
    <div class="cfoot"><span class="chint">${MOD}↵ to save · esc keeps it for later</span><span class="cgrow"></span><button class="btn" data-ccancel>Cancel</button><button class="btn primary" data-csave>${note ? "Add note" : "Save draft"}</button></div>
  </div></div></div>`;
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
  // In the gutter of the selection's last line, just left of its code (in split, that side's), like GitHub's: over the
  // line number, covering no code. Long lines scrolled sideways move the gutter, so that's taken off.
  const code = row.querySelector("code");
  let left = 0;
  for (let n = code; n && n !== box; n = n.offsetParent) left += n.offsetLeft;
  pop.style.top = `${top + (row.offsetHeight - pop.offsetHeight) / 2}px`;
  pop.style.left = `${Math.max(2, left - (row.closest(".lines")?.scrollLeft ?? 0) - pop.offsetWidth - 2)}px`;
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
    const range = c.start ? { startLine: Number(c.start.line), startSide: c.start.side } : {};
    try {
      // the new draft first: the one it replaces goes only once that's saved
      const d = await api("/api/comment", { path: c.path, line: Number(c.line), side: c.side, body: text, inDiff: c.indiff === "1" && (!c.start || c.start.indiff === "1"), wip: true, ...(c.kind === "note" ? { kind: "note" } : {}), ...range });
      app.state.comments.push(d);
      if (c.editing) await dropDraft(app, c.editing).catch((e) => app.fail?.(e)); // saved either way; the old one may linger
      app.emit("comments");
    } catch (e) { app.page.composing = { ...c, text: ta.value }; app.fail?.(e); } // still open, text and all
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
function privateNote(n, where, key) {
  return `<div class="note mine"${key ? ` data-jump="${key}"` : ""}><div class="who">You · private note${where ? ` · ${where}` : ""}<button class="x" data-delnote="${n.id}" title="Delete note">✕</button></div><div class="body">${esc(n.body)}</div></div>`;
}

// Notes on a whole file, plus the composer while you're writing one.
const pathOf = (node) => (node.kind === "change" ? node.file : node.location.path);
function fileNotesHtml(app, path) {
  const list = app.state.notes.filter((n) => n.path === path && !n.line);
  const c = app.page.composing, writing = c?.key === `file:${path}`;
  if (!list.length && !writing) return "";
  return `<section class="notes fnotes"><h4>Your notes on this file${list.length ? ` · ${list.length}` : ""}</h4>${list.map((n) => privateNote(n, "", "")).join("")}${writing ? composer(app, c) : ""}</section>`;
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
  const target = { path: h.file, inDiff: true, keys: [] };
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
  const lines = `${ctxRows(Math.max(1, h.newStart - e.above), h.newStart - 1, h.oldStart - h.newStart)}${diffRows(app, h.lines, html, target)}${ctxRows(lastN + 1, lastN + e.below, lastO - lastN)}`;
  // comments between this hunk and the next one in the file (and, for the first, before it): a marker that opens the code to them
  const sib = app.graph.hunks.filter((x) => x.file === h.file).sort((a, b) => a.newStart - b.newStart), at = sib.findIndex((x) => x.id === h.id);
  const lo = Math.max(1, h.newStart - e.above), hi = lastN + e.below, next = sib[at + 1]?.newStart ?? Infinity;
  const below = outside(app, h.file, hi + 1, next - 1), above = at === 0 ? outside(app, h.file, 1, lo - 1) : [];
  return `<div class="code">
    ${head}
    ${cmMore(app, h, "above", above, lo - Math.min(...above.map((x) => x.startLine ?? x.line), lo) + 2)}
    ${canExpand && h.newStart > 1 ? `<button class="more" data-exp="${h.id}:above">⋯ more above</button>` : ""}
    <div class="lines">${lines}</div>
    ${cmMore(app, h, "below", below, Math.max(...below.map((x) => x.line), hi) - hi + 2)}
    ${canExpand ? `<button class="more" data-exp="${h.id}:below">⋯ more below</button>` : ""}
    ${boxExtras(app, target)}
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
  const target = { path, inDiff: false, hi: line, keys: [] };
  const canMore = app.caps.files || lo > snip.start || hi < snip.start + snip.lines.length - 1;
  return `<div class="code">
    ${opts.whole
      ? lineHead(`L${line}`, ` <span style="color:var(--faint)">· not changed in this PR</span>`)
      : fileHead(path, `<span style="color:var(--faint)">:${line} · not changed in this PR</span>`, `<span class="st">${hideBtn(key)}</span>`)}
    ${canMore && lo > 1 ? `<button class="more" data-exp="${esc(key)}:above">⋯ more above</button>` : ""}
    <div class="lines">${nums.map((n, i) => row(app, { t: " ", o: null, n }, html[i], target)).join("")}</div>
    ${canMore ? `<button class="more" data-exp="${esc(key)}:below">⋯ more below</button>` : ""}
    ${boxExtras(app, target)}
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
    body = fileNotesHtml(app, pathOf(node)) + (node.kind === "change" ? app.hunksOf(pid).map((h) => hunkBox(app, h, rerender)).join("") : contextBox(app, node, rerender));
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
      ${node.kind === "change" ? app.hunksOf(pid).map((h) => hunkBox(app, h, rerender)).join("") : contextBox(app, node, rerender)}`;
  }
  el.innerHTML = `<div class="node ${head ? "page" : "body"}">${body}</div>`;
  const ta = el.querySelector("textarea[data-composer]");
  if (ta) ta.focus({ preventScroll: !head });
  syncPop(app, el);
  placeNotes(el, app);
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
      ${code}</section>`;
  }).join("")}</div>`;
  const ta = el.querySelector("textarea[data-composer]");
  if (ta) ta.focus({ preventScroll: true });
  syncPop(app, el);
  placeNotes(el, app);
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
const BADGE = ["in diff", "in PR", "elsewhere"];
/** Whether a use imports the name or calls it (directly, or a method reached through it), from the code around it. */
function useKind(u, name) {
  const text = u.text ?? "", before = text.slice(0, u.col), after = text.slice(u.col + name.length);
  if (u.scope === "import" || u.scope?.endsWith(" › import")) return "import"; // inside a multi-line import
  if (/^\s*(import\b|from\s+\S+\s+import\b|export\s*(\{|\*))/.test(text) || /\brequire\(\s*['"]?$/.test(before)) return "import";
  if (/^\s*(<[^>()]*>)?\s*\(/.test(after) || /^\s*\??\.\w+\s*\(/.test(after)) return "call";
  return null;
}
/** A use's line, its leading space trimmed, highlighted, with the name marked. */
function useCode(u, name, cols = [u.col]) {
  const text = u.text ?? "", lead = text.length - text.trimStart().length;
  return applyRanges(hlBlock([text.trim()], langOf(u.path))[0], cols.map((c) => [c - lead, c - lead + name.length]), "usemark");
}
const fileCache = new Map(); // path → its lines at head, for the code a use opens in place
function usesHtml(app, e) {
  const shown = (e.list ?? []).map((u, i) => [i, u]).filter(([, u]) => (e.filter == null || u.group === e.filter) && (!e.kindFilter || useKind(u, e.name) === e.kindFilter));
  let room = SHOW_ELSEWHERE - shown.filter(([, u]) => u.group < 2).length, hidden = 0;
  const cards = [];
  for (const [i, u] of shown) {
    if (u.group === 2 && e.filter !== 2 && room-- <= 0) { hidden++; continue; }
    let c = cards.at(-1);
    if (!c || c.path !== u.path || c.group !== u.group) cards.push((c = { path: u.path, group: u.group, items: [] }));
    const prev = c.items.at(-1);
    if (prev?.[1].line === u.line) { prev[2].push(u.col); continue; } // more than one use on a line: one row, each marked
    c.items.push([i, u, [u.col]]);
  }
  hidden += Math.max(0, (e.res?.total ?? 0) - (e.list?.length ?? 0));
  return cards.map((c) => {
    const slash = c.path.lastIndexOf("/");
    const head = `<div class="uchead"><span class="ubadge g${c.group}">${BADGE[c.group]}</span><b>${esc(c.path.slice(slash + 1))}</b><span class="udir">&lrm;${esc(c.path.slice(0, slash))}&lrm;</span><span class="ucount">${c.items.length}</span></div>`;
    const items = c.items.map(([i, u, cols]) => { // one line: where it is, and its code
      const scope = u.scope?.replace(/(^| › )import$/, "") ?? "";
      return `<div class="uitem${e.open === i ? " open" : ""}${e.sel === i ? " sel" : ""}" data-use="${i}"><span class="uline">${u.line}</span><span class="uscope" title="${esc(scope)}">${esc(scope)}</span><code>${useCode(u, e.name, cols)}</code></div>${e.open === i ? useViewer(app, e, u) : ""}`;
    }).join("");
    return `<div class="ucard">${head}${items}</div>`;
  }).join("") + (hidden ? `<div class="pkmore">and ${hidden} more elsewhere${e.filter == null ? ": filter to Elsewhere to see more" : ""}</div>` : "");
}
/** A use's code, in place under it: lines around it, the use marked, more above or below on request; and for a use in
 *  the branch, a button to its diff node. */
function useViewer(app, e, u) {
  const lines = fileCache.get(u.path);
  if (!lines) {
    if (!fileCache.has(u.path) && app.caps.files) {
      fileCache.set(u.path, null);
      api(`/api/file?path=${encodeURIComponent(u.path)}`).then((r) => { fileCache.set(u.path, r?.lines ?? []); drawPeek(app); }).catch(() => fileCache.delete(u.path));
    }
    return `<div class="uview"><div class="pkmore">${app.caps.files ? "loading…" : "No local clone: the code can't be shown."}</div></div>`;
  }
  const r = (e.ranges ??= {})[`${u.path}:${u.line}`] ??= { from: Math.max(1, u.line - 6), to: u.line + 6 };
  const from = r.from, to = Math.min(lines.length, r.to), html = hlBlock(lines.slice(from - 1, to), langOf(u.path));
  const rows = html.map((h, k) => {
    const n = from + k, mark = n === u.line ? applyRanges(h, [[u.col, u.col + e.name.length]], "usemark") : h;
    return `<div class="pl${n === u.line ? " at" : ""}" data-path="${esc(u.path)}" data-line="${n}"><span class="no">${n}</span><code>${mark}</code></div>`;
  }).join("");
  const pr = app.graph.pr, inBranch = u.group < 2 && app.pidAt(u.path, u.line);
  const gh = pr.provider !== "local" ? `<a class="btn" href="${esc(`https://github.com/${pr.owner}/${pr.repo}/blob/${pr.headSha}/${u.path}#L${u.line}`)}" target="_blank" rel="noopener">GitHub ↗</a>` : "";
  return `<div class="uview">${from > 1 ? `<button class="umore" data-umore="up">▲ more above</button>` : ""}<div class="pkc">${rows}</div>${to < lines.length ? `<button class="umore" data-umore="down">▼ more below</button>` : ""}
    <div class="uacts">${inBranch ? `<button class="btn" data-uopen="1" title="Close this and focus its diff node · o">Open in diff</button>` : ""}${gh}<span class="uhint">${MOD}-click a name here to inspect it</span></div></div>`;
}
/** Open in diff: close the window and focus the node it's in; in the diff, its line selected. */
function openInDiff(app, u) {
  const pid = app.pidAt(u.path, u.line);
  if (!pid) return;
  app.page.peek = null;
  drawPeek(app);
  app.setFocus(pid);
  if (u.group === 0) setTimeout(() => selectLine(app, `${u.path}|RIGHT|${u.line}`), 350); // once the view has moved there
}
function toggleUse(app, e, i) {
  e.open = e.open === i ? null : i;
  e.sel = i;
  drawPeek(app);
  peekEl?.querySelector(`.uitem[data-use="${i}"]`)?.scrollIntoView({ block: "nearest" });
}
/** Keys while a list of uses is showing: ↑ ↓ (or j k) move, enter opens or closes the code, o opens it in the diff. */
export function inspectorKey(app, ev) {
  const e = app.page.peek?.stack.at(-1);
  if (e?.kind !== "uses" || !e.list?.length) return false;
  const order = [...(peekEl?.querySelectorAll(".uitem") ?? [])].map((n) => Number(n.dataset.use));
  const at = order.indexOf(e.sel ?? -1);
  if (["ArrowDown", "j", "ArrowUp", "k"].includes(ev.key)) {
    e.sel = order[Math.max(0, Math.min(order.length - 1, at + (ev.key === "ArrowDown" || ev.key === "j" ? 1 : -1)))] ?? order[0];
    drawPeek(app);
    peekEl?.querySelector(`.uitem[data-use="${e.sel}"]`)?.scrollIntoView({ block: "nearest" });
    return true;
  }
  if (ev.key === "Enter" && e.sel != null) { toggleUse(app, e, e.sel); return true; }
  if (ev.key === "o" && e.sel != null) { openInDiff(app, e.list[e.sel]); return true; }
  return false;
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
    const files = new Set((e.list ?? []).map((u) => u.path)).size;
    const summary = e.loading ? `<div class="pkw">looking for its uses…</div>`
      : !n ? `<div class="pkw">No uses found${res?.pending ? ": types are still loading, try again in a moment" : res?.via === "syntax" ? " through imports (uses through a value need the language server)" : ""}.</div>`
      : `<div class="pkw">Used ${res.total} time${res.total === 1 ? "" : "s"} in ${files} file${files === 1 ? "" : "s"}</div>
        <div class="ufilters">${[["All", null, n], ...USE_GROUPS.map((t, g) => [["In the diff", "In the PR", "Elsewhere"][g], g, counts[g]])].map(([t, g, c]) =>
          `<button class="ufilter" data-ufilter="${g ?? "all"}" aria-pressed="${(e.filter ?? null) === g}"${c ? "" : " disabled"}>${t} <span>${c}</span></button>`).join("")}
          <span class="usep"></span>${["call", "import"].map((k) => { const c = (e.list ?? []).filter((u) => useKind(u, e.name) === k).length;
            return `<button class="ufilter" data-ukind="${k}" aria-pressed="${e.kindFilter === k}"${c ? "" : " disabled"}>${k} <span>${c}</span></button>`; }).join("")}</div>`;
    const head = `<div class="pkh"><div class="pktrail">${trail}<span class="pktag">uses</span></div>${via}<button class="pkx" data-peekclose title="Close · esc" aria-label="Close">✕</button></div>${summary}`;
    const hint = e.loading || !n ? "" : `<div class="pkhint">Click a use to read it here · ↑ ↓ to move, enter to open, o for its diff node · esc to go back</div>`;
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
    peekEl.addEventListener("mousedown", (ev) => {
      downOnBackdrop = ev.target === peekEl;
      if ((ev.metaKey || ev.ctrlKey) && ev.button === 0 && ev.target.closest(".pl code")) ev.preventDefault(); // as in the code: no selection
    });
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
  const e = app.page.peek.stack.at(-1);
  const filter = ev.target.closest("[data-ufilter]");
  if (filter) { e.filter = filter.dataset.ufilter === "all" ? null : Number(filter.dataset.ufilter); e.open = null; return drawPeek(app); }
  const kind = ev.target.closest("[data-ukind]");
  if (kind) { e.kindFilter = e.kindFilter === kind.dataset.ukind ? null : kind.dataset.ukind; e.open = null; return drawPeek(app); } // again: off
  if (ev.target.closest("[data-uopen]")) return openInDiff(app, e.list[e.open]);
  const more = ev.target.closest("[data-umore]");
  if (more) { const u = e.list[e.open], r = e.ranges[`${u.path}:${u.line}`]; more.dataset.umore === "up" ? (r.from = Math.max(1, r.from - 12)) : (r.to += 12); return drawPeek(app); }
  const use = !(ev.metaKey || ev.ctrlKey) && ev.target.closest(".uitem");
  if (use) return toggleUse(app, e, Number(use.dataset.use));
  const code = (ev.metaKey || ev.ctrlKey) && ev.target.closest(".pl code");
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
    const full = ev.target.closest("[data-cfull]");
    if (full) return showFull(app, full.dataset.cfull, full.closest(".cthread"));
    const fold = ev.target.closest("[data-tid]");
    if (fold && !ev.target.closest("[data-del],[data-wip],[data-delnote]")) return toggleItem(app, fold.dataset.tid, fold.dataset.tpath, fold);
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
    const t = ev.target.closest("[data-compose],[data-wip],[data-expto],[data-ckind],[data-csave],[data-ccancel],[data-delnote],[data-viewed],[data-exp],[data-del],[data-low],[data-go],[data-jump],[data-fold],.ln[data-key]");
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
    if (ds.csave !== undefined) return saveComment(app, el.querySelector("textarea[data-composer]")?.value ?? "").then(again);
    if (ds.ccancel !== undefined) { app.page.composing = null; return again(); } // Cancel discards; esc keeps it as an unfinished draft
    if (ds.ckind) { // switch the composer between a GitHub draft and a private note, keeping the text
      app.page.composing.text = el.querySelector("textarea[data-composer]")?.value ?? "";
      app.page.composing.kind = app.page.kind = ds.ckind;
      return again();
    }
    if (ds.delnote) return app.deleteNote(ds.delnote).then(again);
    if (ds.expto) { const [id, dir, n] = ds.expto.split(":"), e = (app.page.exp[id] ??= { above: 0, below: 0 }); e[dir] = Math.max(e[dir], Number(n)); return again(); }
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
      api(`/api/comment/${ds.del}`, null, "DELETE").then(() => { // gone once the server says so
        app.state.comments = app.state.comments.filter((c) => c.id !== ds.del);
        app.emit("comments");
        again();
      }, (e) => app.fail?.(e));
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
  // ⌘/ctrl(+shift)-click on code inspects; the browser would act on the press first (shift extends the text selection
  // from wherever it was), before the click reaches the inspector, so that's cancelled here, on the press.
  el.addEventListener("mousedown", (ev) => { if ((ev.metaKey || ev.ctrlKey) && ev.button === 0 && ev.target.closest(".ln[data-key] code")) ev.preventDefault(); });
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

/** Saves the composer's text. Only once the server has it does the box close and a continued draft go; if it can't
 *  be saved, the box stays open with the text in it. */
async function saveComment(app, text) {
  const t = app.page.composing;
  app.page.composing = null;
  if (!t || !text.trim()) return;
  const range = t.start ? { startLine: Number(t.start.line), startSide: t.start.side } : {};
  try {
    if (t.kind === "note") await app.addNote({ body: text.trim(), path: t.path, ...(t.line ? { line: Number(t.line), side: t.side, ...range } : {}) });
    else {
      // GitHub only takes inline comments inside the diff: a range counts when both ends are.
      const c = await api("/api/comment", { path: t.path, line: Number(t.line), side: t.side, body: text.trim(), inDiff: t.indiff === "1" && (!t.start || t.start.indiff === "1"), ...range });
      app.state.comments.push(c);
    }
    if (t.editing) await dropDraft(app, t.editing).catch((e) => app.fail?.(e)); // a continued draft became the real thing
    app.emit("comments");
  } catch (e) { app.page.composing = { ...t, text }; app.fail?.(e); }
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
