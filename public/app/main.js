import { DONE, api, createApp, esc } from "./core.js";
import { escapeCode, inspectorKey, inspectorOpen, expandAll, keepDraft, renderFile, renderNode, renderPage, startComment, startFileNote } from "./code.js";
import * as chrome from "./chrome.js";
import * as palette from "./palette.js";
import * as tour from "./tour.js";
import { ACTIONS, actionFor, keyHtml, keyOfEvent, keysOf, keyText } from "./keys.js";
import views from "./views/index.js";

// Without these there's no review: say why, in place of "Fetching the change tree…", and stop.
const [graph, session] = await Promise.all([api("/api/graph"), api("/api/session")]).catch((e) => {
  const empty = document.querySelector("#view > .empty");
  if (empty) empty.textContent = `Couldn't load the review: ${e.message} Reload once it's back.`;
  return new Promise(() => {});
});
const fresh = !Object.keys(session.settings).length; // nothing saved yet: a first launch
const app = createApp({ graph, session });
app.claudeReady = graph.generator.tree === "claude";
app.renderPage = (el, pid) => { app.pageEl = el; renderPage(app, el, pid ?? app.focus); };
// The focused card's body: comments + code, without the title block the card already shows.
app.renderNode = (el, pid) => { app.pageEl = el; renderNode(app, el, pid ?? app.focus, { head: false }); };
// A whole file (sections = placement ids in file order) for file-level views.
app.renderFile = (el, pids) => renderFile(app, el, pids);
app.noteOnFile = (el, path) => startFileNote(app, el, path); // el: the renderFile container showing path
app.keepDraft = (c) => keepDraft(app, c);

// ---- settings → document
const FONTS = {
  sans: "var(--font-ui)", // the style's UI font: Inter (warm) or the system font (github)
  hyper: `"Atkinson Hyperlegible", "Inter", sans-serif`,
  serif: `"Literata", Georgia, serif`,
  mono: `"JetBrains Mono", ui-monospace, monospace`,
};
const media = (q) => window.matchMedia(q).matches;
function applySettings() {
  const s = app.settings, root = document.documentElement;
  root.dataset.theme = s.theme === "system" ? (media("(prefers-color-scheme: light)") ? "light" : "dark") : s.theme;
  root.dataset.files = s.fileTreeSide === "left" ? "left" : "right";
  root.dataset.palette = s.palette === "github" ? "github" : "warm";
  root.dataset.motion = s.motion === "system" ? (media("(prefers-reduced-motion: reduce)") ? "off" : "on") : s.motion;
  root.style.setProperty("--font-prose", FONTS[s.font] ?? FONTS.sans);
  root.style.setProperty("--size", `${s.size}px`);
  root.style.setProperty("--code-size", `${Math.round(s.size * 0.87)}px`);
  root.style.setProperty("--word-spacing", { normal: "0", wide: ".08em", wider: ".16em" }[s.spacing] ?? "0");
}
applySettings();
app.on((why) => why === "settings" && applySettings());

// ---- views
// Each view mounts into its own slot. Diff is costly to build, so it's kept alive when you switch away: its slot is
// parked (content-visibility: hidden keeps its layout, so showing it again is a repaint, not a rebuild) and it catches
// up on return ("resume"). The others are cheap and are rebuilt each time.
const KEEP = new Set(["diff"]);
const el = document.getElementById("view");
const alive = new Map(); // view id → { inst, slot }
let current = null, currentId = null;
function mount(id) {
  const view = views.find((v) => v.id === id) ?? views[0];
  el.querySelector(":scope > .empty")?.remove(); // the "Fetching the change tree…" placeholder from index.html
  if (current) {
    const a = alive.get(currentId);
    if (KEEP.has(currentId)) { current.hide?.(); a.slot.classList.add("parked"); }
    else { current.destroy?.(); a.slot.remove(); alive.delete(currentId); }
  }
  app.pageEl = null; // c / m / e act on the new view's page, never a parked one
  el.className = `view-${view.id}`;
  currentId = app.viewId = view.id;
  const kept = alive.get(view.id);
  if (kept) { kept.slot.classList.remove("parked"); current = kept.inst; current.update?.("resume"); return; }
  const slot = el.appendChild(Object.assign(document.createElement("div"), { className: "vslot" }));
  current = view.mount(slot, app);
  alive.set(view.id, { inst: current, slot });
}
app.switchView = (id) => {
  if (id === currentId) return;
  mount(id);
  app.saveSettings({ view: id });
};
app.on((why) => why !== "settings" && current?.update?.(why));
app.on((why) => why === "settings" && current?.update?.("settings"));
window.addEventListener("resize", () => current?.update?.("resize"));

