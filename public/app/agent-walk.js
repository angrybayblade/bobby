// Claude's findings, one at a time: each with the code it's about, Claude's comment as it would be posted, and the
// choice of adding it to your review (as it is, or edited), dismissing it, or leaving it for later. The way through a
// review's findings, as the walk is the way through the PR: no hunting for them in the diff.
import { esc, live } from "./core.js";
import { closePeek, hlBlock, inspectorKey, inspectorOpen, langOf } from "./code.js";
import { md } from "./comments.js";
import { MOD } from "./palette.js";
import { findingAct } from "./agent.js";

const SEV = { bug: "Bug", risk: "Risk", question: "Question", nit: "Nit" };
const ORDER = { bug: 0, risk: 1, question: 2, nit: 3 };
let w = null; // { app, ids, i, editing, el, returnTo, added, dismissed }

/** Opens the walkthrough on the open findings, worst first (then in walk order), at `at` if given. */
export function openWalk(app, at = null, onNew = null) {
  const review = app.agentReview;
  if (!review) return false;
  const pos = (f) => app.index.walkPos.get(app.pidAt(f.path, f.line)) ?? Infinity;
  const open = review.findings.filter((f) => f.status === "open").sort((a, b) => ORDER[a.severity] - ORDER[b.severity] || pos(a) - pos(b) || a.line - b.line);
  if (!open.length) return false;
  close();
  w = { app, onNew, ids: open.map((f) => f.id), i: Math.max(0, open.findIndex((f) => f.id === at)), editing: null, added: 0, dismissed: 0, returnTo: document.activeElement };
  w.el = Object.assign(document.createElement("div"), { className: "aw-overlay" });
  w.el.addEventListener("click", onClick);
  w.el.addEventListener("keydown", onKey);
  document.body.append(w.el);
  draw();
  return true;
}
document.addEventListener("bobby:leave-overlays", () => close()); // a reference shown in the diff

function close() {
  if (!w) return;
  w.el.remove();
  if (w.returnTo?.isConnected) w.returnTo.focus({ preventScroll: true });
  w = null;
}
const finding = (id) => w.app.agentReview?.findings.find((f) => f.id === id);

