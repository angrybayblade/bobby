// Comments in place, like GitHub: threads (other reviewers' comments, and your drafts) under the line they're on, and
// private notes floating beside it. Any of them can be collapsed to a slim marker that stays put: one thread, every
// comment in a file, or every comment in the PR (settings.comments, the default for all of them).
import { LOW, api, esc, live } from "./core.js";
import { MOD } from "./palette.js";
import { askHtml } from "./ask.js";
import { reactionsHtml } from "./reactions.js";

// ---- the icon that says whether comments are showing: filled when they are, an outline when they're collapsed
export const bubble = (filled) => `<svg viewBox="0 0 16 16" width="14" height="14" aria-hidden="true"><path ${filled ? 'fill="currentColor"' : 'fill="none" stroke="currentColor" stroke-width="1.4"'} d="M2.5 2.5h11a1 1 0 0 1 1 1v7a1 1 0 0 1-1 1H8l-3 2.5V11.5H2.5a1 1 0 0 1-1-1v-7a1 1 0 0 1 1-1Z"/></svg>`;
const NOTE_ICON = `<svg viewBox="0 0 16 16" width="13" height="13" aria-hidden="true"><path fill="currentColor" d="M3 1.5h7.5L14 5v9.5a1 1 0 0 1-1 1H3a1 1 0 0 1-1-1v-12a1 1 0 0 1 1-1Zm7 1V5h2.5L10 2.5ZM4.5 8h7v1h-7V8Zm0 2.5h7v1h-7v-1Z"/></svg>`;

const keyOf = (c) => `${c.path}|${c.side}|${c.line}`;
/** Everything with a line: threads (GitHub, and your drafts), and notes; by line key, and by file. Rebuilt when any changes. */
let memo = null;
export function commentIndex(app) {
  const disc = app.graph.discussion ?? [], mine = app.state.comments, notes = app.state.notes;
  const found = (app.agentReview?.findings ?? []).filter((f) => f.status === "open");
  const asks = app.asks ?? [];
  const sig = `${asks.map((a) => a.id).join()}|${found.map((f) => f.id).join()}|${app.settings.resolved ?? "collapsed"}:${disc.length}:${disc.at(-1)?.id}:${disc.filter((c) => c.resolved).length}|${mine.map((c) => `${c.id}${c.wip ? "w" : ""}${c.kind ?? ""}${c.body.length}`).join()}|${notes.map((n) => `${n.id}${n.body.length}`).join()}`;
  if (memo?.graph === app.graph && memo.disc === disc && memo.sig === sig) return memo.idx; // disc: a new list on every read, edits too
  const me = app.me ?? {}, threads = new Map(), byKey = new Map(), byPath = new Map();
  const add = (map, k, v) => (map.get(k) ?? map.set(k, []).get(k)).push(v);
  // GitHub's comments: a reply points at the first comment of its thread
  const ids = new Set(disc.map((c) => c.id));
  for (const c of [...disc].sort((a, b) => String(a.createdAt).localeCompare(String(b.createdAt)))) {
    const root = c.replyTo && ids.has(c.replyTo) ? c.replyTo : c.id;
    let t = threads.get(root);
    if (!t) threads.set(root, (t = { id: root, kind: "gh", path: c.path, side: c.file ? "RIGHT" : c.side, line: c.file ? 0 : c.line, startLine: c.startLine, startSide: c.startSide, node: c.thread, file: !!c.file, pending: !!c.pending, items: [] }));
    t.items.push({ gid: c.id, node: c.node, author: c.author, avatar: c.avatar, body: c.body, html: c.html, url: c.url, createdAt: c.createdAt, pending: !!c.pending, reactions: c.reactions });
    if (c.resolved) t.resolved = true;
  }
  // your drafts: comments to be, so threads of their own
  for (const c of mine.filter((x) => x.kind !== "note")) {
    threads.set(`d:${c.id}`, { id: `d:${c.id}`, kind: "draft", path: c.path, side: c.side, line: c.line, startLine: c.startLine, startSide: c.startSide,
      items: [{ author: me.login ?? "you", avatar: me.avatar, body: c.body, createdAt: c.createdAt, draft: true, wip: c.wip, cid: c.id }] });
  }
  // Claude's findings (agent.js): suggestions, until you add them to your drafts or dismiss them
  for (const f of found) {
    threads.set(`a:${f.id}`, { id: `a:${f.id}`, kind: "agent", path: f.path, side: f.side, line: f.line, startLine: f.startLine, finding: f,
      items: [{ author: "Claude", body: f.body, createdAt: app.agentReview.at }] });
  }
  // your questions to Claude about lines (ask.js)
  for (const a of asks) threads.set(`q:${a.id}`, { id: `q:${a.id}`, kind: "ask", path: a.path, side: a.side, line: a.line, startLine: a.startLine, ask: a, items: [] });
  if (app.settings.resolved === "hidden") for (const [id, t] of threads) if (t.resolved) threads.delete(id); // only what's still open
  for (const t of threads.values()) { add(byKey, keyOf(t), t); add(byPath, t.path, t); }
  // private notes, and unfinished ones from the composer
  const noteList = [
    ...notes.filter((n) => n.line).map((n) => ({ id: `n:${n.id}`, nid: n.id, path: n.path, side: n.side ?? "RIGHT", line: n.line, startLine: n.startLine, body: n.body, createdAt: n.createdAt })),
    ...mine.filter((c) => c.kind === "note").map((c) => ({ id: `n:${c.id}`, cid: c.id, wip: true, path: c.path, side: c.side, line: c.line, startLine: c.startLine, body: c.body, createdAt: c.createdAt })),
  ];
  const notesByKey = new Map();
  for (const n of noteList) { add(notesByKey, keyOf(n), n); add(byPath, n.path, { ...n, note: true }); }
  memo = { graph: app.graph, disc, sig, idx: { byKey, notesByKey, byPath, threads } };
  return memo.idx;
}