// ---- Claude tree: never swap under the user; offer it.
app.switchTree = async () => {
  if (!app.claudeReady || app.graph.generator.tree === "claude") return;
  app.replaceGraph(await api("/api/graph"));
  chrome.toast("Switched to Claude's tree. You're on the same code.", 4000);
};
// Polled while Claude works or a language server is installing or loading.
const busy = (list) => list.some((x) => x.state === "pending" || x.state === "installing");
let pollTimer = 0;
let pollLost = false;
async function poll() {
  clearTimeout(pollTimer);
  // Unreachable (restarting, asleep): keep trying, slower, and say so once.
  const s = await api("/api/status").catch((e) => {
    if (!pollLost) chrome.toast(esc(e.message), 6000);
    pollLost = true;
    pollTimer = setTimeout(poll, 10_000);
  });
  if (!s) return;
  pollLost = false;
  const before = JSON.stringify([app.llm, app.claudeReady, app.servers]);
  app.llm = s.llm;
  if (s.claudeReady && !app.claudeReady) {
    app.claudeReady = true;
    chrome.toast(`<span>Claude's tree is ready. ${keyHtml(app.settings, "switchTree")} switches; you keep your place.</span>`);
  }
  const was = new Map(app.servers.map((x) => [x.id, x.state]));
  app.servers = s.servers ?? [];
  // A server finished: its definitions replace the syntax-only ones for its language.
  if (app.servers.some((x) => x.state === "done" && was.get(x.id) !== "done")) app.graph.definitions = await api("/api/definitions").catch(() => app.graph.definitions);
  // only when something changed: every view re-renders on it
  if (JSON.stringify([app.llm, app.claudeReady, app.servers]) !== before) app.emit("llm");
  if (s.llm === "pending" || busy(app.servers)) pollTimer = setTimeout(poll, 3000);
}
app.watchServers = poll; // after you say yes, check again or no in the UI
// A call that failed with no one to catch it (a save, a delete): say so rather than nothing.
app.fail = (e) => chrome.toast(`Not saved: ${esc(e?.message ?? e)}`, 8000);
window.addEventListener("unhandledrejection", (ev) => app.fail(ev.reason));
app.openKeys = () => chrome.keysEditor(); // for the tour's news, which can't import chrome.js
if (app.llm === "pending" || busy(app.servers)) poll();
// The graph and the session are read at once: a server may have finished between them, leaving syntax-only definitions.
else if (app.servers.some((x) => x.state === "done")) api("/api/definitions").then((d) => { app.graph.definitions = d; }, () => {});

