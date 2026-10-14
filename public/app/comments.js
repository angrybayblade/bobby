// Comments in place, like GitHub: threads (other reviewers' comments, and your drafts) under the line they're on, and
// private notes floating beside it. Any of them can be collapsed to a slim marker that stays put: one thread, every
// comment in a file, or every comment in the PR (settings.comments, the default for all of them).
import { esc } from "./core.js";

// ---- the icon that says whether comments are showing: filled when they are, an outline when they're collapsed
export const bubble = (filled) => `<svg viewBox="0 0 16 16" width="14" height="14" aria-hidden="true"><path ${filled ? 'fill="currentColor"' : 'fill="none" stroke="currentColor" stroke-width="1.4"'} d="M2.5 2.5h11a1 1 0 0 1 1 1v7a1 1 0 0 1-1 1H8l-3 2.5V11.5H2.5a1 1 0 0 1-1-1v-7a1 1 0 0 1 1-1Z"/></svg>`;
const NOTE_ICON = `<svg viewBox="0 0 16 16" width="13" height="13" aria-hidden="true"><path fill="currentColor" d="M3 1.5h7.5L14 5v9.5a1 1 0 0 1-1 1H3a1 1 0 0 1-1-1v-12a1 1 0 0 1 1-1Zm7 1V5h2.5L10 2.5ZM4.5 8h7v1h-7V8Zm0 2.5h7v1h-7v-1Z"/></svg>`;

const keyOf = (c) => `${c.path}|${c.side}|${c.line}`;
/** Everything with a line: threads (GitHub, and your drafts), and notes; by line key, and by file. Rebuilt when any changes. */
let memo = null;
export function commentIndex(app) {
  const disc = app.graph.discussion ?? [], mine = app.state.comments, notes = app.state.notes;
  const sig = `${disc.length}:${disc.at(-1)?.id}|${mine.map((c) => `${c.id}${c.wip ? "w" : ""}${c.kind ?? ""}${c.body.length}`).join()}|${notes.map((n) => `${n.id}${n.body.length}`).join()}`;
  if (memo?.graph === app.graph && memo.sig === sig) return memo.idx;
  const me = app.me ?? {}, threads = new Map(), byKey = new Map(), byPath = new Map();
  const add = (map, k, v) => (map.get(k) ?? map.set(k, []).get(k)).push(v);
  // GitHub's comments: a reply points at the first comment of its thread
  const ids = new Set(disc.map((c) => c.id));
  for (const c of [...disc].sort((a, b) => String(a.createdAt).localeCompare(String(b.createdAt)))) {
    const root = c.replyTo && ids.has(c.replyTo) ? c.replyTo : c.id;
    let t = threads.get(root);
    if (!t) threads.set(root, (t = { id: root, kind: "gh", path: c.path, side: c.side, line: c.line, startLine: c.startLine, startSide: c.startSide, items: [] }));
    t.items.push({ author: c.author, avatar: c.avatar, body: c.body, url: c.url, createdAt: c.createdAt });
  }
  // your drafts: comments to be, so threads of their own
  for (const c of mine.filter((x) => x.kind !== "note")) {
    threads.set(`d:${c.id}`, { id: `d:${c.id}`, kind: "draft", path: c.path, side: c.side, line: c.line, startLine: c.startLine, startSide: c.startSide,
      items: [{ author: me.login ?? "you", avatar: me.avatar, body: c.body, createdAt: c.createdAt, draft: true, wip: c.wip, cid: c.id }] });
  }
  for (const t of threads.values()) { add(byKey, keyOf(t), t); add(byPath, t.path, t); }
  // private notes, and unfinished ones from the composer
  const noteList = [
    ...notes.filter((n) => n.line).map((n) => ({ id: `n:${n.id}`, nid: n.id, path: n.path, side: n.side ?? "RIGHT", line: n.line, startLine: n.startLine, body: n.body, createdAt: n.createdAt })),
    ...mine.filter((c) => c.kind === "note").map((c) => ({ id: `n:${c.id}`, cid: c.id, wip: true, path: c.path, side: c.side, line: c.line, startLine: c.startLine, body: c.body, createdAt: c.createdAt })),
  ];
  const notesByKey = new Map();
  for (const n of noteList) { add(notesByKey, keyOf(n), n); add(byPath, n.path, { ...n, note: true }); }
  memo = { graph: app.graph, sig, idx: { byKey, notesByKey, byPath, threads } };
  return memo.idx;
}

