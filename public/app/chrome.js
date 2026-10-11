// Everything around the view: header, where-am-I bar, key hints, overlays, toasts, settings.
import { BAND_TEXT, DONE, LEVELS, LOW, api, esc, inline } from "./core.js";

const $ = (q) => document.querySelector(q);
let app, views;

export function init(a, viewList) {
  app = a; views = viewList;
  for (const r of ["focus", "level", "marks", "graph", "settings", "comments", "llm"]) app.on((why) => why === r && render());
  render();
  // Stepping into a new core: lead with its hook, so you know what to look for before reading.
  watchCores();
  app.on((why) => (why === "marks" ? watchCores() : why === "graph" ? (doneCores = null, watchCores()) : null));
  let lastCore = app.get(app.focus)?.core.id;
  app.on((why) => {
    if (why !== "focus" && why !== "graph") return;
    const loc = app.get(app.focus);
    if (loc && loc.core.id !== lastCore && why === "focus" && Date.now() - doneAt > 1500) coreIntro(loc);
    lastCore = loc?.core.id ?? lastCore;
  });
  document.addEventListener("click", onClick);
  $("#toast").addEventListener("keydown", (ev) => {
    if (ev.target.id === "drift" && ev.key === "Enter") { ev.preventDefault(); parkDrift(); }
    if (ev.target.id === "drift" && ev.key === "Escape") $("#toast").hidden = true;
  });
  $("#overlay").addEventListener("keydown", (ev) => {
    if (ev.target.id === "gnote" && ev.key === "Enter" && (ev.metaKey || ev.ctrlKey)) { ev.preventDefault(); addGlobalNote(); }
  });
  startTimebox();
}

export function render() {
  renderTop(); renderWhere(); renderKeys();
}