// ---- start: at the entry point (the unreviewed core with the least around it), on every load. Where you were last is
// offered on the welcome-back card instead of being jumped to.
const lastNode = session.state.lastNodeId;
const resume = lastNode && [...app.index.placement.values()].find((x) => x.pl.node === lastNode && !x.pl.repeatOf)?.pl.id;
const entry = app.entryPoint();
app.focus = entry?.pid ?? resume ?? app.index.walk.find((p) => p !== DONE && !app.isReviewed(p)) ?? app.index.walk[0];
app.level = entry ? 1 : resume ? (session.state.lastLevel ?? 2) : 0;
const hash = new URLSearchParams(location.hash.slice(1)); // deep links for testing: #view=lens&level=1&p=5
if (hash.has("level")) app.level = Number(hash.get("level"));
if (hash.has("p")) app.focus = app.index.walk[Number(hash.get("p")) - 1] ?? app.focus;
mount(hash.get("view") ?? app.settings.view);
tour.init(app, { fresh });
chrome.init(app, views);
tour.welcome(() => {
  if (resume && resume !== app.focus && !hash.has("p") && (app.progress().done > 0 || session.state.note)) chrome.reentry(resume, session.state.lastLevel ?? 2);
  else if (entry && !hash.has("p")) {
    const deps = entry.deps === 1 ? "1 thing" : `${entry.deps} things`;
    chrome.coreIntro(app.get(entry.pid), `<span style="color:var(--muted);font-size:13px">Start here: the core with the least around it (${deps} it relies on or affects). ${keyHtml(app.settings, "zoomOut")} for the overview.</span>`);
  }
});

// ---- keys
const typing = (t) => t.matches?.("input, textarea, [contenteditable]");
// A button, link or other control you've tabbed to takes enter and space as the browser gives them (it activates), not
// as Bobby's keys. One you clicked keeps focus too, but isn't :focus-visible, so space still turns the page.
const control = (t) => t.matches?.("button, a[href], select, summary, [role=button]") && t.matches(":focus-visible");
const page = () => app.pageEl?.isConnected; // the focused node's code is on screen (page or card)
/** Does what key k does here: the view's own binding first, then the global one. Returns whether k does anything. */
/** A key: the action it's bound to (keys.js, yours or the default), run by the view if it has its own way, else here. */
function press(k, { learn = true } = {}) {
  // A shifted named key that isn't bound (shift+enter) does what the key alone does.
  const id = actionFor(app.settings, k) ?? (k.startsWith("Shift+") ? actionFor(app.settings, k.slice(6)) : undefined);
  return id ? runAction(id, { learn }) : false;
}
// Moving along the layout is the Diff view's own (Shift + arrows); elsewhere it's what the plain arrow does.
const ALONG = { treeLeft: "left", treeRight: "right", treeUp: "up", treeDown: "down" };
function runAction(id, { learn = true } = {}) {
  const act = current?.keys?.[id] ?? current?.keys?.[ALONG[id]] ?? ACTS[id] ?? ACTS[ALONG[id]];
  if (!act) return false;
  if (learn) app.useKey(id); // counted, so its hint fades
  act();
  return true;
}
const ACTS = {
  next: () => app.step(1), prev: () => app.step(-1),
  left: () => app.step(-1), right: () => app.step(1), up: () => app.step(-1), down: () => app.step(1), // views follow their shape instead
  nextCore: () => app.stepCore(1), prevCore: () => app.stepCore(-1),
  nextUnreviewed: () => app.nextUnreviewed(),
  nextFlagged: () => app.nextFlagged() || chrome.toast(`Nothing flagged yet. Skim at the core level and press ${keyHtml(app.settings, "flag")} on anything worth a closer look.`, 5000),
  reviewed: () => { app.mark(app.focus, "reviewed"); app.nextUnreviewed(); },
  unmark: () => app.mark(app.focus, null),
  flag: () => app.mark(app.focus, app.isFlagged(app.focus) ? null : "flagged"),
  comment: () => { if (page()) return startComment(app, app.pageEl); app.setLevel(2); setTimeout(() => page() && startComment(app, app.pageEl)); },
  note: () => { if (page()) return startComment(app, app.pageEl, "note"); app.setLevel(2); setTimeout(() => page() && startComment(app, app.pageEl, "note")); },
  expand: () => page() && expandAll(app, app.pageEl),
  zoomIn: () => app.setLevel(app.level + 1), zoomOut: () => app.setLevel(app.level - 1),
  nextView: () => app.switchView(views[(views.findIndex((v) => v.id === currentId) + 1) % views.length].id),
  submit: () => chrome.submit(), help: () => chrome.help(), settings: () => chrome.settings(), park: () => chrome.park(), notes: () => chrome.notes(),
  switchTree: () => app.switchTree(),
  files: () => chrome.toggleFiles(),
  entry: () => { const e = app.entryPoint(); if (e) app.setFocus(e.pid, { level: 1 }); },
  layout: () => app.toggleLayout(),
};
// ---- command palette: every action by name, with its keys, plus what has no key of its own
function commands() {
  const s = app.settings, flip = (k, a, b) => app.saveSettings({ [k]: s[k] === a ? b : a });
  return [
    ...ACTIONS.filter((a) => a.id !== "switchTree" || (app.claudeReady && app.graph.generator.tree !== "claude"))
      .map((a) => ({ id: `key:${a.id}`, title: a.title, keys: keysOf(app.settings, a.id).slice(0, 1).flatMap((k) => keyText(k).split(" ")), run: () => runAction(a.id, { learn: false }) })),
    { id: "keys", title: "Customize keyboard shortcuts", sub: "bind any action to the keys you like", run: () => chrome.keysEditor() },
    { id: "tour", title: "Take the tour", sub: "how the walk, the views and the keys fit together", run: () => tour.start() },
    ...views.filter((v) => v.id !== currentId).map((v) => ({ id: `view:${v.id}`, title: `${v.name} view`, sub: v.hint, run: () => app.switchView(v.id) })),
    { id: "set:tests", title: `${s.tests === "show" ? "Hide" : "Show"} tests and generated files`, run: () => flip("tests", "show", "hide") },
    { id: "set:untouched", title: `${s.untouched === "hide" ? "Show" : "Hide"} untouched code`, run: () => flip("untouched", "hide", "show") },
    ...[["system", "System"], ["dark", "Dark"], ["light", "Light"]].filter(([v]) => v !== s.theme).map(([v, t]) => ({ id: `theme:${v}`, title: `Theme: ${t}`, run: () => app.saveSettings({ theme: v }) })),
  ];
}

