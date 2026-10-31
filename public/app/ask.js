// Asking Claude about some lines (ask.ts): the ✦ in a selection's popover, or `q`, opens the box as Ask Claude; the
// question and Claude's answer then sit on those lines as a thread of their own, the answer filling in as it's written.
// Ask a follow-up under it; turn the answer into a comment (a draft, to edit), or keep the exchange as a private note.
import { api, esc, live } from "./core.js";
import { bubble, keepPlace, md } from "./comments.js";
import { MOD } from "./palette.js";

/** Starters for the box, as chips: a click asks it. */
export const STARTERS = ["Explain what this does", "What could break here?", "Is this tested?", "Review these lines"];

let loaded = false, wasAsking = false;
const follow = new Map(); // ask id → a follow-up being written, kept across redraws
/** From each status poll: fetches the asks once, then while any is being answered, and updates their threads in place.
 *  True while one is (poll quickly). */
export async function askPoll(app, s) {
  const asking = s.asking > 0;
  if (loaded && !asking && !wasAsking) return false;
  wasAsking = asking;
  const r = await api("/api/asks").catch(() => null);
  if (!r) return asking;
  const before = new Map((app.asks ?? []).map((a) => [a.id, sig(a)]));
  const running = new Set((app.asks ?? []).filter((a) => a.running).map((a) => a.id));
  app.asks = r.asks;
  if (!loaded) { loaded = true; keepPlace(app); return asking; }
  for (const a of app.asks) if (before.get(a.id) !== sig(a)) redraw(app, a);
  for (const a of app.asks) if (running.has(a.id) && !a.running && a.turns.at(-1)?.error !== "Stopped" && !onScreen(a)) notify(app, a);
  return asking;
}
const sig = (a) => `${a.turns.length}:${a.running ? 1 : 0}:${a.step ?? ""}:${a.partial?.length ?? 0}:${a.turns.at(-1)?.a?.length ?? 0}:${a.turns.at(-1)?.error ?? ""}`;
/** Redraws an ask's thread where it's showing, without redrawing its file (an answer streams in many small steps). */
function redraw(app, a) {
  const els = [...document.querySelectorAll(`.cthread[data-thread="q:${CSS.escape(a.id)}"]`)].filter(live);
  if (!els.length) return keepPlace(app);
  const typing = document.activeElement?.matches?.(`textarea[data-qbox="${CSS.escape(a.id)}"]`);
  for (const el of els) el.outerHTML = askHtml(app, { id: `q:${a.id}`, path: a.path, ask: a }, !el.classList.contains("slim"));
  if (typing) [...document.querySelectorAll(`textarea[data-qbox="${CSS.escape(a.id)}"]`)].find(live)?.focus({ preventScroll: true });
}

/** Asks Claude about the lines in sel (the composer's: path, side, line, start). */
export async function askAbout(app, sel, question) {
  const r = await api("/api/ask", { path: sel.path, side: sel.side, line: Number(sel.line), ...(sel.start ? { startLine: Number(sel.start.line) } : {}), question })
    .catch((e) => ({ ok: false, error: e.message }));
  if (!r.ok) return app.toast?.(`<span>Couldn't ask Claude: ${esc(r.error)}</span>`, 8000);
  (app.asks ??= []).push(r.ask);
  wasAsking = true;
  keepPlace(app);
  app.watchServers?.();
}
export async function askFollowUp(app, id, question) {
  if (!question.trim()) return;
  const r = await api("/api/ask", { id, question }).catch((e) => ({ ok: false, error: e.message }));
  if (!r.ok) return app.toast?.(`<span>Couldn't ask Claude: ${esc(r.error)}</span>`, 8000);
  follow.delete(id);
  app.asks = (app.asks ?? []).map((a) => (a.id === id ? r.ask : a));
  wasAsking = true;
  redraw(app, r.ask);
  app.watchServers?.();
}
export const typeFollowUp = (id, text) => follow.set(id, text);
export const stopAsk = (app, id) => api("/api/ask/stop", { id }).then(() => app.watchServers?.());
export async function deleteAsk(app, id) {
  await api(`/api/ask/${id}`, null, "DELETE").catch(() => null);
  app.asks = (app.asks ?? []).filter((a) => a.id !== id);
  keepPlace(app);
}
// ---- answered while you were elsewhere: a notice in the bottom-right corner, until you look or dismiss it
const threadEls = (a) => [...document.querySelectorAll(`.cthread[data-thread="q:${CSS.escape(a.id)}"]`)].filter(live);
/** Whether you can see the answer now: the tab in front and the thread open, at least partly on screen. */
function onScreen(a) {
  if (document.hidden) return false;
  return threadEls(a).some((el) => {
    if (el.classList.contains("slim")) return false;
    const r = el.getBoundingClientRect();
    return r.bottom > 80 && r.top < innerHeight - 60;
  });
}
const SHOWN_MS = 30_000; // counted only while the tab is in front
function notify(app, a) {
  const box = document.getElementById("notices");
  if (!box) return;
  box.querySelector(`[data-qnote="${CSS.escape(a.id)}"]`)?.remove();
  const turn = a.turns.at(-1), failed = !!turn?.error;
  const el = document.createElement("div");
  el.className = `qnote${failed ? " err" : ""}`;
  el.dataset.qnote = a.id;
  el.setAttribute("role", "status");
  el.innerHTML = `<span class="cav agav" aria-hidden="true">✦</span><b>${failed ? "Claude couldn't answer" : "Claude answered"}</b>
    <button class="x" aria-label="Dismiss">✕</button><span class="qn-q" title="${esc(turn?.q ?? "")}">${esc(turn?.q ?? "")}</span>
    <span class="qn-at">${esc(a.path.split("/").pop())}:${a.startLine ? `${a.startLine}–` : ""}${a.line}</span>
    <div class="qn-acts"><button class="cbtn primary" data-show>Show answer</button></div>`;
  el.querySelector(".x").onclick = () => el.remove();
  el.querySelector("[data-show]").onclick = () => { el.remove(); showAsk(app, a.id); };
  box.append(el);
  while (box.children.length > 3) box.firstElementChild.remove(); // the three newest
  const later = () => setTimeout(() => (document.hidden ? later() : el.remove()), SHOWN_MS);
  later();
  if (document.hidden && !document.title.startsWith("✦ ")) {
    document.title = `✦ ${document.title}`;
    document.addEventListener("visibilitychange", () => { document.title = document.title.replace(/^✦ /, ""); }, { once: true });
  }
}
/** Goes to an ask's thread: its page, the thread open, centred and flashed. */
export function showAsk(app, id) {
  const a = askById(app, id);
  if (!a) return;
  document.querySelector(`#notices [data-qnote="${CSS.escape(id)}"]`)?.remove();
  const pid = app.pidAt(a.path, a.line);
  if (!pid) return app.toast?.("<span>Those lines are hidden by a filter (Tests, Generated or Unchanged).</span>", 5000);
  const mine = (els) => els.find((el) => el.closest(".dfocus")) ?? els[0]; // the focused page's, not the canvas behind it
  const reveal = (tries = 0) => {
    const els = threadEls(a), open = mine(els.filter((el) => !el.classList.contains("slim")));
    if (!open && tries < 3) { mine(els)?.click(); return setTimeout(() => reveal(tries + 1), 80); } // collapsed, or not drawn yet
    if (!open) return;
    open.scrollIntoView({ block: "center", behavior: "smooth" });
    open.classList.remove("cflash"); void open.offsetWidth; open.classList.add("cflash");
  };
  if (app.focus !== pid || app.level !== 2) app.setFocus(pid, { level: 2 });
  app.emit("comments");
  setTimeout(reveal, 80);
}
export const askById = (app, id) => (app.asks ?? []).find((a) => a.id === id);