// ---- collapsed or open: a thread's own choice, else its file's, else the PR's (the setting)
const pageState = (app) => (app.commentState ??= { files: new Map(), items: new Map() }); // while the page is open, across focus changes
const prState = (app) => app.settings.comments ?? "open";
export const fileState = (app, path) => pageState(app).files.get(path) ?? prState(app);
const itemOpen = (app, id, path) => (pageState(app).items.get(id) ?? fileState(app, path)) === "open";
/** Collapses or opens one thread or note; a broader choice later replaces it. */
export function toggleItem(app, id, path) {
  pageState(app).items.set(id, itemOpen(app, id, path) ? "collapsed" : "open");
  app.emit("comments");
}
/** Every comment and note in a file, collapsed or opened together. */
export function toggleFile(app, path) {
  const s = pageState(app), next = fileState(app, path) === "open" ? "collapsed" : "open";
  s.files.set(path, next);
  for (const id of [...s.items.keys()]) if (commentIndex(app).byPath.get(path)?.some((x) => x.id === id)) s.items.delete(id);
  app.emit("comments");
}
/** Every comment in the PR: saved as the default (settings.comments), and the files' and threads' own choices cleared. */
export function togglePR(app) {
  const s = pageState(app);
  s.files.clear(); s.items.clear();
  app.saveSettings({ comments: prState(app) === "open" ? "collapsed" : "open" });
  app.emit("comments");
}
/** Shows a long comment in full, and remembers it while the page is open. */
export function showFull(app, ck) { pageState(app).full = (pageState(app).full ?? new Set()).add(ck); app.emit("comments"); }
/** What the comment state of a file is, for knowing when to redraw it. */
export const fileStamp = (app, path) => `${fileState(app, path)}:${pageState(app).full?.size ?? 0}:${(commentIndex(app).byPath.get(path) ?? []).map((x) => (itemOpen(app, x.id, path) ? 1 : 0)).join("")}`;
export const fileCount = (app, path) => (commentIndex(app).byPath.get(path) ?? []).reduce((n, x) => n + (x.items?.length ?? 1), 0);
export const prCount = (app) => [...commentIndex(app).byPath.values()].flat().reduce((n, x) => n + (x.items?.length ?? 1), 0);

// ---- threads
const avatar = (a) => `<img class="cav" src="/api/avatar?u=${encodeURIComponent(a.avatar ?? a.author)}" alt="" loading="lazy" onerror="this.style.visibility='hidden'">`;
const range = (t) => t.startLine && t.startLine !== t.line ? `<span class="crange">L${t.startLine}–L${t.line}</span>` : "";
/** The threads anchored on a line, as HTML. */
export function threadsAt(app, key) {
  return (commentIndex(app).byKey.get(key) ?? []).map((t) => threadHtml(app, t)).join("");
}
function threadHtml(app, t) {
  const open = itemOpen(app, t.id, t.path), first = t.items[0], n = t.items.length;
  if (!open) { // in place, one line: who, how many, and how it starts
    const faces = [...new Map(t.items.map((i) => [i.author, i])).values()].slice(0, 3).map(avatar).join("");
    return `<div class="cthread slim${t.kind === "draft" ? " draft" : ""}" data-tid="${esc(t.id)}" data-tpath="${esc(t.path)}" title="Show ${n > 1 ? "this thread" : "this comment"}">
      <span class="cfaces">${faces}</span><b>${esc(first.author)}</b>${t.kind === "draft" ? `<span class="ctag">${first.wip ? "unfinished" : "draft"}</span>` : ""}
      <span class="cprev">${esc(plain(first.body))}</span>${n > 1 ? `<span class="cn">${n} comments</span>` : ""}${bubble(false)}</div>`;
  }
  const items = t.items.map((i, k) => `<div class="citem">${avatar(i)}<div class="cmain">
      <div class="cwho"><b>${esc(i.author)}</b>${i.draft ? `<span class="ctag">${i.wip ? "unfinished draft" : "draft"}</span>` : ""}<span class="cwhen" title="${esc(i.createdAt ?? "")}">${ago(i.createdAt)}</span>
        ${k === 0 ? range(t) : ""}${i.url ? `<a class="clink" href="${esc(i.url)}" target="_blank" rel="noopener" title="Open on GitHub">↗</a>` : ""}<span class="cgrow"></span>
        ${i.wip ? `<button class="cact" data-wip="${esc(i.cid)}" title="Open it again to finish">Continue</button>` : ""}${i.cid ? `<button class="cact" data-del="${esc(i.cid)}" title="Discard this draft">Delete</button>` : ""}
        ${k === 0 ? `<button class="cfold" data-tid="${esc(t.id)}" data-tpath="${esc(t.path)}" title="Collapse${n > 1 ? " this thread" : ""}">${bubble(true)}</button>` : ""}</div>
      <div class="cbody" data-ck="${esc(t.id)}:${k}">${md(i.body)}</div></div></div>`).join("");
  return `<div class="cthread${t.kind === "draft" ? " draft" : ""}">${items}</div>`;
}