// ---- collapsed or open: a thread's own choice, else its file's, else the PR's (the setting). A resolved thread starts
// collapsed whatever the file and PR say, as on GitHub: done with, until you open it.
const pageState = (app) => (app.commentState ??= { files: new Map(), items: new Map() }); // while the page is open, across focus changes
const prState = (app) => app.settings.comments ?? "open";
export const fileState = (app, path) => pageState(app).files.get(path) ?? prState(app);
const itemOpen = (app, id, path) => (pageState(app).items.get(id) ?? (commentIndex(app).threads.get(id)?.resolved ? "collapsed" : fileState(app, path))) === "open";
/** Re-renders after a comment change without moving what you're reading: each visible code scroller keeps the thread
 *  you clicked (if it's in it), else its first line on screen, where it was. */
export function keepPlace(app, clicked) {
  const scrollerOf = (n) => { for (let e = n; e && e !== document.body; e = e.parentElement) if (e.scrollHeight > e.clientHeight + 1 && /auto|scroll/.test(getComputedStyle(e).overflowY)) return e; return null; };
  const marks = [];
  for (const sc of new Set([...document.querySelectorAll("[data-bound]")].filter(live).map((b) => scrollerOf(b) ?? b))) {
    const box = sc.getBoundingClientRect(), k = sc.clientHeight / (box.height || 1); // on-screen px to the scroller's own (zoom)
    const thread = clicked?.closest("[data-thread]"); // the thread's own top edge, open or collapsed
    const anchor = (thread && sc.contains(thread) && thread)
      || [...sc.querySelectorAll(".ln[data-key]")].find((r) => r.getBoundingClientRect().bottom > box.top + 1);
    if (!anchor) continue;
    const sel = anchor.matches(".ln") ? `.ln[data-key="${CSS.escape(anchor.dataset.key)}"]` : `[data-thread="${CSS.escape(anchor.dataset.thread)}"]`;
    marks.push({ sc, k, sel, top: anchor.getBoundingClientRect().top - box.top, scrollTop: sc.scrollTop });
  }
  app.emit("comments");
  for (const m of marks) {
    const now = m.sc.querySelector(m.sel);
    if (!now) { m.sc.scrollTop = m.scrollTop; continue; }
    m.sc.scrollTop += (now.getBoundingClientRect().top - m.sc.getBoundingClientRect().top - m.top) * m.k;
  }
}
/** Collapses or opens one thread or note; a broader choice later replaces it. */
export function toggleItem(app, id, path, clicked) {
  pageState(app).items.set(id, itemOpen(app, id, path) ? "collapsed" : "open");
  keepPlace(app, clicked);
}
/** Every comment and note in a file, collapsed or opened together. */
export function toggleFile(app, path) {
  const s = pageState(app), next = fileState(app, path) === "open" ? "collapsed" : "open";
  s.files.set(path, next);
  for (const id of [...s.items.keys()]) if (commentIndex(app).byPath.get(path)?.some((x) => x.id === id)) s.items.delete(id);
  keepPlace(app);
}
/** Every comment in the PR: saved as the default (settings.comments), and the files' and threads' own choices cleared. */
export function togglePR(app) {
  const s = pageState(app);
  s.files.clear(); s.items.clear();
  app.settings.comments = prState(app) === "open" ? "collapsed" : "open"; // now, so the redraw below already uses it
  keepPlace(app);
  app.saveSettings({ comments: app.settings.comments });
}
/** Resolves or unresolves a thread on GitHub, at once, as its button there does. A resolved thread then collapses, as
 *  it starts out; an unresolved one goes back to what its file shows. */