function renderTop() {
  const { done, total, mins } = app.progress();
  const pct = total ? Math.round((done / total) * 100) : 100;
  const g = app.graph;
  const llm = app.llm === "pending" ? `<span class="pill pulse" title="The static tree is usable now">Claude is organising…</span>`
    : app.claudeReady && g.generator.tree !== "claude" ? `<button class="pill signal" data-act="switch-tree">Smarter tree ready · R</button>` : "";
  const drafts = app.state.comments.length;
  $("#top").innerHTML = `
    <div class="brand"><img src="/bobby.svg" alt="" width="22" height="22">bobby</div>
    ${g.pr.provider === "local" ? `<span class="prtitle" title="Local review: ${esc(g.pr.branch)} compared with ${esc(g.pr.baseRef)}">⎇ ${esc(g.pr.branch)} → ${esc(g.pr.baseRef)} · ${esc(g.pr.title)}</span>`
      : `<a class="prtitle" href="${esc(g.pr.url)}" target="_blank" rel="noopener">#${g.pr.number} ${esc(g.pr.title)}</a>`}
    ${llm}
    ${coreProgress()}
    <div class="prog" title="${done} of ${total} pages reviewed"><div class="bar"><i style="width:${pct}%"></i></div>${done}/${total}${mins && done < total ? ` · ~${mins}m` : ""}</div>
    <div class="seg" role="group" aria-label="View">${views.map((v) => `<button data-view="${v.id}" aria-pressed="${app.viewId === v.id}" title="${esc(v.hint)} (v)">${esc(v.name)}</button>`).join("")}</div>
    ${drafts ? `<button class="pill signal" data-act="submit">${drafts} draft${drafts > 1 ? "s" : ""} · S</button>` : ""}
    <button class="pill" data-act="notes" title="Your private notes (M). Never posted to GitHub.">✎ Notes${app.state.notes.length ? ` · ${app.state.notes.length}` : ""}</button>
    <button class="iconbtn" data-act="settings" title="Settings (,)" aria-label="Settings">${GEAR}</button>`;
}

// Progress inside the core you're in: a bar that moves every few pages, not every few dozen.
const corePages = (ci) => app.index.walk.filter((p) => app.get(p)?.ci === ci);
function coreProgress() {
  const loc = app.get(app.focus);
  if (!loc) return "";
  const pages = corePages(loc.ci), d = pages.filter((p) => app.isReviewed(p)).length;
  return `<div class="prog core" title="Core ${loc.ci + 1}: ${d} of ${pages.length} pages reviewed"><span>core ${loc.ci + 1}</span><div class="bar"><i style="width:${Math.round((d / pages.length) * 100)}%"></i></div>${d}/${pages.length}</div>`;
}

// Finishing a core gets a moment: what you flagged and noted there, and what to look for next.
let doneCores = null, doneAt = 0;
function watchCores() {
  const now = new Set(app.graph.cores.map((_, ci) => ci).filter((ci) => corePages(ci).every((p) => app.isReviewed(p))));
  const fresh = doneCores ? [...now].filter((ci) => !doneCores.has(ci)) : [];
  doneCores = now;
  if (fresh.length !== 1) return;
  const ci = fresh[0], c = app.graph.cores[ci];
  doneAt = Date.now(); // the recap names the next core, so its intro would only replace it
  const pages = corePages(ci), flagged = pages.filter((p) => app.isFlagged(p)).length;
  const files = new Set(pages.map((p) => { const n = app.nodeOf(p); return n.kind === "change" ? n.file : n.location.path; }));
  const notes = app.state.notes.filter((n) => n.path && files.has(n.path));
  // Next: the core `a` and `n` will take you to, the first unfinished one after this, wrapping around.
  const order = app.graph.cores.map((_, i) => (ci + 1 + i) % app.graph.cores.length);
  const next = order.find((i) => !now.has(i)) ?? -1;
  const nc = next >= 0 ? app.graph.cores[next] : null;
  toast(`<span class="intro"><b>✓ Core ${ci + 1} of ${app.graph.cores.length} done · ${esc(c.title)}</b>
    <span style="color:var(--muted);font-size:13px">${pages.length} page${pages.length === 1 ? "" : "s"}${flagged ? ` · ${flagged} flagged` : ""}${notes.length ? ` · ${notes.length} note${notes.length > 1 ? "s" : ""}` : ""} · ${now.size} of ${app.graph.cores.length} cores done</span>
    ${notes.slice(0, 3).map((n) => `<span style="font-size:13px">✎ ${esc(n.body.slice(0, 80))}</span>`).join("")}
    ${nc ? `<span style="font-size:13px;color:var(--muted)">Next: core ${next + 1} · ${esc(nc.title)}</span>${nc.hook ? `<span class="hook">${inline(nc.hook)}</span>` : ""}` : `<span style="font-size:13px">That was the last core. <kbd>s</kbd> to submit.</span>`}</span>`, 12000);
}

function renderWhere() {
  const pid = app.focus;
  const loc = app.get(pid);
  const crumbs = [`<button data-level="0" class="${app.level === 0 ? "here" : ""}">${esc(app.graph.pr.repo)} ${app.graph.pr.provider === "local" ? `⎇ ${esc(app.graph.pr.branch)}` : `#${app.graph.pr.number}`}</button>`];
  if (loc) {
    crumbs.push(`<button data-level="1" class="${app.level === 1 ? "here" : ""}">${loc.ci + 1} · ${esc(loc.core.title)}</button>`);
    crumbs.push(`<button data-level="2" class="${app.level === 2 ? "here" : ""}"><i class="glyph ${loc.pl.band === "core" ? "core" : app.nodeOf(pid).kind}" style="margin-right:6px"></i>${esc(loc.pl.title)}</button>`);
  } else if (pid === LOW) crumbs.push(`<button data-level="2" class="here">Low-signal changes</button>`);
  else if (pid === DONE) crumbs.push(`<button class="here">End</button>`);
  const note = app.state.note ? `<button data-act="note" title="Your parked thought (p)" style="color:var(--signal)">📌 ${esc(app.state.note.slice(0, 48))}${app.state.note.length > 48 ? "…" : ""}</button>` : "";
  $("#where").innerHTML = `${crumbs.join(`<span class="sep">›</span>`)}${note}
    <span class="levels" title="Zoom: ${LEVELS[app.level]} (enter / esc)">${LEVELS.map((_, i) => `<i class="${i <= app.level ? "on" : ""}"></i>`).join("")}<span style="margin-left:6px">${LEVELS[app.level]}</span></span>`;
}

const HINTS = [
  [["j", "k"], "next / back"], [["enter"], "zoom in"], [["v"], "switch view"], [["?"], "all keys"],
];
const HINTS_BY_LEVEL = {
  0: [[["j", "k"], "step"], [["enter"], "open core"], [["v"], "switch view"]],
  1: [[["j", "k"], "step"], [["f"], "flag for later"], [["a"], "looks good →"], [["c"], "comment"], [["e"], "open / more"], [["enter"], "read page"], [["esc"], "overview"]],
  2: [[["j", "k"], "next / back"], [["a"], "looks good →"], [["f"], "flag"], [["c"], "comment"], [["e"], "open / more"], [["p"], "park a thought"], [["esc"], "zoom out"]],
};
function renderKeys() {
  const mode = app.settings.hints;
  const uses = app.settings.hintUses ?? {};
  const list = (HINTS_BY_LEVEL[app.level] ?? HINTS).filter(([ks]) => mode === "always" || (mode === "fade" && ks.some((k) => (uses[k] ?? 0) < 5)));
  $("#keys").innerHTML = mode === "never" ? `<span><kbd>?</kbd> keys</span>`
    : [...list, [["?"], "all keys"]].map(([ks, label]) => `<span>${ks.map((k) => `<kbd>${k}</kbd>`).join(" ")} ${label}</span>`).join("");
}

// ---------------------------------------------------------------- overlays
export const isOpen = () => !$("#overlay").hidden;
function open(html, cls = "") {
  const o = $("#overlay");
  o.innerHTML = `<div class="modal ${cls}" role="dialog" aria-modal="true">${html}</div>`;
  o.hidden = false;
  (o.querySelector("textarea") ?? o.querySelector(".btn.primary"))?.focus();
}
export function close() { $("#overlay").hidden = true; }

export function help() {
  const r = (k, d) => `<tr><td>${k.split(" ").map((x) => `<kbd>${x}</kbd>`).join(" ")}</td><td>${d}</td></tr>`;
  open(`<h2>How the walk works</h2>
    <p>Each core change comes with its surroundings, in this order: <b>untouched code it relies on</b> → <b>changed code it relies on</b> → <b>the core</b> → <b>changed code it affects</b> → <b>untouched code it affects</b>. Solid dots ● are changed code, hollow ○ are untouched, and ◆ is the core.</p>
    <table>
      ${r("j k", "next / previous page (space too; arrows too, except in Diff)")}
      ${r("← → ↑ ↓", "in Diff: → / ← follow edges to a file this one leads into / comes from, ↑ ↓ the file above / below")}
      ${r("J K", "next / previous core")}
      ${r("n", "next unreviewed")}
      ${r("a", "looks good: mark reviewed and move on")}
      ${r("u", "un-mark")}
      ${r("f", "flag to come back to")}
      ${r("F", "next flagged: skim and flag first, then go deep")}
      ${r("F", "in Diff: fill the screen with this file, centred; again to go back")}
      ${r("c", "comment (click a line first, or it picks one)")}
      ${r("m", "private note on a line: only you see it, never posted")}
      ${r("M", "your notes: on the whole PR, plus a list of all of them")}
      ${r("e", "open collapsed code, then more context")}
      ${r("p", "park a thought: jot what's in your head, shown when you return")}
      ${r("enter esc", "zoom in / out: overview → core → page")}
      ${r("v", "switch view: Flow, Outline, Lens, Diff")}
      ${r("d", "diff layout: inline or split")}
      ${r("s", "submit review")}
      ${r(",", "settings")}
    </table>
    <div class="row"><button class="btn primary" data-act="close">Got it</button></div>`);
}

const SETTINGS = [
  ["theme", "Theme", [["system", "System"], ["dark", "Warm dark"], ["light", "Warm light"]]],
  ["font", "Reading font", [["sans", "Sans"], ["hyper", "Hyperlegible"], ["serif", "Serif"], ["mono", "Mono"]]],
  ["size", "Text size", [[14, "14"], [15, "15"], [16, "16"], [18, "18"]]],
  ["spacing", "Word spacing", [["normal", "Normal"], ["wide", "Wide"], ["wider", "Wider"]]],
  ["motion", "Motion", [["system", "System"], ["on", "On"], ["off", "Off"]]],
  ["hints", "Key hints", [["fade", "Fade when learned"], ["always", "Always"], ["never", "Hidden"]]],
  ["diffLayout", "Diff layout", [["inline", "Inline"], ["split", "Split"]]],
  ["edges", "Diff edges", [["all", "All, faint"], ["focus", "Focused only"]]],
  ["timebox", "Break reminder", [[0, "Off"], [15, "15m"], [25, "25m"], [45, "45m"]]],
  ["rabbit", "Rabbit-hole nudge", [[0, "Off"], [8, "8m"], [12, "12m"], [20, "20m"]]],
  ["drift", "Drift prompt", [["on", "On"], ["off", "Off"]]],
  ["prComments", "PR comments", [["hide", "Hidden, show per page"], ["show", "Always shown"]]],
];
export function settings() {
  open(`<h2>Settings</h2><p>Changes apply immediately and are remembered.</p>
    ${SETTINGS.map(([key, label, opts]) => `<div class="setting"><label>${label}</label><div class="seg">${opts.map(([v, t]) =>
      `<button data-set="${key}" data-val="${v}" aria-pressed="${String(app.settings[key]) === String(v)}">${t}</button>`).join("")}</div></div>`).join("")}
    <div class="row"><button class="btn primary" data-act="close">Done</button></div>`);
}

export function submit(msg) {
  const cs = app.state.comments;
  if (app.graph.pr.provider === "local") return open(`<h2>Nothing to post to</h2>
    <p>This is a local review of <b>⎇ ${esc(app.graph.pr.branch)}</b>, with no PR behind it, so your ${cs.length ? `${cs.length} draft(s)` : "drafts"} and notes stay here. Open a PR and review it with <code>bobby &lt;number&gt;</code> to post a review on GitHub.</p>
    <div style="font-size:13px;color:var(--muted);margin-top:10px">${cs.map((c) => `· <code>${esc(c.path)}:${c.line}</code> ${esc(c.body.slice(0, 70))}`).join("<br>")}</div>
    <div class="row"><button class="btn" data-act="close" style="margin-left:auto">Close</button></div>`);
  open(`<h2>Submit review</h2>
    <p>${cs.length ? `${cs.length} draft comment(s) will be posted together.` : "No draft comments."}${app.state.notes.length ? ` Your ${app.state.notes.length} private note(s) stay here and aren't posted.` : ""}</p>
    <textarea id="rbody" placeholder="Summary (optional for Approve)"></textarea>
    <div style="font-size:13px;color:var(--muted);margin-top:10px">${cs.map((c) => `· <code>${esc(c.path)}:${c.line}</code> ${esc(c.body.slice(0, 70))}${c.inDiff ? "" : " <i>(goes in summary)</i>"}`).join("<br>")}</div>
    <div class="row">
      <button class="btn primary" data-submit="COMMENT">Comment</button>
      <button class="btn" data-submit="APPROVE">Approve</button>
      <button class="btn" data-submit="REQUEST_CHANGES">Request changes</button>
      <button class="btn" data-act="close" style="margin-left:auto">Cancel</button>
    </div>${msg ? `<div class="err">${esc(msg)}</div>` : ""}`);
}
async function doSubmit(event) {
  const r = await api("/api/submit", { event, body: $("#rbody").value });
  if (!r.ok) return submit(r.error);
  app.state.comments = [];
  app.emit("comments");
  open(`<h2>Review posted ✓</h2><p><a href="${esc(r.url)}" target="_blank" rel="noopener">${esc(r.url)}</a></p><div class="row"><button class="btn primary" data-act="close">Close</button></div>`);
}

/** Private notes: ones on the whole PR can be written here; every note is listed and jumps to its code. */
export function notes() {
  const all = app.state.notes;
  const del = (n) => `<button class="x" data-gdel="${n.id}" title="Delete note">✕</button>`;
  const global = all.filter((n) => !n.path);
  const onCode = all.filter((n) => n.path).sort((a, b) => a.path.localeCompare(b.path) || (a.line ?? 0) - (b.line ?? 0));
  open(`<h2>Your notes</h2>
    <p>Private: only you see these. They're never posted to GitHub.</p>
    <h4 class="nh">On this PR</h4>
    ${global.map((n) => `<div class="note mine"><div class="who">${timeAgo(new Date(n.createdAt))}${del(n)}</div><div class="body">${esc(n.body)}</div></div>`).join("")}
    <textarea id="gnote" placeholder="A note about the whole PR.  ⌘/Ctrl+Enter to add"></textarea>
    <div class="row"><button class="btn primary" data-act="add-note">Add note</button><button class="btn" data-act="close" style="margin-left:auto">Done</button></div>
    ${onCode.length ? `<h4 class="nh">On code</h4>${onCode.map((n) => `<div class="note mine" data-gonote="${n.id}"><div class="who"><code>${esc(n.path.split("/").pop())}${n.line ? `:${n.line}` : ""}</code>${n.line ? "" : " · whole file"}${del(n)}</div><div class="body">${esc(n.body)}</div></div>`).join("")}` : ""}`, "notes");
}
async function addGlobalNote() {
  const t = $("#gnote"), body = t?.value.trim();
  if (!body) return;
  await app.addNote({ body });
  notes();
}

export function park() {
  open(`<h2>Park a thought</h2>
    <p>What's in your head right now? It'll be waiting for you when you come back.</p>
    <textarea id="note" placeholder="e.g. check whether normalizeRetryOptions copies the array before mutating">${esc(app.state.note ?? "")}</textarea>
    <div class="row"><button class="btn primary" data-act="save-note">Park it</button>${app.state.note ? `<button class="btn" data-act="clear-note">Clear</button>` : ""}<button class="btn" data-act="close" style="margin-left:auto">Cancel</button></div>`);
}
function parkDrift() {
  const v = $("#drift")?.value.trim();
  $("#toast").hidden = true;
  if (v) { app.state.note = v; api("/api/note", { note: v }); renderWhere(); }
}
function saveNote(note) {
  app.state.note = note;
  api("/api/note", { note });
  close();
  renderWhere();
}

/** Shown on load when there's progress to return to: cheap re-entry after an interruption. */
export function reentry() {
  const loc = app.get(app.focus);
  const { done, total } = app.progress();
  const flagged = app.index.walk.filter((p) => p !== DONE && app.isFlagged(p)).length;
  const ago = app.state.lastSeenAt ? timeAgo(new Date(app.state.lastSeenAt)) : "";
  open(`<h2>Welcome back</h2>
    <p>${done} of ${total} reviewed${flagged ? ` · ${flagged} flagged` : ""}${app.state.comments.length ? ` · ${app.state.comments.length} draft comment(s)` : ""}${ago ? ` · last here ${ago}` : ""}</p>
    ${loc ? `<div class="where"><span style="color:var(--muted);font-size:13px">You were in core ${loc.ci + 1}, <b style="display:inline;font-family:inherit">${esc(loc.core.title)}</b>, on ${esc(BAND_TEXT[loc.pl.band].toLowerCase())}:</span><b>${esc(loc.pl.title)}</b></div>` : ""}
    ${app.state.note ? `<div class="parked">📌 ${esc(app.state.note)}</div>` : ""}
    <div class="row"><button class="btn primary" data-act="close">Continue <kbd style="margin-left:6px">enter</kbd></button><button class="btn" data-act="overview">See the overview first</button></div>`, "reentry");
}

function timeAgo(d) {
  const m = Math.round((Date.now() - d) / 60000);
  return m < 2 ? "just now" : m < 60 ? `${m} min ago` : m < 1440 ? `${Math.round(m / 60)} h ago` : `${Math.round(m / 1440)} d ago`;
}

export function coreIntro(loc, lead = "") {
  const c = loc.core;
  toast(`<span class="intro">${lead}<b>Core ${loc.ci + 1} of ${app.graph.cores.length} · ${esc(c.title)}</b>${c.hook ? `<span class="hook">${inline(c.hook)}</span>` : ""}</span>`, 9000);
}

// ---------------------------------------------------------------- toast
export function toast(html, ms = 0) {
  const t = $("#toast");
  t.innerHTML = `${html}<button class="x" data-act="toast-close" aria-label="Dismiss">✕</button>`;
  t.hidden = false;
  clearTimeout(toast._t);
  if (ms) toast._t = setTimeout(() => (t.hidden = true), ms);
}

// Attention aids, all driven by one activity clock. "Active" means the tab is visible and there was input
// in the last two minutes. None of them block: each is a toast you can ignore.
//  - break reminder: every N active minutes (settings.timebox; off by default)
//  - rabbit hole: N active minutes on one page (settings.rabbit) → flag it and move on, or keep going
//  - drift: 90s without input while on a page (settings.drift) → park a thought before it's gone
//  - back after a while: more than 8 minutes away → where you were, what to look for, your parked thought
const AWAY_MS = 8 * 60000, IDLE_MS = 90000;
let trail = []; // recent pages, newest last
function startTimebox() {
  let active = 0, last = Date.now(), onPage = 0, nudged = false, prompted = false, hiddenAt = 0;
  const input = () => {
    if (Date.now() - last > AWAY_MS) welcomeBackLite();
    last = Date.now();
  };
  for (const ev of ["keydown", "pointerdown", "wheel"]) document.addEventListener(ev, input, { passive: true });
  document.addEventListener("visibilitychange", () => {
    if (document.hidden) hiddenAt = Date.now();
    else if (hiddenAt && Date.now() - hiddenAt > AWAY_MS) { welcomeBackLite(); last = Date.now(); }
  });
  app.on((why) => {
    if (why !== "focus") return;
    onPage = 0; nudged = false; prompted = false;
    if (app.get(app.focus)) trail = [...trail.filter((p) => p !== app.focus), app.focus].slice(-4);
  });
  if (app.get(app.focus)) trail = [app.focus];
  setInterval(() => {
    const idle = Date.now() - last, onAPage = app.level >= 1 && !!app.get(app.focus);
    if (document.hidden) return;
    if (app.settings.drift !== "off" && onAPage && !prompted && idle > IDLE_MS && idle < AWAY_MS && !isOpen()) { prompted = true; driftPrompt(); }
    if (idle > 120000) return;
    active += 1 / 6; onPage += 1 / 6;
    const rabbit = Number(app.settings.rabbit);
    if (rabbit && onAPage && !nudged && onPage >= rabbit) {
      nudged = true;
      toast(`<span class="intro"><b>${rabbit} minutes on ${esc(app.get(app.focus).pl.title)}</b><span style="font-size:13px;color:var(--muted)">Still the right place to be? You can flag it and come back.</span>
        <span class="acts"><button class="btn" data-act="rabbit-flag">Flag & move on</button><button class="btn" data-act="toast-close">Keep going</button></span></span>`);
    }
    const box = Number(app.settings.timebox);
    if (box && active >= box) {
      active = 0;
      const { done } = app.progress();
      toast(`<span>${box} min in, ${done} pages reviewed. A good moment for a break; your place is saved.</span>`);
    }
  }, 10000);
}
function driftPrompt() {
  toast(`<span class="intro"><b>Spotted a ball?</b><span style="font-size:13px;color:var(--muted)">Jot where your head is; it'll be waiting when you're back.</span>
    <input id="drift" placeholder="e.g. checking whether retries stop at the limit" value="${esc(app.state.note ?? "")}"><span class="acts"><button class="btn" data-act="drift-park">Park it</button></span></span>`);
}
function welcomeBackLite() {
  const loc = app.get(app.focus);
  if (!loc || isOpen()) return;
  const before = trail.filter((p) => p !== app.focus).slice(-2).map((p) => esc(app.get(p).pl.title));
  toast(`<span class="intro"><b>Welcome back</b><span style="font-size:13px">You were on <b>${esc(loc.pl.title)}</b> · core ${loc.ci + 1}, ${esc(loc.core.title)}</span>
    ${before.length ? `<span style="font-size:13px;color:var(--muted)">Before that: ${before.join(" → ")}</span>` : ""}
    ${app.state.note ? `<span style="font-size:13px">📌 ${esc(app.state.note)}</span>` : ""}
    ${loc.core.hook ? `<span class="hook">${inline(loc.core.hook)}</span>` : ""}</span>`, 15000);
}

// ---------------------------------------------------------------- clicks
function onClick(ev) {
  const t = ev.target.closest("[data-act],[data-view],[data-level],[data-set],[data-submit],[data-gdel],[data-gonote]");
  if (!t) { if (ev.target.id === "overlay") close(); return; }
  const ds = t.dataset;
  if (ds.view) app.switchView(ds.view);
  else if (ds.level) app.setLevel(Number(ds.level));
  else if (ds.set) { const v = /^\d+$/.test(ds.val) ? Number(ds.val) : ds.val; app.saveSettings({ [ds.set]: v }); settings(); }
  else if (ds.submit) doSubmit(ds.submit);
  else if (ds.gdel) { app.deleteNote(ds.gdel); notes(); }
  else if (ds.gonote) {
    const n = app.state.notes.find((x) => x.id === ds.gonote), pid = n && app.pidAt(n.path, n.line);
    close();
    if (pid) app.setFocus(pid, { level: 2 });
  }
  else ({
    close, settings, submit, notes,
    "add-note": () => addGlobalNote(),
    note: park,
    overview: () => { close(); app.setLevel(0); },
    "switch-tree": () => app.switchTree(),
    "save-note": () => saveNote($("#note").value.trim()),
    "clear-note": () => saveNote(""),
    "toast-close": () => ($("#toast").hidden = true),
    "rabbit-flag": () => { $("#toast").hidden = true; app.mark(app.focus, "flagged"); app.nextUnreviewed(); },
    "drift-park": () => parkDrift(),
  })[ds.act]?.();
}

const GEAR = `<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 1 1-4 0v-.09a1.65 1.65 0 0 0-1-1.51 1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 1 1 0-4h.09a1.65 1.65 0 0 0 1.51-1 1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06a1.65 1.65 0 0 0 1.82.33h0a1.65 1.65 0 0 0 1-1.51V3a2 2 0 1 1 4 0v.09a1.65 1.65 0 0 0 1 1.51h0a1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82v0a1.65 1.65 0 0 0 1.51 1H21a2 2 0 1 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z"/></svg>`;