/** An ask's thread: each question and its answer, then a follow-up box (or, while it's answering, what Claude is doing). */
export function askHtml(app, t, open = true) {
  const a = t.ask, id = esc(a.id), me = app.me;
  const range = a.startLine ? `L${a.startLine}–L${a.line}` : `L${a.line}`;
  if (!open) return `<div class="cthread slim ask" data-thread="q:${id}" data-tid="q:${id}" data-tpath="${esc(a.path)}" title="Show your question to Claude">
    <span class="cfaces"><span class="cav agav">✦</span></span><b>You asked Claude</b><span class="cprev">${esc(a.turns.at(-1)?.q ?? "")}</span>${a.running ? `<span class="ctag">answering…</span>` : ""}${bubble(false)}</div>`;
  const face = me ? `<img class="cav" src="/api/avatar?u=${encodeURIComponent(me.avatar ?? me.login)}" alt="" onerror="this.style.visibility='hidden'">` : `<span class="cav"></span>`;
  const last = a.turns.length - 1, answered = a.turns.some((x) => x.a);
  const turns = a.turns.map((x, k) => {
    const live = k === last && a.running;
    const ans = live ? (a.partial ? `<div class="cbody qa">${md(a.partial)}<span class="qcaret"></span></div>` : `<div class="qstep">${esc(a.step ?? "Starting")}…</div>`)
      : x.a ? `<div class="cbody qa">${md(x.a)}</div>` : "";
    return `<div class="qturn"><div class="qq">${face}<div>${esc(x.q)}</div></div>
      <div class="qans"><span class="cav agav" aria-hidden="true">✦</span><div class="cmain">${ans}${x.error && x.error !== "Stopped" ? `<p class="cs-err">${esc(x.error)}</p>` : x.error ? `<p class="qstopped">Stopped</p>` : ""}</div></div></div>`;
  }).join("");
  const foot = a.running
    ? `<div class="ctfoot"><span class="qwait">Claude is answering</span><span class="cgrow"></span><button class="cbtn" data-qact="stop" data-qid="${id}">Stop</button></div>`
    : `<div class="qfollow"><textarea data-qbox="${id}" rows="1" placeholder="Ask a follow-up…">${esc(follow.get(a.id) ?? "")}</textarea><button class="cbtn" data-qact="follow" data-qid="${id}" title="Ask (${MOD}↵)">Ask</button></div>`;
  return `<div class="cthread ask" data-thread="q:${id}">
    <div class="cwho qhead" data-tid="q:${id}" data-tpath="${esc(a.path)}" title="Collapse"><b>✦ Claude</b><span class="crange">${a.side === "LEFT" ? "old " : ""}${range}</span><span class="cgrow"></span>
      <button class="cfold" data-tid="q:${id}" data-tpath="${esc(a.path)}" title="Collapse">${bubble(true)}</button></div>
    ${turns}${a.running ? "" : `<div class="qacts">${answered ? `<button class="cbtn" data-qact="comment" data-qid="${id}" title="Start a comment from Claude's last answer: a draft, to edit">Comment from it</button><button class="cbtn" data-qact="note" data-qid="${id}" title="Keep the questions and answers as a private note on these lines">Save as note</button>` : ""}<button class="cbtn quiet" data-qact="delete" data-qid="${id}" title="Delete this conversation">Delete</button></div>`}${foot}</div>`;
}
