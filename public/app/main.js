import { DONE, api, createApp } from "./core.js";
import { expandAll, renderFile, renderNode, renderPage, startComment, startFileNote } from "./code.js";
import * as chrome from "./chrome.js";
import views from "./views/index.js";

const [graph, session] = await Promise.all([api("/api/graph"), api("/api/session")]);
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

// ---- start: resume where you were, else the first unreviewed page
const lastNode = session.state.lastNodeId;
const resume = lastNode && [...app.index.placement.values()].find((x) => x.pl.node === lastNode && !x.pl.repeatOf)?.pl.id;
// First time on this PR: start at the easiest entry point, the core with the least around it.
const entry = resume ? null : app.entryPoint();
app.focus = resume ?? entry?.pid ?? app.index.walk.find((p) => p !== DONE && !app.isReviewed(p)) ?? app.index.walk[0];
app.level = resume ? (session.state.lastLevel ?? 2) : entry ? 1 : 0;
const hash = new URLSearchParams(location.hash.slice(1)); // deep links for testing: #view=lens&level=1&p=5
if (hash.has("level")) app.level = Number(hash.get("level"));
if (hash.has("p")) app.focus = app.index.walk[Number(hash.get("p")) - 1] ?? app.focus;
mount(hash.get("view") ?? app.settings.view);
chrome.init(app, views);
if (resume && !hash.has("p") && (app.progress().done > 0 || session.state.note)) chrome.reentry();
else if (entry && !hash.has("p")) {
  const deps = entry.deps === 1 ? "1 thing" : `${entry.deps} things`;
  chrome.coreIntro(app.get(entry.pid), `<span style="color:var(--muted);font-size:13px">Start here: the core with the least around it (${deps} it relies on or affects). <kbd>esc</kbd> for the overview.</span>`);
}

// ---- keys
const typing = (t) => t.matches?.("input, textarea, [contenteditable]");
document.addEventListener("keydown", (ev) => {
  if (typing(ev.target) || ev.metaKey || ev.ctrlKey || ev.altKey) return;
  if (chrome.isOpen()) {
    if (ev.key === "Escape" || ev.key === "Enter") { ev.preventDefault(); chrome.close(); }
    return;
  }
  const k = ev.key;
  if (current?.keys?.[k]) { ev.preventDefault(); current.keys[k](); return; }
  const page = () => app.pageEl?.isConnected; // the focused node's code is on screen (page or card)
  const act = {
    j: () => app.step(1), ArrowDown: () => app.step(1), ArrowRight: () => app.step(1), " ": () => app.step(1),
    k: () => app.step(-1), ArrowUp: () => app.step(-1), ArrowLeft: () => app.step(-1),
    J: () => app.stepCore(1), K: () => app.stepCore(-1),
    n: () => app.nextUnreviewed(),
    F: () => app.nextFlagged() || chrome.toast("Nothing flagged yet. Skim at the core level and press <kbd>f</kbd> on anything worth a closer look.", 5000),
    a: () => { app.mark(app.focus, "reviewed"); app.nextUnreviewed(); },
    u: () => app.mark(app.focus, null),
    f: () => app.mark(app.focus, app.isFlagged(app.focus) ? null : "flagged"),
    c: () => { if (page()) return startComment(app, app.pageEl); app.setLevel(2); setTimeout(() => page() && startComment(app, app.pageEl)); },
    m: () => { if (page()) return startComment(app, app.pageEl, "note"); app.setLevel(2); setTimeout(() => page() && startComment(app, app.pageEl, "note")); },
    e: () => page() && expandAll(app, app.pageEl),
    Enter: () => app.setLevel(app.level + 1), "+": () => app.setLevel(app.level + 1), "=": () => app.setLevel(app.level + 1),
    Escape: () => app.setLevel(app.level - 1), "-": () => app.setLevel(app.level - 1), _: () => app.setLevel(app.level - 1),
    v: () => app.switchView(views[(views.findIndex((v) => v.id === currentId) + 1) % views.length].id),
    s: () => chrome.submit(), "?": () => chrome.help(), ",": () => chrome.settings(), p: () => chrome.park(), M: () => chrome.notes(),
    R: () => app.switchTree(),
    d: () => app.toggleLayout(),
  }[k];
  if (act) { ev.preventDefault(); app.useKey(k === "Enter" ? "enter" : k === "Escape" ? "esc" : k); act(); }
});

window.bobby = app; // handy for debugging and tests
