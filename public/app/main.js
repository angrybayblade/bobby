import { DONE, api, createApp, esc, reviewBase } from "./core.js";
import { escapeCode, inspectorKey, inspectorOpen, expandAll, keepDraft, moveLine, renderFile, renderNode, renderPage, startComment, startFileNote } from "./code.js";
import * as chrome from "./chrome.js";
import * as palette from "./palette.js";
import * as tour from "./tour.js";
import { ACTIONS, actionFor, keyHtml, keyOfEvent, keysOf, keyText } from "./keys.js";
import views from "./views/index.js";

// Without these there's no review. A review still being built (just opened) answers "loading", with its steps so far:
// show them, in your theme, until it's ready; one that failed, or a server gone, says why and stops.
const [graph, session] = await (async () => {
  for (;;) {
    const r = await fetch(`${reviewBase}/api/graph`).catch(() => null);
    const g = r && (await r.json().catch(() => null));
    if (!r || !g) throw new Error("Bobby isn't answering. Is it still running in your terminal?");
    if (g.loading || g.error) {
      if (g.settings) look(g.settings);
      bootCard(g);
      if (g.error) return new Promise(() => {});
      await new Promise((res) => setTimeout(res, 1000));
      continue;
    }
    if (!r.ok) throw new Error(g.error ?? `${r.status} ${r.statusText}`);
    document.body.classList.remove("booting");
    return [g, await api("/api/session")];
  }
})().catch((e) => {
  bootCard({ title: "", steps: [], error: e.message });
  return new Promise(() => {});
});