function draw() {
  const f = w.i < w.ids.length ? finding(w.ids[w.i]) : null;
  const n = w.ids.length, review = w.app.agentReview;
  const dots = w.ids.map((id, k) => { const s = finding(id)?.status; return `<i class="${k === w.i ? "on" : ""} ${s === "drafted" ? "added" : s === "dismissed" ? "gone" : ""}"></i>`; }).join("");
  const head = `<header><b>✦ Claude's review</b><span class="aw-n">${f ? `${w.i + 1} of ${n}` : "Done"}</span><span class="aw-dots" aria-hidden="true">${dots}</span><span class="cgrow"></span>${w.onNew ? `<button class="aw-new" data-aw="new" title="Ask Claude for a new review, about something in particular">New review…</button>` : ""}<button class="aw-x" data-aw="close" title="Close (esc)">✕</button></header>`;
  if (!f) {
    w.el.innerHTML = `<div class="aw" role="dialog" aria-modal="true" aria-label="Claude's review" tabindex="-1">${head}<div class="aw-done">
      <p>That's all ${n === 1 ? "of it" : `${n} of them`}${w.added || w.dismissed ? `: ${[w.added && `${w.added} added to your review`, w.dismissed && `${w.dismissed} dismissed`].filter(Boolean).join(", ")}` : ""}.</p>
      ${w.added ? `<p class="aw-muted">They're drafts now: edit them in place, and they're posted when you submit your review.</p>` : ""}
      <div class="row"><button class="btn primary" data-aw="close">Done</button>${w.ids.some((id) => finding(id)?.status === "open") ? `<button class="btn" data-aw="first">Back to the ones left</button>` : ""}</div></div></div>`;
    w.el.querySelector(".btn.primary")?.focus();
    return;
  }
  const status = f.status === "drafted" ? `<div class="aw-state added">Added to your review</div>` : f.status === "dismissed" ? `<div class="aw-state">Dismissed <button class="cbtn" data-aw="restore">Bring it back</button></div>` : "";
  const body = w.editing != null
    ? `<textarea class="aw-edit" spellcheck="true">${esc(w.editing)}</textarea><div class="aw-hint">${MOD}↵ adds it as edited · esc stops editing</div>`
    : `<div class="aw-body cbody">${md(f.body)}</div>`;
  const acts = f.status !== "open" ? "" : w.editing != null
    ? `<button class="btn primary" data-aw="add">Add to review <kbd>${MOD}↵</kbd></button><button class="btn" data-aw="unedit">Cancel edit</button>`
    : `<button class="btn primary" data-aw="add">Add to review <kbd>a</kbd></button><button class="btn" data-aw="edit">Edit first <kbd>e</kbd></button><button class="btn" data-aw="dismiss">Dismiss <kbd>d</kbd></button>`;
  w.el.innerHTML = `<div class="aw" role="dialog" aria-modal="true" aria-label="Claude's review" tabindex="-1">${head}
    ${w.i === 0 && review.summary ? `<p class="aw-summary">${review.focus ? `<span class="aw-focus">You asked: ${esc(review.focus)}</span>` : ""}${md(review.summary)}</p>` : ""}
    <div class="aw-meta"><span class="ctag sev-${esc(f.severity)}">${SEV[f.severity] ?? esc(f.severity)}</span><button class="aw-loc" data-aw="show" title="Show it in the diff (o)">${esc(f.path)}:${f.startLine ? `${f.startLine}–` : ""}${f.line}${f.side === "LEFT" ? " (removed)" : ""} ↗</button></div>
    <h3>${esc(f.title)}</h3>
    ${excerpt(w.app, f)}
    <div class="aw-claude"><span class="cav agav" aria-hidden="true">✦</span><div class="aw-main">${body}</div></div>
    ${status}
    <footer>${acts}<span class="cgrow"></span><button class="btn" data-aw="prev"${w.i === 0 ? " disabled" : ""} title="Previous (k)">←</button><button class="btn" data-aw="next" title="${f.status === "open" ? "Skip it for now" : "Next"} (j)">${f.status === "open" ? "Skip" : "Next"} →</button></footer></div>`;
  const ta = w.el.querySelector(".aw-edit");
  if (ta) { ta.focus(); ta.setSelectionRange(ta.value.length, ta.value.length); ta.addEventListener("input", () => { w.editing = ta.value; }); }
  else w.el.querySelector(".aw").focus();
}

/** The lines around the finding, from its hunk: the finding's own lines marked. */
function excerpt(app, f) {
  const at = (l) => (f.side === "LEFT" ? l.t === "-" && l.o : l.t !== "-" && l.n);
  const h = (app.graph.hunks ?? []).find((x) => x.file === f.path && x.lines.some((l) => at(l) === f.line));
  if (!h) return "";
  const k = h.lines.findIndex((l) => at(l) === f.line), first = f.startLine ? h.lines.findIndex((l) => at(l) === f.startLine) : k;
  const from = Math.max(0, (first >= 0 ? first : k) - 5), to = Math.min(h.lines.length, k + 4), lines = h.lines.slice(from, to);
  const html = hlBlock(lines.map((l) => l.s), langOf(f.path));
  const hit = (l) => { const n = at(l); return n && n >= (f.startLine ?? f.line) && n <= f.line; };
  return `<div class="aw-code"><table>${lines.map((l, j) => `<tr class="${l.t === "+" ? "add" : l.t === "-" ? "del" : ""}${hit(l) ? " hit" : ""}"><td class="ln">${l.t === "-" ? l.o : l.n}</td><td class="sg">${l.t === " " ? "" : l.t}</td><td class="tx"><code>${html[j] || " "}</code></td></tr>`).join("")}</table></div>`;
}

