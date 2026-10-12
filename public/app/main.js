import { DONE, api, createApp } from "./core.js";
import { escapeCode, expandAll, renderFile, renderNode, renderPage, startComment, startFileNote } from "./code.js";
import * as chrome from "./chrome.js";
import * as palette from "./palette.js";
import * as tour from "./tour.js";
import views from "./views/index.js";

const [graph, session] = await Promise.all([api("/api/graph"), api("/api/session")]);
const fresh = !Object.keys(session.settings).length; // nothing saved yet: a first launch
const app = createApp({ graph, session });
app.claudeReady = graph.generator.tree === "claude";
app.renderPage = (el, pid) => { app.pageEl = el; renderPage(app, el, pid ?? app.focus); };
// The focused card's body: comments + code, without the title block the card already shows.
app.renderNode = (el, pid) => { app.pageEl = el; renderNode(app, el, pid ?? app.focus, { head: false }); };
// A whole file (sections = placement ids in file order) for file-level views.
app.renderFile = (el, pids) => renderFile(app, el, pids);
app.noteOnFile = (el, path) => startFileNote(app, el, path); // el: the renderFile container showing path

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
async function poll() {
  const s = await api("/api/status");
  app.llm = s.llm;
  if (s.claudeReady && !app.claudeReady) {
    app.claudeReady = true;
    chrome.toast(`<span>Claude's tree is ready. <kbd>R</kbd> switches; you keep your place.</span>`);
  }
  app.emit("llm");
  if (s.llm === "pending") setTimeout(poll, 4000);
}
if (app.llm === "pending") poll();

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
    chrome.coreIntro(app.get(entry.pid), `<span style="color:var(--muted);font-size:13px">Start here: the core with the least around it (${deps} it relies on or affects). <kbd>esc</kbd> for the overview.</span>`);
  }
});

// ---- keys
const typing = (t) => t.matches?.("input, textarea, [contenteditable]");
const page = () => app.pageEl?.isConnected; // the focused node's code is on screen (page or card)
/** Does what key k does here: the view's own binding first, then the global one. Returns whether k does anything. */
function press(k, { learn = true } = {}) {
  const hint = k === "Enter" ? "enter" : k === "Escape" ? "esc" : k;
  if (current?.keys?.[k]) { if (learn) app.useKey(hint); current.keys[k](); return true; } // counted, so its hint fades too
  const act = {
    j: () => app.step(1), ArrowDown: () => app.step(1), ArrowRight: () => app.step(1), " ": () => app.step(1),
    k: () => app.step(-1), ArrowUp: () => app.step(-1), ArrowLeft: () => app.step(-1),
    J: () => app.stepCore(1), K: () => app.stepCore(-1),
    n: () => app.nextUnreviewed(),
    F: () => app.nextFlagged() || chrome.toast("Nothing flagged yet. Skim at the core level and press <kbd>x</kbd> on anything worth a closer look.", 5000),
    a: () => { app.mark(app.focus, "reviewed"); app.nextUnreviewed(); },
    u: () => app.mark(app.focus, null),
    x: () => app.mark(app.focus, app.isFlagged(app.focus) ? null : "flagged"), // f is focus mode in every view
    c: () => { if (page()) return startComment(app, app.pageEl); app.setLevel(2); setTimeout(() => page() && startComment(app, app.pageEl)); },
    m: () => { if (page()) return startComment(app, app.pageEl, "note"); app.setLevel(2); setTimeout(() => page() && startComment(app, app.pageEl, "note")); },
    e: () => page() && expandAll(app, app.pageEl),
    Enter: () => app.setLevel(app.level + 1), "+": () => app.setLevel(app.level + 1), "=": () => app.setLevel(app.level + 1),
    Escape: () => app.setLevel(app.level - 1), "-": () => app.setLevel(app.level - 1), _: () => app.setLevel(app.level - 1),
    v: () => app.switchView(views[(views.findIndex((v) => v.id === currentId) + 1) % views.length].id),
    s: () => chrome.submit(), "?": () => chrome.help(), ",": () => chrome.settings(), p: () => chrome.park(), M: () => chrome.notes(),
    R: () => app.switchTree(),
    t: () => chrome.toggleFiles(),
    "!": () => { const e = app.entryPoint(); if (e) app.setFocus(e.pid, { level: 1 }); }, // back to the entry point
    d: () => app.toggleLayout(),
  }[k];
  if (!act) return false;
  if (learn) app.useKey(hint);
  act();
  return true;
}
// ---- command palette: every key's action by name, plus what has no key of its own
const KEYED = [
  ["Next page", "j"], ["Previous page", "k"], ["Next core", "J"], ["Previous core", "K"],
  ["Next unreviewed page", "n"], ["Next flagged page", "F"], ["Back to the entry point", "!"],
  ["Looks good: mark reviewed and move on", "a"], ["Un-mark this page", "u"], ["Flag or unflag this page", "x"],
  ["Comment on a line", "c"], ["Private note on a line", "m"], ["Your notes", "M"], ["Park a thought", "p"],
  ["Open collapsed code, then more context", "e"], ["Zoom in", "Enter"], ["Zoom out", "Escape"],
  ["Focus mode", "f"], ["Full screen page", "g"], ["Next view", "v"], ["Diff layout: inline or split", "d"],
  ["Show or hide the file tree", "t"], ["Submit review", "s"], ["Settings", ","], ["All keys", "?"],
];
const KEY_TEXT = { Enter: "enter", Escape: "esc", "!": "shift 1" };
function commands() {
  const s = app.settings, flip = (k, a, b) => app.saveSettings({ [k]: s[k] === a ? b : a });
  return [
    ...KEYED.map(([title, k]) => ({ id: `key:${k}`, title, keys: (KEY_TEXT[k] ?? k).split(" "), run: () => press(k, { learn: false }) })),
    ...(app.claudeReady && app.graph.generator.tree !== "claude" ? [{ id: "key:R", title: "Switch to Claude's tree", keys: ["R"], run: () => app.switchTree() }] : []),
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
  if (typing(ev.target) || ev.metaKey || ev.ctrlKey || ev.altKey) return;
  if (chrome.isOpen()) {
    if (ev.key === "Escape" || ev.key === "Enter") { ev.preventDefault(); chrome.close(); }
    return;
  }
  if (tour.key(ev.key)) return ev.preventDefault(); // the callout's own keys; every other key still works under it
  // Esc works on what's innermost: an open composer, then a line selection, then the view (focus mode), then the level.
  if (ev.key === "Escape" && escapeCode(app)) return ev.preventDefault();
  const k = ev.shiftKey && ev.code === "Digit1" ? "!" : ev.key; // shift+1, whatever the layout prints
  if (press(k)) ev.preventDefault();
});

window.bobby = app; // handy for debugging and tests