/** The theme, the style and the text size, before the review's own chrome exists; remembered for the next page's first paint (index.html). */
function look(s) {
  const root = document.documentElement;
  root.dataset.theme = (s.theme ?? "system") === "system" ? (matchMedia("(prefers-color-scheme: light)").matches ? "light" : "dark") : s.theme;
  root.dataset.palette = ["warm", "silverpoint"].includes(s.palette) ? s.palette : "github";
  if (s.size) root.style.setProperty("--size", `${s.size}px`);
  try { localStorage.setItem("bobby.look", JSON.stringify({ theme: s.theme ?? "system", palette: s.palette ?? "github" })); } catch { /* private window */ }
}
/** While a review builds: the top bar with the way home and what it is, and a card of the steps so far; or why it failed. */
function bootCard({ title, steps = [], elapsed, error }) {
  document.body.classList.add("booting");
  document.title = title ? `${title} · bobby` : "bobby";
  document.querySelector("#top").innerHTML = `<a class="brand" href="/" title="Home: your PRs and recent reviews"><img src="/bobby.svg" alt="" width="22" height="22">bobby</a>${title ? `<span class="prtitle">${esc(title)}</span>` : ""}`;
  // what the build logged: a "▸" line is a step, the lines after it its details; the last step is the one under way
  const list = [];
  for (const line of steps) {
    if (line.startsWith("▸")) list.push({ step: line.replace(/^▸\s*/, "").replace(/…$/, ""), detail: [] });
    else if (line && list.length && line !== title) list.at(-1).detail.push(line.replace(/^✓\s*/, "")); // the title is already above
  }
  const rows = list.map((x, i) => {
    const now = i === list.length - 1 && !error;
    return `<li class="${now ? "now" : "done"}"><i>${now ? "" : "✓"}</i><span><b>${esc(x.step[0].toUpperCase() + x.step.slice(1))}</b>${x.detail.map((d) => `<small>${esc(d)}</small>`).join("")}</span></li>`;
  }).join("");
  const secs = elapsed != null ? Math.round(elapsed / 1000) : null;
  const view = document.querySelector("#view");
  view.innerHTML = `<div class="boot"><div class="card${error ? " failed" : ""}">
    <h2>${error ? (title ? "Couldn't build this review" : "Couldn't load the review") : "Building the review"}</h2>
    ${title ? `<div class="what">${esc(title)}</div>` : ""}
    ${rows ? `<ol>${rows}</ol>` : error ? "" : `<ol><li class="now"><i></i><span><b>Starting</b></span></li></ol>`}
    ${error ? `<p class="why">${esc(error)}</p><div class="acts"><a class="btn" href="/">Back home</a><button class="btn" onclick="location.reload()">Try again</button></div>`
      : `<div class="foot">${secs != null ? `${secs}s · ` : ""}It opens by itself when it's ready. The terminal Bobby runs in has the details.</div>`}
  </div></div>`;
}
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
  try { localStorage.setItem("bobby.look", JSON.stringify({ theme: s.theme, palette: s.palette })); } catch { /* private window */ }
  root.dataset.theme = s.theme === "system" ? (media("(prefers-color-scheme: light)") ? "light" : "dark") : s.theme;
  root.dataset.files = s.fileTreeSide === "left" ? "left" : "right";
  root.dataset.palette = ["warm", "silverpoint"].includes(s.palette) ? s.palette : "github";
  root.dataset.motion = s.motion === "system" ? (media("(prefers-reduced-motion: reduce)") ? "off" : "on") : s.motion;
  root.style.setProperty("--font-prose", FONTS[s.font] ?? FONTS.sans);
  root.style.setProperty("--size", `${s.size}px`);
  root.style.setProperty("--code-size", `${Math.round(s.size * 0.87)}px`);
  root.style.setProperty("--word-spacing", { normal: "0", wide: ".08em", wider: ".16em" }[s.spacing] ?? "0");
}
applySettings();
app.on((why) => why === "settings" && applySettings());
// System theme and motion follow the OS as it changes (dark mode at sunset), not only at load
for (const q of ["(prefers-color-scheme: light)", "(prefers-reduced-motion: reduce)"]) window.matchMedia(q).addEventListener("change", applySettings);

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
  el.querySelector(":scope > .boot")?.remove(); // the loading card, while the review was being built
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
  // remembered without a "settings" event, which would render the view just mounted again; "view" redraws the chrome
  app.settings.view = id;
  api("/api/settings", { view: id }).catch(() => {});
  app.emit("view");
};
app.on((why) => why !== "settings" && why !== "view" && current?.update?.(why));
app.on((why) => why === "settings" && current?.update?.("settings"));
// once a frame at most: a window drag fires many
let resizing = 0;
window.addEventListener("resize", () => { resizing ||= requestAnimationFrame(() => { resizing = 0; current?.update?.("resize"); }); });

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
  await keepCurrent(s);
  // quickly while something's on its way, else slowly, to hear of new comments and new work (watch.ts)
  pollTimer = setTimeout(poll, s.llm === "pending" || busy(app.servers) ? 3000 : 10_000);
}
// ---- keeping the review current: new comments on a PR appear by themselves; new work is offered, never swapped in
let seenDiscussion = null, announced = "";
async function keepCurrent(s) {
  // a newer Bobby: a quiet pill, and once per version, a toast
  if ((s.release?.version ?? null) !== (app.release?.version ?? null)) {
    app.release = s.release;
    app.emit("view");
    let seen = ""; try { seen = localStorage.getItem("bobby.release.told") ?? ""; } catch { /* private window */ }
    if (s.release && seen !== s.release.version) {
      try { localStorage.setItem("bobby.release.told", s.release.version); } catch { /* told this visit only */ }
      chrome.toast(`<span class="intro"><b>Bobby ${esc(s.release.version)} is out</b><span style="font-size:13px;color:var(--muted)">Update with <code>${esc(s.release.how ?? "")}</code>, then start Bobby again. <a href="${esc(s.release.url)}" target="_blank" rel="noopener">What's new</a></span></span>`, 15000);
    }
  }
  if (seenDiscussion === null) seenDiscussion = s.discussionAt; // as of the graph this page loaded
  else if (s.discussionAt !== seenDiscussion) {
    seenDiscussion = s.discussionAt;
    const d = await api("/api/discussion").catch(() => null);
    if (d) {
      const had = new Set((app.graph.discussion ?? []).map((c) => c.id)), fresh = d.filter((c) => !had.has(c.id) && c.author !== app.me?.login);
      app.graph.discussion = d;
      app.emit("comments");
      if (fresh.length) chrome.toast(`<span>${fresh.length} new comment${fresh.length > 1 ? "s" : ""} from ${esc([...new Set(fresh.map((c) => c.author))].join(", "))}.</span>`, 6000);
    }
  }
  const was = JSON.stringify(app.update ?? null);
  app.update = s.update && !s.update.rebuilding ? s.update : app.update?.rebuilding ? app.update : null;
  if (JSON.stringify(app.update ?? null) !== was) app.emit("view"); // the top bar's prompt
  if (app.update?.refresh && announced !== app.update.headSha) {
    announced = app.update.headSha;
    const local = app.graph.pr.provider === "local";
    chrome.toast(`<span>${local ? "Your branch has changed" : "This PR has new commits"}. Refresh to review them; what you've reviewed that they didn't change stays reviewed.</span> <button class="btn" data-act="refresh">Refresh</button>`);
  }
}
/** Moves the review to the new work: the server rebuilds, then the page reads the new graph, on the same node. */
app.refreshReview = async () => {
  if (!app.update?.refresh || app.update.rebuilding) return;
  app.update = { ...app.update, rebuilding: true };
  app.emit("view");
  const r = await api("/api/refresh", {}).catch((e) => ({ ok: false, error: e.message }));
  if (!r.ok) { app.update = { ...app.update, rebuilding: false }; app.emit("view"); return chrome.toast(`Couldn't refresh: ${esc(r.error)}`, 8000); }
  app.update = null; app.claudeReady = false;
  app.replaceGraph(await api("/api/graph"));
  chrome.toast(`<span>Up to date at ${esc(r.headSha.slice(0, 7))}. What the new work changed is unreviewed; the rest keeps its marks.</span>`, 6000);
  poll();
};
app.watchServers = poll; // after you say yes, check again or no in the UI
// How far you've got, for the home page's recents: now, and a moment after each mark
const reportProgress = () => api("/api/progress", app.progress()).catch(() => {});
let progressTimer = 0;
app.on((why) => { if (why === "marks" || why === "comments") { clearTimeout(progressTimer); progressTimer = setTimeout(reportProgress, 1500); } });
setTimeout(reportProgress, 2000);
// A call that failed with no one to catch it (a save, a delete): say so rather than nothing.
app.fail = (e) => chrome.toast(`Not saved: ${esc(e?.message ?? e)}`, 8000);
app.toastUndo = (what) => chrome.toast(`<span>${esc(what)}.</span> <button class="btn" data-act="undo">Undo</button>`, 8000);
window.addEventListener("unhandledrejection", (ev) => app.fail(ev.reason));
app.openKeys = () => chrome.keysEditor(); // for the tour's news, which can't import chrome.js
// The graph and the session are read at once: a server may have finished between them, leaving syntax-only definitions.
if (!(app.llm === "pending" || busy(app.servers)) && app.servers.some((x) => x.state === "done")) api("/api/definitions").then((d) => { app.graph.definitions = d; }, () => {});
poll(); // always: it also hears of new comments and new work

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
/** Line selection from the keyboard: on the page's code; from further out, zoom in to it first. */
const lines = (d, extend) => { if (page()) return moveLine(app, app.pageEl, d, extend); app.setLevel(2); setTimeout(() => page() && moveLine(app, app.pageEl, d, extend)); };
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
  lineDown: () => lines(1), lineUp: () => lines(-1), lineDownMore: () => lines(1, true), lineUpMore: () => lines(-1, true),
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
    { id: "set:tests", title: `${s.tests === "show" ? "Hide" : "Show"} tests`, run: () => flip("tests", "show", "hide") },
    { id: "set:generated", title: `${s.generated === "show" ? "Hide" : "Show"} generated files`, run: () => flip("generated", "show", "hide") },
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