document.addEventListener("keydown", (ev) => {
  if ((ev.metaKey || ev.ctrlKey) && !ev.altKey && !ev.shiftKey && ev.key.toLowerCase() === "k") {
    if (palette.isOpen()) { ev.preventDefault(); return palette.close(); }
    if (chrome.isOpen() || ev.target.matches?.("textarea, [contenteditable]")) return; // never over a modal or a half-written comment
    ev.preventDefault();
    return palette.open(app, commands());
  }
  if (chrome.isOpen() && ev.key === "Escape" && !ev.metaKey && !ev.ctrlKey && !ev.altKey) { ev.preventDefault(); return chrome.close(); } // from its text box too
  if (typing(ev.target) || ev.metaKey || ev.ctrlKey || ev.altKey) return;
  if ((ev.key === "Enter" || ev.key === " ") && control(ev.target)) return;
  if (chrome.isOpen()) {
    if (ev.key === "Enter") { ev.preventDefault(); chrome.close(); }
    return;
  }
  if (inspectorOpen()) { // the inspector's window is on top: its own keys (a list of uses), esc to step back; others wait
    if (inspectorKey(app, ev) || (ev.key === "Escape" && escapeCode(app))) ev.preventDefault();
    return;
  }
  if (tour.key(ev.key)) return ev.preventDefault(); // the callout's own keys; every other key still works under it
  // Esc works on what's innermost: an open composer, then a line selection, then the view (focus mode), then the level.
  if (ev.key === "Escape" && escapeCode(app)) return ev.preventDefault();
  if (press(keyOfEvent(ev))) ev.preventDefault(); // shift+1 is "!", whatever the layout prints
});

window.bobby = app; // handy for debugging and tests