export async function resolveThread(app, node, resolved, clicked) {
  const t = [...commentIndex(app).threads.values()].find((x) => x.node === node);
  clicked.disabled = true;
  try {
    const r = await api("/api/thread", { thread: node, resolved });
    if (!r.ok) throw new Error(r.error);
    app.graph.discussion = r.comments;
    app.graph.outdated = r.outdated;
    if (t) pageState(app).items.delete(t.id);
    keepPlace(app, clicked);
  } catch (e) {
    clicked.disabled = false;
    app.toast?.(`<span>Couldn't ${resolved ? "resolve" : "unresolve"} it: ${esc(e.message)}</span>`, 8000);
  }
}
// ---- replying in place, under the thread: posted at once, as GitHub's Reply in a thread is. The box's text lives here
// while the page is open, so a re-render (a poll, a mark) rebuilds it as it was.
const replies = (app) => (pageState(app).replies ??= new Map()); // thread id (its first comment's) → text so far
const replyBox = (id) => [...document.querySelectorAll(`textarea[data-rbox="${CSS.escape(id)}"]`)].find(live);
export function startReply(app, id, clicked) {
  if (!replies(app).has(id)) replies(app).set(id, "");
  keepPlace(app, clicked);
  replyBox(id)?.focus({ preventScroll: true });
}
export const typeReply = (app, id, text) => replies(app).set(id, text);
/** Closes a reply box; what's in it is dropped only on Cancel, or when there's nothing in it. */
export function closeReply(app, id, clicked, drop = true) {
  if (drop || !replies(app).get(id)?.trim()) { replies(app).delete(id); keepPlace(app, clicked); }
  else document.activeElement?.blur();
}
export async function postReply(app, id, clicked) {
  const body = replies(app).get(id)?.trim();
  if (!body) return replyBox(id)?.focus();
  const btn = clicked.matches("button") ? clicked : clicked.closest(".creply")?.querySelector("[data-rpost]");
  if (btn) { btn.disabled = true; btn.textContent = "Posting…"; }
  try {
    const r = await api("/api/conversation/reply", { body, to: id });
    if (!r.ok) throw new Error(r.error);
    replies(app).delete(id);
    const d = await api("/api/discussion"); // the server re-read it: the reply, with GitHub's id and rendering
    app.graph.discussion = d.comments;
    app.graph.outdated = d.outdated ?? [];
    keepPlace(app, clicked);
  } catch (e) {
    if (btn) { btn.disabled = false; btn.textContent = "Reply"; }
    app.toast?.(`<span>Couldn't post the reply: ${esc(e.message)}</span>`, 8000);
  }
}
// ---- unresolved threads: GitHub's, on lines and outdated, in walk order; their count in the bar, N to go through them
/** The unresolved threads in files on screen: on a line (with the page that shows it), then the outdated ones. */
export function unresolved(app) {
  const pos = (pid) => app.index.walkPos.get(pid) ?? Infinity;
  const on = [...commentIndex(app).threads.values()].filter((t) => t.kind === "gh" && !t.resolved && !t.pending && !t.file && shown(app, t.path))
    .map((t) => ({ id: t.id, path: t.path, line: t.line, pid: app.pidAt(t.path, t.line) })).filter((x) => x.pid)
    .sort((a, b) => pos(a.pid) - pos(b.pid) || a.line - b.line);
  const gone = (app.graph.outdated ?? []).filter((t) => !t.resolved && shown(app, t.path)).map((t) => ({ id: t.id, path: t.path, outdated: true }));
  return [...on, ...gone];
}
/** `N`: the next unresolved thread after the last one it went to (else the first at or after where you are), open and
 *  in view; an outdated one opens in the Conversation view. Wraps around. False when there are none. */