// ---- notes: floating beside their line, over the code's right edge; collapsed to an icon
/** The notes on the lines of a code box (keys: the line keys it shows), as HTML for its note layer. */
export function notesFor(app, keys) {
  const idx = commentIndex(app);
  return keys.flatMap((k) => idx.notesByKey.get(k) ?? []).map((n) => {
    if (!itemOpen(app, n.id, n.path)) return `<button class="fnote slim" data-tid="${esc(n.id)}" data-tpath="${esc(n.path)}" data-at="${esc(keyOf(n))}" title="Your private note: ${esc(plain(n.body))}">${NOTE_ICON}</button>`;
    return `<div class="fnote${n.wip ? " wip" : ""}" data-at="${esc(keyOf(n))}">
      <div class="fnhead">${NOTE_ICON}<span>${n.wip ? "unfinished note" : "private note"}${n.startLine && n.startLine !== n.line ? ` · L${n.startLine}–L${n.line}` : ""}</span><span class="cwhen">${ago(n.createdAt)}</span><span class="cgrow"></span>
        ${n.wip ? `<button class="cact" data-wip="${esc(n.cid)}">Continue</button>` : ""}<button class="cact" ${n.nid ? `data-delnote="${esc(n.nid)}"` : `data-del="${esc(n.cid)}"`} title="Delete">✕</button>
        <button class="cfold" data-tid="${esc(n.id)}" data-tpath="${esc(n.path)}" title="Collapse">–</button></div>
      <div class="cbody">${md(n.body)}</div></div>`;
  }).join("");
}
/** After a render: long comments clipped with "Show more" (unless opened before), and notes pinned beside their lines. */
export function placeNotes(el, app) {
  const full = app ? (pageState(app).full ??= new Set()) : new Set();
  for (const b of el.querySelectorAll(".cbody[data-ck]")) {
    if (full.has(b.dataset.ck)) { b.classList.add("full"); continue; }
    if (b.scrollHeight > b.clientHeight + 8) b.insertAdjacentHTML("afterend", `<button class="cshow" data-cfull="${esc(b.dataset.ck)}">Show more</button>`);
  }
  for (const box of el.querySelectorAll(".code")) {
    let bottom = 0;
    for (const n of box.querySelectorAll(".nlayer > .fnote")) {
      const rows = [...box.querySelectorAll(`.ln[data-key="${CSS.escape(n.dataset.at)}"]`)], row = rows.at(-1); // split: the side it's on
      if (!row) { n.hidden = true; continue; }
      const top = Math.max(row.offsetTop, bottom); // the box is the rows' offset parent, split rows too
      n.style.top = `${top}px`;
      bottom = top + n.offsetHeight + 4;
    }
  }
}

// ---- comments outside the lines a hunk shows: "2 comments below", which opens the code down to them
export function outside(app, path, from, to) {
  return (commentIndex(app).byPath.get(path) ?? []).filter((x) => x.side === "RIGHT" && x.line >= from && x.line <= to);
}