async function act(what) {
  const f = finding(w.ids[w.i]);
  if (!f) return;
  if (what === "add" && f.status === "open") {
    const body = w.editing;
    w.editing = null;
    await findingAct(w.app, f.id, "draft", body);
    w.added++;
    return go(1);
  }
  if (what === "dismiss" && f.status === "open") { await findingAct(w.app, f.id, "dismiss", undefined, false); w.dismissed++; return go(1); }
  if (what === "restore" && f.status === "dismissed") { await findingAct(w.app, f.id, "restore"); w.dismissed--; return draw(); }
  if (what === "edit" && f.status === "open") { w.editing = f.body; return draw(); }
  if (what === "unedit") { w.editing = null; return draw(); }
  if (what === "show") return show(f);
}
function go(d) {
  w.editing = null;
  w.i = Math.max(0, Math.min(w.ids.length, w.i + d)); // one past the last: done
  draw();
}
/** Closes the walkthrough on the finding's line in the diff. */
function show(f) {
  const app = w.app;
  close();
  const pid = app.pidAt(f.path, f.line);
  if (!pid) return app.toast?.("That file is hidden by a filter (Tests, Generated or Unchanged).", 5000);
  if (app.settings.view !== "diff") app.switchView("diff");
  app.setFocus(pid, { level: 2 });
  app.emit("comments");
  setTimeout(() => {
    const all = [...document.querySelectorAll(`.cthread[data-thread="a:${CSS.escape(f.id)}"]`)].filter(live);
    const el = all.find((e) => e.closest(".dfocus")) ?? all[0]; // the focused page's, not the canvas behind it
    if (!el) return;
    el.scrollIntoView({ block: "center", behavior: "smooth" });
    el.classList.remove("cflash"); void el.offsetWidth; el.classList.add("cflash");
  }, 80);
}

function onClick(ev) {
  if (ev.target === w.el) return close(); // the backdrop
  const t = ev.target.closest("[data-aw]");
  if (!t) return;
  const a = t.dataset.aw;
  if (a === "close") return close();
  if (a === "new") { const next = w.onNew; close(); return next?.(); }
  if (a === "next") return go(1);
  if (a === "prev") return go(-1);
  if (a === "first") { w.i = Math.max(0, w.ids.findIndex((id) => finding(id)?.status === "open")); return draw(); }
  t.disabled = true;
  void act(a);
}
function onKey(ev) {
  ev.stopPropagation(); // the page's keys stay out of it
  if (inspectorOpen()) { // a reference opened over it: its keys first
    if (ev.key === "Escape") { ev.preventDefault(); closePeek(w.app); w.el.querySelector(".aw")?.focus(); }
    else if (inspectorKey(w.app, ev)) ev.preventDefault();
    return;
  }
  const typing = ev.target.matches("textarea");
  if (typing) {
    if (ev.key === "Enter" && (ev.metaKey || ev.ctrlKey)) { ev.preventDefault(); void act("add"); }
    else if (ev.key === "Escape") { ev.preventDefault(); void act("unedit"); }
    return;
  }
  if (ev.metaKey || ev.ctrlKey || ev.altKey) return;
  if ((ev.key === "Enter" || ev.key === " ") && ev.target.matches("button")) return; // a button you tabbed to: its own
  const k = ev.key, done = w.i >= w.ids.length;
  const map = { Escape: () => close(), j: () => go(1), ArrowRight: () => go(1), ArrowDown: () => go(1), k: () => go(-1), ArrowLeft: () => go(-1), ArrowUp: () => go(-1),
    a: () => act("add"), Enter: () => (done ? close() : act("add")), e: () => act("edit"), d: () => act("dismiss"), x: () => act("dismiss"), o: () => act("show") };
  if (map[k] && !(done && k !== "Escape" && k !== "Enter" && k !== "k" && k !== "ArrowLeft" && k !== "ArrowUp")) { ev.preventDefault(); void map[k](); }
}