export function nextUnresolved(app) {
  const list = unresolved(app), s = pageState(app);
  if (!list.length) return false;
  const was = list.findIndex((x) => x.id === s.lastUnresolved), here = app.index.walkPos.get(app.focus) ?? -1;
  const t = was >= 0 ? list[(was + 1) % list.length] : list.find((x) => !x.outdated && app.index.walkPos.get(x.pid) >= here) ?? list[0];
  s.lastUnresolved = t.id;
  if (t.outdated) { app.convTarget = t.id; app.switchView("conversation"); return true; }
  if (app.settings.view === "conversation") app.switchView("diff");
  s.items.set(t.id, "open");
  app.setFocus(t.pid, { level: 2 });
  app.emit("comments");
  setTimeout(() => { // once the view has drawn it
    const el = [...document.querySelectorAll(`.cthread[data-thread="${CSS.escape(t.id)}"]`)].find(live);
    if (!el) return;
    el.scrollIntoView({ block: "center", behavior: "smooth" });
    el.classList.remove("cflash"); void el.offsetWidth; el.classList.add("cflash");
  }, 60);
  return true;
}
// ---- your own comments already on GitHub: edit them in place, or delete them (a second click, as it can't be undone)
const edits = (app) => (pageState(app).edits ??= new Map()); // comment id → its text as you edit it
const editBox = (gid) => [...document.querySelectorAll(`textarea[data-gedit="${CSS.escape(gid)}"]`)].find(live);
function landed(app, r, clicked) { app.graph.discussion = r.comments; app.graph.outdated = r.outdated ?? []; keepPlace(app, clicked); }
export function startEdit(app, gid, clicked) {
  const c = (app.graph.discussion ?? []).find((x) => x.id === gid);
  if (!c) return;
  edits(app).set(gid, c.body);
  keepPlace(app, clicked);
  const b = editBox(gid);
  if (b) { b.focus({ preventScroll: true }); b.setSelectionRange(b.value.length, b.value.length); }
}
export const typeEdit = (app, gid, text) => edits(app).set(gid, text);
export function cancelEdit(app, gid, clicked) { edits(app).delete(gid); keepPlace(app, clicked); }
export async function saveEdit(app, gid, clicked) {
  const body = edits(app).get(gid)?.trim();
  if (!body) return editBox(gid)?.focus();
  const btn = clicked.closest(".cedit")?.querySelector("[data-gesave]");
  if (btn) { btn.disabled = true; btn.textContent = "Saving…"; }
  try {
    const r = await api("/api/posted/edit", { kind: "review", id: gid, body });
    if (!r.ok) throw new Error(r.error);
    edits(app).delete(gid);
    landed(app, r, clicked);
  } catch (e) {
    if (btn) { btn.disabled = false; btn.textContent = "Save"; }
    app.toast?.(`<span>Couldn't save it: ${esc(e.message)}</span>`, 8000);
  }
}
export async function deletePosted(app, gid, clicked) {
  const s = pageState(app);
  if (s.confirm !== gid) { // first click: ask; it stops asking after a few seconds
    s.confirm = gid;
    keepPlace(app, clicked);
    clearTimeout(s.confirmTimer);
    s.confirmTimer = setTimeout(() => { if (s.confirm === gid) { s.confirm = null; app.emit("comments"); } }, 4000);
    return;
  }
  s.confirm = null;
  try {
    const r = await api("/api/posted/delete", { kind: "review", id: gid });
    if (!r.ok) throw new Error(r.error);
    landed(app, r, clicked);
  } catch (e) {
    keepPlace(app, clicked);
    app.toast?.(`<span>Couldn't delete it: ${esc(e.message)}</span>`, 8000);
  }
}
/** Shows a long comment in full, and remembers it while the page is open. */
export function showFull(app, ck, clicked) { pageState(app).full = (pageState(app).full ?? new Set()).add(ck); keepPlace(app, clicked); }
/** What the comment state of a file is, for knowing when to redraw it. */
export const fileStamp = (app, path) => `${fileState(app, path)}:${pageState(app).full?.size ?? 0}:${[...(pageState(app).edits?.keys() ?? [])].join()}:${pageState(app).confirm ?? ""}:${(commentIndex(app).byPath.get(path) ?? []).map((x) => (itemOpen(app, x.id, path) ? 1 : 0) + (pageState(app).replies?.has(x.id) ? "r" : "") + reacted(x)).join("")}`;
const reacted = (t) => (t.items ?? []).map((i) => (i.reactions ?? []).map((r) => `${r.content}${r.count}${r.mine ? "!" : ""}`).join()).join("/");
/** A comment's reactions changed (reactions.js): kept in the discussion, and its file redrawn where it is. */
export function setReactions(app, node, reactions, clicked) {
  app.graph.discussion = (app.graph.discussion ?? []).map((c) => (c.node === node ? { ...c, reactions } : c));
  keepPlace(app, clicked);
}
export const fileCount = (app, path) => (commentIndex(app).byPath.get(path) ?? []).reduce((n, x) => n + (x.items?.length ?? 1), 0);
/** The PR's comments and notes in files on screen: one hidden by Tests or Unchanged isn't counted, as its comments aren't shown. */
export const prCount = (app) => [...commentIndex(app).byPath].filter(([path]) => !path || shown(app, path)).flatMap(([, xs]) => xs).filter((x) => x.kind !== "agent" && x.kind !== "ask").reduce((n, x) => n + (x.items?.length ?? 1), 0);
const shown = (app, path) => app.filePages(path).length > 0 || app.hunksOf(LOW).some((h) => h.file === path);