// ---- a comment's text: GitHub-flavoured Markdown, the safe part of it. Everything is escaped first; a few plain tags
// (details, summary, b, i, code, br…) come back without attributes, and links only to http(s).
export function md(src) {
  const blocks = [];
  let text = String(src ?? "").replace(/\r\n/g, "\n").replace(/```(\w*)\n([\s\S]*?)```/g, (_, lang, code) => {
    const hl = window.hljs && lang && window.hljs.getLanguage(lang === "suggestion" ? "plaintext" : lang)
      ? window.hljs.highlight(code.replace(/\n$/, ""), { language: lang === "suggestion" ? "plaintext" : lang, ignoreIllegals: true }).value : esc(code.replace(/\n$/, ""));
    blocks.push(`${lang === "suggestion" ? `<div class="csug">Suggested change</div>` : ""}<pre class="ccode"><code>${hl}</code></pre>`);
    return `\u0000${blocks.length - 1}\u0000`;
  });
  text = esc(text)
    .replace(/&lt;(\/?)(details|summary|b|i|em|strong|code|p|sub|sup|ul|ol|li|blockquote|kbd)\s*&gt;/gi, "<$1$2>")
    .replace(/&lt;br\s*\/?&gt;/gi, "<br>")
    .replace(/&lt;\/?[a-z][^&]*?&gt;/gi, "") // any other tag (img, a, div with attributes…): dropped
    .replace(/&lt;!--[\s\S]*?--&gt;/g, "");
  const inline = (s) => s
    .replace(/`([^`\n]+)`/g, "<code>$1</code>")
    .replace(/\*\*([^*\n]+)\*\*/g, "<strong>$1</strong>")
    .replace(/(^|[\s(])\*([^*\n]+)\*(?=[\s).,!?]|$)/g, "$1<em>$2</em>")
    .replace(/\[([^\]\n]+)\]\((https?:\/\/[^\s)]+)\)/g, '<a href="$2" target="_blank" rel="noopener">$1</a>')
    .replace(/(^|[\s(])(https?:\/\/[^\s<)]+)/g, '$1<a href="$2" target="_blank" rel="noopener">$2</a>');
  const out = [];
  let list = null, table = null;
  const cells = (row) => row.trim().replace(/^\||\|$/g, "").split("|").map((c) => c.trim());
  const flushTable = () => {
    if (!table) return;
    const [head, , ...body] = table;
    out.push(`<table class="ctable"><tr>${cells(head).map((c) => `<th>${inline(c)}</th>`).join("")}</tr>${body.map((r) => `<tr>${cells(r).map((c) => `<td>${inline(c)}</td>`).join("")}</tr>`).join("")}</table>`);
    table = null;
  };
  const lines = text.split("\n");
  for (const [k, raw] of lines.entries()) {
    // a table: a | row, then a |---| row
    if (table || (/^\s*\|/.test(raw) && /^\s*\|?\s*:?-{3,}/.test(lines[k + 1] ?? ""))) {
      if (/^\s*\|/.test(raw)) { (table ??= []).push(raw); continue; }
      flushTable();
    }
    const li = /^\s*(?:[-*]|\d+\.)\s+(.*)$/.exec(raw);
    if (li) { list ??= []; list.push(`<li>${inline(li[1].replace(/^\[([ x])\]\s*/, (_, x) => (x === "x" ? "☑ " : "☐ ")))}</li>`); continue; }
    if (list) { out.push(`<ul>${list.join("")}</ul>`); list = null; }
    const h = /^(#{1,6})\s+(.*)$/.exec(raw), q = /^&gt;\s?(.*)$/.exec(raw);
    if (h) out.push(`<div class="ch">${inline(h[2])}</div>`);
    else if (q) out.push(`<blockquote>${inline(q[1])}</blockquote>`);
    else if (/^\s*$/.test(raw)) out.push("<br>");
    else out.push(`${inline(raw)}<br>`);
  }
  if (list) out.push(`<ul>${list.join("")}</ul>`);
  flushTable();
  return out.join("").replace(/(<br>)+$/, "").replace(/(<br>){3,}/g, "<br><br>").replace(/\u0000(\d+)\u0000(<br>)?/g, (_, i) => blocks[Number(i)]);
}
/** A comment's first words, for a collapsed thread. */
const plain = (s) => String(s ?? "").replace(/```[\s\S]*?```/g, "[code]").replace(/<[^>]+>/g, "").replace(/[*_`#>]/g, "").replace(/\s+/g, " ").trim().slice(0, 140);
function ago(when) {
  const t = Date.parse(when ?? "");
  if (!t) return "";
  const s = (Date.now() - t) / 1000;
  return s < 60 ? "just now" : s < 3600 ? `${Math.floor(s / 60)}m ago` : s < 86400 ? `${Math.floor(s / 3600)}h ago` : s < 30 * 86400 ? `${Math.floor(s / 86400)}d ago` : new Date(t).toLocaleDateString();
}