// ---- threads
const avatar = (a) => `<img class="cav" src="/api/avatar?u=${encodeURIComponent(a.avatar ?? a.author)}" alt="" loading="lazy" onerror="this.style.visibility='hidden'">`;
const range = (t) => t.startLine && t.startLine !== t.line ? `<span class="crange">L${t.startLine}–L${t.line}</span>` : "";
/** A file's comments on the whole of it: on line 0, which no row has, so they're drawn at the top of the file. */
export const fileKey = (path) => `${path}|RIGHT|0`;
/** The threads anchored on a line, as HTML. */
export function threadsAt(app, key) {
  return (commentIndex(app).byKey.get(key) ?? []).map((t) => threadHtml(app, t)).join("");
}
function threadHtml(app, t) {
  if (t.kind === "agent") return findingHtml(app, t);
  if (t.kind === "ask") return askHtml(app, { ...t, ask: (app.asks ?? []).find((a) => `q:${a.id}` === t.id) ?? t.ask }, itemOpen(app, t.id, t.path));
  const open = itemOpen(app, t.id, t.path), first = t.items[0], n = t.items.length;
  if (!open) { // in place, one line: who, how many, and how it starts
    const faces = [...new Map(t.items.map((i) => [i.author, i])).values()].slice(0, 3).map(avatar).join("");
    return `<div class="cthread slim${t.kind === "draft" ? " draft" : ""}${t.resolved ? " resolved" : ""}" data-thread="${esc(t.id)}" data-tid="${esc(t.id)}" data-tpath="${esc(t.path)}" title="Show ${n > 1 ? "this thread" : "this comment"}">
      <span class="cfaces">${faces}</span><b>${esc(first.author)}</b>${t.kind === "draft" ? `<span class="ctag">${first.wip ? "unfinished" : "draft"}</span>` : ""}${t.pending ? PENDING : ""}${t.resolved ? `<span class="ctag">resolved</span>` : ""}
      <span class="cprev">${esc(plain(first.body))}</span>${n > 1 ? `<span class="cn">${n} comments</span>` : ""}${bubble(false)}</div>`;
  }
  const s = pageState(app), mine = (i) => i.gid && app.me?.login && i.author === app.me.login;
  const own = (i) => !mine(i) || s.edits?.has(i.gid) ? "" : `<button class="cact" data-geopen="${esc(i.gid)}" title="Edit your comment on GitHub">Edit</button><button class="cact${s.confirm === i.gid ? " sure" : ""}" data-gedel="${esc(i.gid)}" title="Delete your comment from GitHub">${s.confirm === i.gid ? "Delete it? Click again" : "Delete"}</button>`;
  const body = (i, k) => s.edits?.has(i.gid)
    ? `<div class="cedit"><textarea data-gedit="${esc(i.gid)}">${esc(s.edits.get(i.gid))}</textarea><div class="crow"><span class="chint">${MOD}↵ saves · esc cancels</span><span class="cgrow"></span><button class="btn" data-gecancel="${esc(i.gid)}">Cancel</button><button class="btn primary" data-gesave="${esc(i.gid)}">Save</button></div></div>`
    : `<div class="cbody${i.html && !sug(i) ? " gh" : ""}" data-ck="${esc(t.id)}:${k}">${sug(i) ? md(i.body, { orig: sug(i) }) : i.html ? ghHtml(i.html) : md(i.body)}</div>`;
  // a suggested change on new lines: drawn here as before and after, from the diff (GitHub's own rendering loses it)
  const sug = (i) => (t.side === "RIGHT" && /```suggestion\b/.test(i.body ?? "") && newLines(app, t.path, t.startLine ?? t.line, t.line)) || null;
  const items = t.items.map((i, k) => `<div class="citem">${avatar(i)}<div class="cmain">
      <div class="cwho"${k === 0 ? ` data-tid="${esc(t.id)}" data-tpath="${esc(t.path)}" title="Collapse${n > 1 ? " this thread" : ""}"` : ""}><b>${esc(i.author)}</b>${i.draft ? `<span class="ctag">${i.wip ? "unfinished draft" : "draft"}</span>` : ""}${i.pending ? PENDING : ""}<span class="cwhen" title="${esc(i.createdAt ?? "")}">${ago(i.createdAt)}</span>
        ${k === 0 ? range(t) : ""}${k === 0 && t.resolved ? `<span class="ctag">resolved</span>` : ""}${i.url ? `<a class="clink" href="${esc(i.url)}" target="_blank" rel="noopener" title="Open on GitHub">↗</a>` : ""}<span class="cgrow"></span>
        ${i.wip ? `<button class="cact" data-wip="${esc(i.cid)}" title="Open it again to finish">Continue</button>` : ""}${i.cid ? `<button class="cact" data-del="${esc(i.cid)}" title="Discard this draft">Delete</button>` : ""}${own(i)}
        ${k === 0 ? `<button class="cfold" data-tid="${esc(t.id)}" data-tpath="${esc(t.path)}" title="Collapse${n > 1 ? " this thread" : ""}">${bubble(true)}</button>` : ""}</div>
      ${body(i, k)}${i.gid && !i.pending && !s.edits?.has(i.gid) ? reactionsHtml(i.node, i.reactions) : ""}</div></div>`).join("");
  // GitHub's own footer: a reply, posted at once; and done with it (it collapses, for everyone), or not done after all
  const resolve = t.node ? `<button class="cbtn" data-resolve="${esc(t.node)}" data-to="${t.resolved ? "0" : "1"}">${t.resolved ? "Unresolve conversation" : "Resolve conversation"}</button>` : "";
  const text = replies(app).get(t.id);
  const foot = t.kind !== "gh" || t.pending ? "" : text != null
    ? `<div class="creply">${avatar({ author: app.me?.login ?? "", avatar: app.me?.avatar })}<div class="cmain"><textarea data-rbox="${esc(t.id)}" placeholder="Reply…">${esc(text)}</textarea>
        <div class="crow"><span class="chint">${MOD}↵ posts · esc closes</span><span class="cgrow"></span><button class="btn" data-rcancel="${esc(t.id)}">Cancel</button><button class="btn primary" data-rpost="${esc(t.id)}">Reply</button></div></div></div>`
    : `<div class="ctfoot"><button class="creplyb" data-rstart="${esc(t.id)}">Reply…</button>${resolve}</div>`;
  return `<div class="cthread${t.kind === "draft" ? " draft" : ""}${t.resolved ? " resolved" : ""}" data-thread="${esc(t.id)}">${items}${foot}</div>`;
}

const PENDING = `<span class="ctag pend" title="In your review on GitHub that isn't submitted yet: only you see it, until you submit (from here or GitHub)">pending</span>`;
const SEVERITY = { bug: "Bug", risk: "Risk", question: "Question", nit: "Nit" };
/** One of Claude's findings: its problem, its comment as it would be posted, and the choice of adding it or not. */
function findingHtml(app, t) {
  const f = t.finding, id = esc(t.id), sev = `<span class="ctag sev-${esc(f.severity)}">${SEVERITY[f.severity] ?? esc(f.severity)}</span>`;
  if (!itemOpen(app, t.id, t.path)) return `<div class="cthread slim agent" data-thread="${id}" data-tid="${id}" data-tpath="${esc(t.path)}" title="Show Claude's finding">
    <span class="cfaces"><span class="cav agav">✦</span></span><b>Claude</b>${sev}<span class="cprev">${esc(f.title)}</span>${bubble(false)}</div>`;
  return `<div class="cthread agent" data-thread="${id}"><div class="citem"><span class="cav agav" aria-hidden="true">✦</span><div class="cmain">
      <div class="cwho" data-tid="${id}" data-tpath="${esc(t.path)}" title="Collapse"><b>Claude</b><span class="ctag">suggestion</span>${sev}${range(t)}<span class="cgrow"></span>
        <button class="cfold" data-tid="${id}" data-tpath="${esc(t.path)}" title="Collapse">${bubble(true)}</button></div>
      <div class="ftitle">${esc(f.title)}</div>
      <div class="cbody" data-ck="${id}:0">${md(f.body)}</div></div></div>
    <div class="ctfoot"><button class="cbtn primary" data-afind="${esc(f.id)}" data-aact="draft" title="Add it to your review as a draft comment: edit it there, and it's posted when you submit">Add to review</button><button class="cbtn" data-afind="${esc(f.id)}" data-aact="dismiss">Dismiss</button><span class="chint">only you see it</span></div></div>`;
}

// ---- notes: floating beside their line, over the code's right edge; collapsed to an icon
/** The notes on the lines of a code box (keys: the line keys it shows), as HTML for its note layer. */
export function notesFor(app, keys) {
  const idx = commentIndex(app);
  return keys.flatMap((k) => idx.notesByKey.get(k) ?? []).map((n) => {
    if (!itemOpen(app, n.id, n.path)) return `<button class="fnote slim" data-thread="${esc(n.id)}" data-tid="${esc(n.id)}" data-tpath="${esc(n.path)}" data-at="${esc(keyOf(n))}" title="Your private note: ${esc(plain(n.body))}">${NOTE_ICON}</button>`;
    return `<div class="fnote${n.wip ? " wip" : ""}" data-thread="${esc(n.id)}" data-at="${esc(keyOf(n))}">
      <div class="fnhead" data-tid="${esc(n.id)}" data-tpath="${esc(n.path)}" title="Collapse">${NOTE_ICON}<span>${n.wip ? "unfinished note" : "private note"}${n.startLine && n.startLine !== n.line ? ` · L${n.startLine}–L${n.line}` : ""}</span><span class="cwhen">${ago(n.createdAt)}</span><span class="cgrow"></span>
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
// One on the old side (GitHub's LEFT) counts where its line is in the new file: old + shift, the hunks above having added
// shift lines. Returned with line and startLine in new-file numbers, for how far to open.
export function outside(app, path, from, to, shift = 0) {
  return (commentIndex(app).byPath.get(path) ?? []).flatMap((x) => {
    const at = (l, side) => (l == null ? l : side === "LEFT" ? l + shift : l);
    const line = at(x.line, x.side);
    return line >= from && line <= to ? [{ ...x, line, ...(x.startLine ? { startLine: at(x.startLine, x.startSide ?? x.side) } : {}) }] : [];
  });
}

// ---- a comment's text: GitHub-flavoured Markdown, the safe part of it. Everything is escaped first; a few plain tags
// (details, summary, b, i, code, br…) come back without attributes, and links only to http(s).
export function md(src, ctx = null) {
  const blocks = [];
  let text = String(src ?? "").replace(/\r\n/g, "\n").replace(/```(\w*)\n([\s\S]*?)```/g, (_, lang, code) => {
    if (lang === "suggestion" && ctx?.orig) { blocks.push(suggestionHtml(ctx.orig, code)); return `\u0000${blocks.length - 1}\u0000`; }
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
    // Claude's references to code (refs.ts): open in the code viewer
    .replace(/\[([^\]\n]+)\]\(ref:\/\/(head|base)\/([^#)\s]+)#L(\d+)(?:-L(\d+))?\)/g, (_, label, side, enc, a, b) => {
      const path = enc.split("/").map((x) => { try { return decodeURIComponent(x); } catch { return x; } }).join("/");
      return `<a class="cref" href="#" data-rside="${side}" data-rpath="${esc(path)}" data-rline="${a}"${b ? ` data-rend="${b}"` : ""} title="${esc(path)}:${a}${b ? `–${b}` : ""}${side === "base" ? ", before the PR" : ""}">${label}</a>`;
    })
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
/** A suggested change as GitHub shows it: the lines as they are, then as suggested (none: they'd be deleted). */
function suggestionHtml(orig, code) {
  const now = code.replace(/\n$/, ""), next = now === "" ? [] : now.split("\n");
  const row = (k, l) => `<div class="${k}"><span>${k === "d" ? "−" : "+"}</span>${esc(l) || " "}</div>`;
  return `<div class="csug">Suggested change</div><div class="csugd">${orig.map((l) => row("d", l)).join("")}${next.map((l) => row("a", l)).join("")}</div>`;
}
/** The new-side text of lines from..to of a file: from the diff's hunks, else from more (the whole file, if loaded);
 *  null when any is unknown. For a suggestion's "as they are". */
export function newLines(app, path, from, to, more = null) {
  const at = new Map();
  for (const h of app.graph.hunks) if (h.file === path) for (const l of h.lines) if (l.t !== "-" && l.n != null) at.set(l.n, l.s);
  const out = [];
  for (let n = from; n <= to; n++) {
    const s = at.get(n) ?? (Array.isArray(more) ? more[n - 1] : undefined);
    if (s == null) return null;
    out.push(s);
  }
  return out;
}

// ---- a comment as GitHub rendered it (bodyHTML): already sanitized by GitHub, and cleaned again here, since it lands in
// a page that can post as you. Nothing that runs (scripts, frames, forms, on* handlers, javascript: links) and no inline
// styles; links open on GitHub's side, in a new tab; relative ones point at github.com.
const DROP = "script,style,iframe,frame,object,embed,form,link,meta,base,foreignObject,template,noscript,button,textarea,select";
const URL_ATTRS = ["href", "src", "srcset", "data-canonical-src", "action", "formaction", "xlink:href"];
export function ghHtml(html) {
  const doc = new DOMParser().parseFromString(String(html ?? ""), "text/html");
  doc.body.querySelectorAll(DROP).forEach((e) => e.remove());
  doc.body.querySelectorAll("a.anchor, .octicon-link").forEach((e) => e.remove()); // headings' hover links
  for (const e of doc.body.querySelectorAll("*")) {
    for (const a of [...e.attributes]) {
      const n = a.name.toLowerCase();
      if (n.startsWith("on") || n === "style" || n === "id" || n === "name" || n === "class" && !/^(?:highlight|pl-|task-list|contains-task-list)/.test(a.value)) e.removeAttribute(a.name);
      else if (URL_ATTRS.includes(n)) {
        const v = a.value.trim().split(/\s+/)[0];
        if (/^(https?:|mailto:|#)/i.test(v)) continue;
        if (v.startsWith("/")) e.setAttribute(a.name, `https://github.com${a.value.trim()}`);
        else e.removeAttribute(a.name);
      }
    }
    if (e.tagName === "A") { e.setAttribute("target", "_blank"); e.setAttribute("rel", "noopener noreferrer"); }
    if (e.tagName === "INPUT") e.setAttribute("disabled", ""); // a task list's checkbox: shown, not ticked from here
    if (e.tagName === "IMG") e.setAttribute("loading", "lazy");
  }
  return doc.body.innerHTML;
}

/** A comment's first words, for a collapsed thread. */
const plain = (s) => String(s ?? "").replace(/```[\s\S]*?```/g, "[code]").replace(/<[^>]+>/g, "").replace(/[*_`#>]/g, "").replace(/\s+/g, " ").trim().slice(0, 140);
export function ago(when) {
  const t = Date.parse(when ?? "");
  if (!t) return "";
  const s = (Date.now() - t) / 1000;
  return s < 60 ? "just now" : s < 3600 ? `${Math.floor(s / 60)}m ago` : s < 86400 ? `${Math.floor(s / 3600)}h ago` : s < 30 * 86400 ? `${Math.floor(s / 86400)}d ago` : new Date(t).toLocaleDateString();
}
