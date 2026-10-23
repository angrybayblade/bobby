// Everything around the view: header, where-am-I bar, key hints, overlays, toasts, settings.
import { BAND_TEXT, DONE, LEVELS, LOW, api, esc, inline } from "./core.js";
import { MOD } from "./palette.js";
import * as tour from "./tour.js";
import { ACTIONS, action, bind, bindable, kbdHtml, keyHtml, keyName, keyOfEvent, keysOf, keyText, reset, unbind } from "./keys.js";
import { bubble, nextUnresolved, prCount, togglePR, unresolved } from "./comments.js";

const $ = (q) => document.querySelector(q);
const PALETTE_KEY = MOD === "⌘" ? "⌘K" : "ctrl k";
let app, views;

export function init(a, viewList) {
  app = a; views = viewList;
  for (const r of ["focus", "level", "marks", "graph", "settings", "comments", "llm", "view"]) app.on((why) => why === r && render());
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
  $("#overlay").addEventListener("mousedown", (ev) => (downOnOverlay = ev.target.id === "overlay"));
  document.addEventListener("keydown", trapTab);
  $("#overlay").addEventListener("keydown", (ev) => {
    if (ev.target.id === "gnote" && ev.key === "Enter" && (ev.metaKey || ev.ctrlKey)) { ev.preventDefault(); addGlobalNote(); }
  });
  startTimebox();
}

export function render() {
  const back = focusAgain();
  renderTop(); renderWhere(); renderKeys(); renderFiles();
  back();
}
/** The chrome is rebuilt on most events; a control you'd tabbed to (a file, its viewed box, a top-bar button) gets
 *  focus back afterwards, found again by its data attribute. */
function focusAgain() {
  const a = document.activeElement;
  if (!a || a === document.body || !a.closest("#top, #where, #files")) return () => {};
  const attr = [...a.attributes].find((x) => x.name.startsWith("data-"));
  const sel = attr && `${a.tagName.toLowerCase()}[${attr.name}="${CSS.escape(attr.value)}"]`;
  return () => { if (sel && !a.isConnected) document.querySelector(`:is(#top, #where, #files) ${sel}`)?.focus({ preventScroll: true }); };
}

// ---------------------------------------------------------------- file tree
// The PR's files as a folder tree (single-child folder chains merged, like GitHub's), with +/− counts, comments and
// notes, and ✓ once every page in the file is reviewed. The file you're on is highlighted; a click goes to its first
// unreviewed page. Follows the Tests and Untouched switches: it lists the files the walk has.
const closedDirs = new Set();
let fileFilter = "";
export function toggleFiles() {
  app.saveSettings({ fileTree: app.settings.fileTree === "hide" ? "show" : "hide" });
  window.dispatchEvent(new Event("resize")); // the view's width changed
}
function filesOf() {
  const files = new Map();
  for (const pid of app.index.walk) {
    const loc = app.get(pid);
    if (!loc || loc.pl.repeatOf) continue;
    const n = app.nodeOf(pid), path = n.kind === "change" ? n.file : n.location.path;
    const f = files.get(path) ?? files.set(path, { path, pids: [], a: 0, d: 0, changed: false, core: false, nodes: new Set() }).get(path);
    f.pids.push(pid);
    if (loc.pl.band === "core") f.core = true;
    if (n.kind === "change") { f.changed = true; if (!f.nodes.has(n.id)) { f.nodes.add(n.id); const s = app.stat(pid); f.a += s.a; f.d += s.d; } }
  }
  return files;
}
/** L0, L1, L-1: how far the file is from the core change in the current core's tree (the one you're on); a file
 *  outside it shows its own closest level, faint. */
const lvlTag = (path) => {
  const core = app.get(app.focus)?.core;
  const here = core ? app.fileLevel(path, core) : undefined;
  const l = here ?? app.fileLevel(path);
  if (l == null) return "";
  const what = l === 0 ? "a core change" : l > 0 ? `${l} step${l > 1 ? "s" : ""} downstream: affected by the change` : `${-l} step${l < -1 ? "s" : ""} upstream: relied on by the change`;
  const where = here != null ? `in core ${app.get(app.focus).ci + 1}` : "in another core";
  return `<span class="flvl ${l === 0 ? "l0" : l > 0 ? "dn" : "up"} ${here == null ? "other" : ""}" title="Level ${l} ${where} · ${what}">L${l}</span>`;
};
function renderFiles() {
  const el = $("#files");
  if (!el) return;
  el.hidden = app.settings.fileTree === "hide";
  if (el.hidden) return;
  if (!el.querySelector(".flist")) {
    el.innerHTML = `<div class="fhd"><input type="search" placeholder="Filter files…" aria-label="Filter files"><span class="fn"></span><button class="fside" data-fside="1" title="Move the file tree to the other side">⇄</button></div><div class="flist"></div>`;
    el.querySelector("input").addEventListener("input", (ev) => { fileFilter = ev.target.value; renderFiles(); });
    // double-click a file: as close as it gets (Diff: the viewer zoomed in, at the top of the stage; elsewhere, its page)
    el.addEventListener("dblclick", (ev) => {
      const t = ev.target.closest("[data-ffile]");
      if (!t) return;
      // after the clicks' own focus move has settled the camera
      setTimeout(() => { if (!app.zoomToFile?.(t.dataset.ffile)) app.setLevel(2); }, 60);
    });
    el.addEventListener("click", (ev) => {
      if (ev.target.closest("[data-fside]")) { app.saveSettings({ fileTreeSide: app.settings.fileTreeSide === "left" ? "right" : "left" }); return window.dispatchEvent(new Event("resize")); }
      const fr = ev.target.closest("[data-fread]");
      if (fr) { ev.stopPropagation(); return app.markFile(fr.dataset.fread); }
      const t = ev.target.closest("[data-fdir],[data-ffile]");
      if (!t) return;
      if (t.dataset.fdir != null) { closedDirs.has(t.dataset.fdir) ? closedDirs.delete(t.dataset.fdir) : closedDirs.add(t.dataset.fdir); const back = focusAgain(); renderFiles(); return back(); }
      const f = filesOf().get(t.dataset.ffile);
      const to = f && (f.pids.find((p) => !app.isReviewed(p)) ?? f.pids[0]);
      if (to) app.setFocus(to, { level: Math.max(1, app.level) });
    });
  }
  const files = filesOf();
  const cur = app.nodeOf(app.focus), curPath = cur && (cur.kind === "change" ? cur.file : cur.location.path);
  const q = fileFilter.trim().toLowerCase();
  const talk = (path) => app.state.comments.filter((c) => c.path === path).length + app.state.notes.filter((n) => n.path === path).length + (app.graph.discussion ?? []).filter((c) => c.path === path).length;
  // Build the folder tree, then merge single-child chains.
  const root = { dirs: new Map(), files: [] };
  for (const f of files.values()) {
    if (q && !f.path.toLowerCase().includes(q)) continue;
    const parts = f.path.split("/"), name = parts.pop();
    let d = root;
    for (const p of parts) d = d.dirs.get(p) ?? d.dirs.set(p, { dirs: new Map(), files: [] }).get(p);
    d.files.push({ name, f });
  }
  const rows = [];
  const walk = (d, depth, prefix) => {
    for (const [name0, sub0] of [...d.dirs].sort((a, b) => a[0].localeCompare(b[0]))) {
      let name = name0, sub = sub0;
      while (sub.dirs.size === 1 && !sub.files.length) { const [n, s] = [...sub.dirs][0]; name += `/${n}`; sub = s; }
      const path = prefix + name, closed = closedDirs.has(path) && !(curPath ?? "").startsWith(path + "/");
      const count = (x) => x.files.length + [...x.dirs.values()].reduce((n, y) => n + count(y), 0);
      rows.push(`<button class="fdir" data-fdir="${esc(path)}" style="--d:${depth}" title="${esc(path)}"><span class="car">${closed ? "▸" : "▾"}</span><span>${esc(name)}</span>${closed ? `<small>${count(sub)}</small>` : ""}</button>`);
      if (!closed) walk(sub, depth + 1, path + "/");
    }
    for (const { name, f } of d.files.sort((a, b) => a.name.localeCompare(b.name))) {
      const done = f.pids.every((p) => app.isReviewed(p)), n = talk(f.path);
      // the viewed box is a button of its own beside the row's, so the keyboard reaches it too
      rows.push(`<div class="frow"><button class="ffile ${f.path === curPath ? "cur" : ""} ${done ? "done" : ""}" data-ffile="${esc(f.path)}" style="--d:${depth}" title="${esc(f.path)}"><i class="glyph ${f.core ? "core" : f.changed ? "change" : "context"}"></i><span class="nm">${esc(name)}</span>${lvlTag(f.path)}${n ? `<span class="fc">◂ ${n}</span>` : ""}${f.changed ? `<span class="fs"><span class="a">+${f.a}</span> <span class="d">−${f.d}</span></span>` : ""}</button><button class="ok${done ? " on" : ""}" data-fread="${esc(f.path)}" role="checkbox" aria-checked="${done}" aria-label="${done ? "Unmark" : "Mark"} ${esc(name)} viewed" title="${done ? "Unmark the whole file" : "Mark the whole file viewed"}">${done ? "✓" : ""}</button></div>`);
    }
  };
  walk(root, 0, "");
  el.querySelector(".fn").textContent = `${files.size} file${files.size === 1 ? "" : "s"}`;
  el.querySelector(".flist").innerHTML = rows.join("") || `<div class="none">No files match</div>`;
  el.querySelector(".ffile.cur")?.scrollIntoView({ block: "nearest" });
}

/** New work on the PR or the branch (watch.ts), offered as GitHub does: a prompt to refresh, never a swap. */
function updatePill() {
  const rel = app.release ? `<a class="pill" href="${esc(app.release.url)}" target="_blank" rel="noopener" title="Bobby ${esc(app.release.version)} is out. Update with: ${esc(app.release.how ?? "")}">Update · ${esc(app.release.version)}</a>` : "";
  return rel + reviewPill();
}
function reviewPill() {
  const u = app.update;
  if (!u) return "";
  if (!u.refresh) return `<span class="pill" title="${esc(u.detail)}">Branch switched</span>`;
  const what = u.detail === "new commits" ? "New commits" : u.detail === "changed files" ? "Files changed" : "Base changed";
  return `<button class="pill signal" data-act="refresh" title="${esc(u.detail)}: refresh to review them"${u.rebuilding ? " disabled" : ""}>${u.rebuilding ? "Refreshing…" : `${what} · Refresh`}</button>`;
}
function renderTop() {
  const { done, total, mins } = app.progress();
  const pct = total ? Math.round((done / total) * 100) : 100;
  const g = app.graph;
  const llm = app.llm === "pending" ? `<span class="pill pulse" title="The static tree is usable now">Claude is organising…</span>`
    : app.claudeReady && g.generator.tree !== "claude" ? `<button class="pill signal" data-act="switch-tree">Smarter tree ready · ${esc(keyText(keysOf(app.settings, "switchTree")[0] ?? ""))}</button>` : "";
  const lsp = app.servers.map(serverChip).join("");
  const drafts = app.state.comments.filter((c) => !c.wip && c.kind !== "note").length; // unfinished drafts aren't ready to post
  $("#top").innerHTML = `
    <a class="brand" href="/" title="Home: your PRs and recent reviews"><img src="/bobby.svg" alt="" width="22" height="22">bobby</a>
    ${g.pr.provider === "local" ? `<span class="prtitle" title="Local review: ${esc(g.pr.branch)} compared with ${esc(g.pr.baseRef)}">⎇ ${esc(g.pr.branch)} → ${esc(g.pr.baseRef)} · ${esc(g.pr.title)}</span>`
      : g.pr.commit // one commit (or a range) of the PR: which, with a link to it on GitHub
        ? `<a class="prtitle" href="${esc(`${g.pr.url}/changes/${g.pr.commit.from ? `${g.pr.commit.from}..` : ""}${g.pr.commit.sha}`)}" target="_blank" rel="noopener" title="${esc(`#${g.pr.number} ${g.pr.title}`)}">#${g.pr.number} · ${g.pr.commit.from ? `${esc(g.pr.commit.from.slice(0, 7))}..` : ""}${esc(g.pr.commit.sha.slice(0, 7))} ${esc(g.pr.commit.subject)}</a>`
        : `<a class="prtitle" href="${esc(g.pr.url)}" target="_blank" rel="noopener">#${g.pr.number} ${esc(g.pr.title)}</a>`}
    ${updatePill()}${llm}${lsp}
    ${coreProgress()}
    <div class="prog" title="${done} of ${total} pages reviewed"><div class="bar"><i style="width:${pct}%"></i></div>${done}/${total}${mins && done < total ? ` · ~${mins}m` : ""}</div>
    <div class="seg" role="group" aria-label="View">${views.map((v) => `<button data-view="${v.id}" aria-pressed="${app.viewId === v.id}" title="${esc(v.hint)} (${esc(keysOf(app.settings, "nextView").map(keyText)[0] ?? "")})">${esc(v.name)}</button>`).join("")}</div>
    ${drafts ? `<button class="pill signal" data-act="submit">${drafts} draft${drafts > 1 ? "s" : ""} · ${esc(keyText(keysOf(app.settings, "submit")[0] ?? ""))}</button>` : ""}
    <button class="pill tog" data-act="tests" aria-pressed="${app.settings.tests === "show"}" title="Test files, in every view: ${app.settings.tests === "show" ? "shown. Click to hide" : "hidden. Click to show"}">⚗ Tests</button>
    <button class="pill tog" data-act="generated" aria-pressed="${app.settings.generated === "show"}" title="Generated files (openapi specs, __generated__/, @generated, DO NOT EDIT…), in every view: ${app.settings.generated === "show" ? "shown. Click to hide" : "hidden. Click to show"}">⚙ Generated</button>
    <button class="pill tog" data-act="untouched" aria-pressed="${app.settings.untouched !== "hide"}" title="Untouched code the changes rely on or affect, in every view: ${app.settings.untouched === "hide" ? "hidden. Click to show" : "shown. Click to hide"}">○ Untouched</button>
    <button class="pill" data-act="notes" title="Your private notes (${esc(keyName(app.settings, "notes"))}). Never posted to GitHub.">✎ Notes${app.state.notes.length ? ` · ${app.state.notes.length}` : ""}</button>
    ${unresolvedButton()}${commentsButton()}
    <button class="iconbtn" data-act="files" aria-pressed="${app.settings.fileTree !== "hide"}" title="File tree (${esc(keysOf(app.settings, "files").map(keyText)[0] ?? "")})" aria-label="File tree">▤</button>
    <button class="iconbtn" data-act="settings" title="Settings (${esc(keyName(app.settings, "settings"))})" aria-label="Settings">${GEAR}</button>`;
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
    ${nc ? `<span style="font-size:13px;color:var(--muted)">Next: core ${next + 1} · ${esc(nc.title)}</span>${nc.hook ? `<span class="hook">${inline(nc.hook)}</span>` : ""}` : `<span style="font-size:13px">That was the last core. ${keyHtml(app.settings, "submit")} to submit.</span>`}</span>`, 12000);
}

function renderWhere() {
  const pid = app.focus;
  const loc = app.get(pid);
  const crumbs = [`<button data-level="0" class="${app.level === 0 ? "here" : ""}">${esc(app.graph.pr.repo)} ${app.graph.pr.provider === "local" ? `⎇ ${esc(app.graph.pr.branch)}` : `#${app.graph.pr.number}${app.graph.pr.commit ? ` @ ${esc(app.graph.pr.commit.sha.slice(0, 7))}` : ""}`}</button>`];
  if (loc) {
    crumbs.push(`<button data-level="1" class="${app.level === 1 ? "here" : ""}">${loc.ci + 1} · ${esc(loc.core.title)}</button>`);
    crumbs.push(`<button data-level="2" class="${app.level === 2 ? "here" : ""}"><i class="glyph ${loc.pl.band === "core" ? "core" : app.nodeOf(pid).kind}" style="margin-right:6px"></i>${esc(loc.pl.title)}</button>`);
  } else if (pid === LOW) crumbs.push(`<button data-level="2" class="here">Low-signal changes</button>`);
  else if (pid === DONE) crumbs.push(`<button class="here">End</button>`);
  const note = app.state.note ? `<button data-act="note" title="Your parked thought (${esc(keyName(app.settings, "park"))})" style="color:var(--signal)">📌 ${esc(app.state.note.slice(0, 48))}${app.state.note.length > 48 ? "…" : ""}</button>` : "";
  $("#where").innerHTML = `${crumbs.join(`<span class="sep">›</span>`)}${note}
    <span class="seg lay" role="group" aria-label="Diff layout" title="Diff layout for every file (${esc(keyName(app.settings, "layout"))})">${[["inline", "Inline"], ["split", "Split"]].map(([v, t]) => `<button data-act="layout" data-val="${v}" aria-pressed="${app.settings.diffLayout === v}">${t}</button>`).join("")}</span>
    <span class="levels" title="Zoom: ${LEVELS[app.level]} (enter / esc)">${LEVELS.map((_, i) => `<i class="${i <= app.level ? "on" : ""}"></i>`).join("")}<span style="margin-left:6px">${LEVELS[app.level]}</span></span>`;
}

// Hints by action (keys.js), so they show your keys. Each fades once you've used it five times.
const HINTS = [[["next", "prev"], "next / back"], [["zoomIn"], "zoom in"], [["nextView"], "switch view"]];
const HINTS_BY_LEVEL = {
  0: [[["next", "prev"], "step"], [["zoomIn"], "open core"], [["nextView"], "switch view"]],
  1: [[["next", "prev"], "step"], [["focus"], "focus"], [["fullScreen"], "full screen"], [["flag"], "flag for later"], [["reviewed"], "looks good →"], [["comment"], "comment"], [["expand"], "open / more"], [["zoomOut"], "overview"]],
  2: [[["next", "prev"], "next / back"], [["fullScreen"], "back"], [["reviewed"], "looks good →"], [["flag"], "flag"], [["comment"], "comment"], [["expand"], "open / more"], [["park"], "park a thought"], [["zoomOut"], "zoom out"]],
};
// Counts kept before keys were customizable were by key name: still honoured, so learned hints stay hidden.
const LEGACY = { next: "j", prev: "k", zoomIn: "enter", zoomOut: "esc", nextView: "v", focus: "f", fullScreen: "g", flag: "x", reviewed: "a", comment: "c", expand: "e", park: "p" };
function renderKeys() {
  const mode = app.settings.hints;
  const uses = app.settings.hintUses ?? {}, used = (id) => Math.max(uses[id] ?? 0, uses[LEGACY[id]] ?? 0);
  const trail = app.viewId === "diff" && app.level < 2 ? [[["left", "right"], "back / forth"]] : []; // Diff's node history
  const list = [...(HINTS_BY_LEVEL[app.level] ?? HINTS).slice(0, 1), ...trail, ...(HINTS_BY_LEVEL[app.level] ?? HINTS).slice(1)].filter(([ids]) => ids.every((id) => keysOf(app.settings, id).length) && (mode === "always" || (mode === "fade" && ids.some((id) => used(id) < 5))));
  const help = keyHtml(app.settings, "help");
  $("#keys").innerHTML = (mode === "never" ? `<span>${help} keys</span>`
    : [...list.map(([ids, label]) => `<span>${ids.map((id) => keyHtml(app.settings, id)).join(" ")} ${label}</span>`), `<span>${help} all keys</span>`, `<span>${PALETTE_KEY.split(" ").map((k) => `<kbd>${k}</kbd>`).join(" ")} commands</span>`].join("")) + tour.newsChip();
}

// ---------------------------------------------------------------- overlays
export const isOpen = () => !$("#overlay").hidden;
let downOnOverlay = false; // the click began on the backdrop itself
let returnTo = null; // what had focus before a dialog opened, to give it back
function open(html, cls = "") {
  const o = $("#overlay");
  if (o.hidden) returnTo = document.activeElement;
  o.innerHTML = `<div class="modal ${cls}" role="dialog" aria-modal="true" tabindex="-1">${html}</div>`;
  o.hidden = false;
  (o.querySelector("textarea") ?? o.querySelector(".btn.primary") ?? o.querySelector(".modal"))?.focus();
}
export function close() {
  $("#overlay").hidden = true;
  if (returnTo?.isConnected && returnTo !== document.body) returnTo.focus({ preventScroll: true });
  returnTo = null;
}
/** Tab stays inside an open dialog, wrapping at its ends, as the page behind it can't be used. */
function trapTab(ev) {
  if (ev.key !== "Tab" || !isOpen()) return;
  const all = [...$("#overlay").querySelectorAll("button, a[href], input, textarea, select, [tabindex]:not([tabindex='-1'])")].filter((x) => !x.disabled && x.offsetParent);
  if (!all.length) return;
  const i = all.indexOf(document.activeElement), to = ev.shiftKey ? (i <= 0 ? all.at(-1) : null) : (i === all.length - 1 || i < 0 ? all[0] : null);
  if (to) { ev.preventDefault(); to.focus(); }
}

export function help() {
  const keysCell = (id) => keysOf(app.settings, id).map(kbdHtml).join(" <span class=\"or\">or</span> ") || `<span class="unbound">unbound</span>`;
  const groups = [...new Set(ACTIONS.map((a) => a.group))];
  open(`<h2>How the walk works</h2>
    <p>Each core change comes with its surroundings, in this order: <b>untouched code it relies on</b> → <b>changed code it relies on</b> → <b>the core</b> → <b>changed code it affects</b> → <b>untouched code it affects</b>. Solid dots ● are changed code, hollow ○ are untouched, and ◆ is the core.</p>
    ${groups.map((g) => `<h4 class="nh">${g}</h4><table>${ACTIONS.filter((a) => a.group === g).map((a) => `<tr><td>${keysCell(a.id)}</td><td>${esc(a.title)}</td></tr>`).join("")}</table>`).join("")}
    <table><tr><td>${PALETTE_KEY.split(" ").map((k) => `<kbd>${k}</kbd>`).join(" ")}</td><td>Command palette: search every command, core, file and page</td></tr>
      <tr><td>${MOD}-click</td><td>Inspect a name: where it's declared, its type and its code</td></tr>
      <tr><td>${MOD}⇧-click</td><td>Where a name is used: in the diff first, then the PR's files, then the rest of the codebase</td></tr></table>
    <div class="row"><button class="btn primary" data-act="close">Got it</button><button class="btn" data-act="keys">Customize keys</button><button class="btn" data-act="tour">Take the tour</button></div>`);
}

// ---------------------------------------------------------------- customizing keys
// Every action, its keys as chips (✕ removes one), + to bind another by pressing it, and a reset for what you changed.
// A key already bound elsewhere moves here, and the editor says where it came from. Saved in settings.keys.
let recording = null, moved = "";
export function keysEditor() {
  recording = null; moved = "";
  drawKeys(true);
}
function drawKeys(first = false) {
  const top = first ? 0 : $("#overlay .modal.keys")?.scrollTop ?? 0; // redrawn as you bind: stay where you were
  const mine = app.settings.keys ?? {}, groups = [...new Set(ACTIONS.map((a) => a.group))];
  const row = (a) => {
    const chips = keysOf(app.settings, a.id).map((k) => `<span class="kchip">${kbdHtml(k)}<button data-act="key-unbind" data-id="${a.id}" data-key="${esc(k)}" aria-label="Remove ${esc(keyText(k))}" title="Remove">✕</button></span>`).join("");
    const add = recording === a.id ? `<span class="krec">press a key… <span class="faint">esc to cancel</span></span>` : `<button class="kadd" data-act="key-add" data-id="${a.id}" title="Bind another key">+</button>`;
    const changed = mine[a.id] ? `<button class="kreset" data-act="key-reset" data-id="${a.id}" title="Back to ${action(a.id).keys.map(keyText).join(", ") || "no keys"}">reset</button>` : "";
    return `<tr${recording === a.id ? ` class="rec"` : ""}><td>${esc(a.title)}</td><td><div class="kcell">${chips || `<span class="unbound">unbound</span>`}${add}${changed}</div></td></tr>`;
  };
  open(`<h2>Keyboard shortcuts</h2>
    <p>Click + and press a key to bind it; a key bound elsewhere moves here. Esc still closes what's open first. Saved for every review.</p>
    ${moved ? `<div class="kmoved">${moved}</div>` : ""}
    ${groups.map((g) => `<h4 class="nh">${g}</h4><table class="ktable">${ACTIONS.filter((a) => a.group === g).map(row).join("")}</table>`).join("")}
    <div class="row">${Object.keys(mine).length ? `<button class="btn" data-act="key-reset-all">Reset all to defaults</button>` : ""}<button class="btn primary" data-act="close" style="margin-left:auto">Done</button></div>`, "keys");
  const m = $("#overlay .modal.keys");
  m.querySelector(".btn.primary")?.focus({ preventScroll: true });
  m.scrollTop = top;
}
function keyEdit(act, id, key) {
  if (act === "key-add") { recording = id; moved = ""; return drawKeys(); }
  const next = act === "key-unbind" ? unbind(app.settings, id, key) : act === "key-reset" ? reset(app.settings, id) : {};
  moved = "";
  app.saveSettings({ keys: next });
  drawKeys();
}
// While recording, the next key is the binding; nothing else gets it.
addEventListener("keydown", (ev) => {
  if (!recording) return;
  ev.preventDefault();
  ev.stopImmediatePropagation();
  if (ev.key === "Escape") { recording = null; return drawKeys(); }
  if (!bindable(ev)) return;
  const key = keyOfEvent(ev), id = recording;
  const { from, keys } = bind(app.settings, id, key);
  recording = null;
  moved = from ? `${kbdHtml(key)} was bound to <b>${esc(action(from).title)}</b>; it's here now.${keysOf({ keys }, from).length ? "" : ` That action has no key left.`}` : "";
  app.saveSettings({ keys });
  drawKeys();
}, true);

const SETTINGS = [
  ["palette", "Style", [["github", "GitHub"], ["warm", "Warm"], ["silverpoint", "Silverpoint"]]],
  ["theme", "Theme", [["system", "System"], ["dark", "Dark"], ["light", "Light"]]],
  ["font", "Reading font", [["sans", "Sans"], ["hyper", "Hyperlegible"], ["serif", "Serif"], ["mono", "Mono"]]],
  ["size", "Text size", [[14, "14"], [15, "15"], [16, "16"], [18, "18"]]],
  ["spacing", "Word spacing", [["normal", "Normal"], ["wide", "Wide"], ["wider", "Wider"]]],
  ["motion", "Motion", [["system", "System"], ["on", "On"], ["off", "Off"]]],
  ["hints", "Key hints", [["fade", "Fade when learned"], ["always", "Always"], ["never", "Hidden"]]],
  ["diffLayout", "Diff layout", [["split", "Split"], ["inline", "Inline"]]],
  ["edges", "Diff edges", [["all", "All, faint"], ["focus", "Focused only"]]],
  ["timebox", "Break reminder", [[0, "Off"], [15, "15m"], [25, "25m"], [45, "45m"]]],
  ["rabbit", "Rabbit-hole nudge", [[0, "Off"], [8, "8m"], [12, "12m"], [20, "20m"]]],
  ["drift", "Drift prompt", [["on", "On"], ["off", "Off"]]],
  ["comments", "Comments", [["open", "Open"], ["collapsed", "Collapsed"]]],
  ["updates", "Tell me about new versions", [["on", "On"], ["off", "Off"]]],
  ["untouched", "Untouched code", [["hide", "Hidden"], ["show", "Shown"]]],
  ["fileTree", "File tree", [["show", "Shown"], ["hide", "Hidden"]]],
  ["fileTreeSide", "File tree side", [["right", "Right"], ["left", "Left"]]],
  ["tests", "Test files", [["hide", "Hidden"], ["show", "Shown"]]],
  ["generated", "Generated files", [["hide", "Hidden"], ["show", "Shown"]]],
];
export function settings() {
  open(`<h2>Settings</h2><p>Changes apply immediately and are remembered.</p>
    ${SETTINGS.map(([key, label, opts]) => `<div class="setting"><label>${label}</label><div class="seg">${opts.map(([v, t]) =>
      `<button data-set="${key}" data-val="${v}" aria-pressed="${String(app.settings[key]) === String(v)}">${t}</button>`).join("")}</div></div>`).join("")}
    <div class="row"><button class="btn" data-act="keys">Keyboard shortcuts…</button><button class="btn primary" data-act="close" style="margin-left:auto">Done</button></div>`);
}

export function submit(msg) {
  const cs = app.state.comments.filter((c) => !c.wip && c.kind !== "note");
  const wip = app.state.comments.length - cs.length;
  if (app.graph.pr.provider === "local") return open(`<h2>Nothing to post to</h2>
    <p>This is a local review of <b>⎇ ${esc(app.graph.pr.branch)}</b>, with no PR behind it, so your ${cs.length ? `${cs.length} draft(s)` : "drafts"} and notes stay here. Open a PR and review it with <code>bobby &lt;number&gt;</code> to post a review on GitHub.</p>
    <div style="font-size:13px;color:var(--muted);margin-top:10px">${cs.map((c) => `· <code>${esc(c.path)}:${c.line}</code> ${esc(c.body.slice(0, 70))}`).join("<br>")}</div>
    <div class="row"><button class="btn" data-act="close" style="margin-left:auto">Close</button></div>`);
  // as the server decides: a draft whose line (or range start) the current diff no longer has goes in the summary
  const one = !!app.graph.pr.commit; // one commit of the PR: only its added lines (see the server's submit)
  const lines = new Set(app.graph.hunks.flatMap((h) => h.lines.flatMap((l) => one ? (l.t === "+" ? [`${h.file}:RIGHT:${l.n}`] : []) : [...(l.n != null && l.t !== "-" ? [`${h.file}:RIGHT:${l.n}`] : []), ...(l.o != null && l.t !== "+" ? [`${h.file}:LEFT:${l.o}`] : [])])));
  const inline = (c) => c.inDiff && lines.has(`${c.path}:${c.side}:${c.line}`) && (!c.startLine || lines.has(`${c.path}:${c.startSide ?? c.side}:${c.startLine}`));
  open(`<h2>Submit review</h2>
    <p>${cs.length ? `${cs.length} draft comment(s) will be posted together.` : "No draft comments."}${app.state.notes.length ? ` Your ${app.state.notes.length} private note(s) stay here and aren't posted.` : ""}${wip ? ` ${wip} unfinished draft${wip > 1 ? "s" : ""} stay${wip > 1 ? "" : "s"} behind: finish ${wip > 1 ? "them" : "it"} with <i>Continue</i> to include ${wip > 1 ? "them" : "it"}.` : ""}</p>
    <textarea id="rbody" placeholder="Summary (optional for Approve)"></textarea>
    <div class="rdrafts">${cs.map((c) => `<div class="rdraft"><code>${esc(c.path)}:${c.line}</code><span>${esc(c.body)}</span>${inline(c) ? "" : "<i>goes in summary</i>"}</div>`).join("")}</div>
    <div class="row">
      <button class="btn primary" data-submit="COMMENT">Comment</button>
      <button class="btn" data-submit="APPROVE">Approve</button>
      <button class="btn" data-submit="REQUEST_CHANGES">Request changes</button>
      <button class="btn" data-act="close" style="margin-left:auto">Cancel</button>
    </div>${msg ? `<div class="err">${esc(msg)}</div>` : ""}`);
}
let posting = false; // one review at a time: a second click while one is on its way would post it twice
async function doSubmit(event) {
  if (posting) return;
  posting = true;
  document.querySelectorAll("[data-submit]").forEach((b) => (b.disabled = true));
  const body = $("#rbody").value;
  const r = await api("/api/submit", { event, body }).catch((e) => ({ ok: false, error: e.message })).finally(() => (posting = false));
  if (!r.ok) { submit(r.error); $("#rbody").value = body; return; } // the summary you wrote stays
  app.state.comments = app.state.comments.filter((c) => c.wip || c.kind === "note"); // unfinished drafts remain
  if (r.discussion) { app.graph.discussion = r.discussion; app.graph.outdated = r.outdated ?? []; } // what was just posted, now on GitHub
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
let resumeTo = null;
export function reentry(pid, level) {
  resumeTo = { pid, level };
  const loc = app.get(pid);
  const { done, total } = app.progress();
  const flagged = app.index.walk.filter((p) => p !== DONE && app.isFlagged(p)).length;
  const ago = app.state.lastSeenAt ? timeAgo(new Date(app.state.lastSeenAt)) : "";
  open(`<h2>Welcome back</h2>
    <p>${done} of ${total} reviewed${flagged ? ` · ${flagged} flagged` : ""}${app.state.comments.length ? ` · ${app.state.comments.length} draft comment(s)` : ""}${ago ? ` · last here ${ago}` : ""}</p>
    ${loc ? `<div class="where"><span style="color:var(--muted);font-size:13px">You were in core ${loc.ci + 1}, <b style="display:inline;font-family:inherit">${esc(loc.core.title)}</b>, on ${esc(BAND_TEXT[loc.pl.band].toLowerCase())}:</span><b>${esc(loc.pl.title)}</b></div>` : ""}
    ${app.state.note ? `<div class="parked">📌 ${esc(app.state.note)}</div>` : ""}
    <div class="row"><button class="btn primary" data-act="close">Start at the entry point <kbd style="margin-left:6px">enter</kbd></button><button class="btn" data-act="resume">Back to where you were</button><button class="btn" data-act="overview">See the overview first</button></div>`, "reentry");
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
    const away = Date.now() - last > AWAY_MS;
    last = Date.now(); // first: a recap that fails mustn't stop the clock, and every nudge with it
    if (away) welcomeBackLite();
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
  const before = trail.filter((p) => p !== app.focus).map((p) => app.get(p)).filter(Boolean).slice(-2).map((l) => esc(l.pl.title)); // pages of a tree you've since switched from are gone
  toast(`<span class="intro"><b>Welcome back</b><span style="font-size:13px">You were on <b>${esc(loc.pl.title)}</b> · core ${loc.ci + 1}, ${esc(loc.core.title)}</span>
    ${before.length ? `<span style="font-size:13px;color:var(--muted)">Before that: ${before.join(" → ")}</span>` : ""}
    ${app.state.note ? `<span style="font-size:13px">📌 ${esc(app.state.note)}</span>` : ""}
    ${loc.core.hook ? `<span class="hook">${inline(loc.core.hook)}</span>` : ""}</span>`, 15000);
}

// Every comment in the PR, open or collapsed in place: filled when they're showing.
function commentsButton() {
  const n = prCount(app), open = (app.settings.comments ?? "open") === "open";
  return n ? `<button class="pill cmpill" data-act="pr-comments" aria-pressed="${open}" title="${open ? "Collapse" : "Show"} every comment in the PR">${bubble(open)} ${n}</button>` : "";
}

// GitHub's threads still open, as GitHub counts them on the PR: a click (or N) goes through them.
function unresolvedButton() {
  const n = unresolved(app).length;
  return n ? `<button class="pill unrpill" data-act="next-unresolved" title="Go to the next unresolved thread (${esc(keyName(app.settings, "nextUnresolved"))})">${n} unresolved</button>` : "";
}

// ---------------------------------------------------------------- language servers
// A chip for each language whose server needs you (a yes, something to install) or is on its way; nothing once it's up.
function serverChip(s) {
  const t = esc(s.title), act = `data-act="server" data-id="${esc(s.id)}"`;
  if (s.state === "consent") return `<button class="pill signal" ${act} title="Install the ${t} language server for types in ${t} code">${t} types · set up?</button>`;
  if (s.state === "missing") return `<button class="pill" ${act} title="${esc(s.hint ?? "")}">${t} types · needs setup</button>`;
  if (s.state === "installing") return `<span class="pill pulse">Installing ${t} types…</span>`;
  if (s.state === "pending") return `<span class="pill pulse" title="The ${t} language server is loading the project. Until it's ready, ${MOD}-click on a name finds what imports can">${t} types loading…</span>`;
  if (s.state === "failed") return `<button class="pill" ${act} title="${esc(s.error ?? "")}">${t} types off</button>`;
  return "";
}
/** What a language server would bring, and the choices: install (Bobby can) or how to (you install it), not now, never. */
function serverCard(id) {
  const s = app.servers.find((x) => x.id === id);
  if (!s) return;
  const t = esc(s.title), btn = (act, label, primary = false) => `<button class="btn${primary ? " primary" : ""}" data-act="${act}" data-id="${esc(id)}">${label}</button>`;
  const why = `<p>With it, ${MOD}-click and hover know locals, methods called on values, and types in ${t} code. Without it, they find what imports can.</p>`;
  const later = `<div class="row">${s.state === "failed" ? btn("srv-install", "Try again", true) : ""}${btn("srv-later", "Not now")}${btn("srv-never", `Never for ${t}`)}</div>`;
  if (s.state === "consent") return open(`<h2>Set up ${t} types?</h2>${why}
    <dl class="srvfacts"><dt>Installs</dt><dd>${esc(s.offer?.from ?? "")}</dd><dt>Size</dt><dd>${esc(s.offer?.size ?? "")}</dd><dt>Into</dt><dd><code>~/.bobby/servers</code></dd><dt>Runs</dt><dd>Only while Bobby does. It reads the PR's code and never runs it.</dd></dl>
    <div class="row">${btn("srv-install", "Install", true)}${btn("srv-later", "Not now")}${btn("srv-never", `Never for ${t}`)}</div>`);
  if (s.state === "missing") return open(`<h2>${t} types need setup</h2>${why}<p>${esc(s.hint ?? "")}</p>
    ${s.command ? `<pre class="srvcmd"><code>${esc(s.command)}</code></pre>` : ""}
    <div class="row">${s.command ? `${btn("srv-copy", "Copy command")}${btn("srv-check", "Check again", true)}` : ""}${btn("srv-later", "Not now")}${btn("srv-never", `Never for ${t}`)}</div>`);
  if (s.state === "failed") return open(`<h2>${t} types are off</h2><p>The ${t} language server isn't running: ${esc(s.error ?? "")}</p><p>${MOD}-click and hover still find what imports can.</p>${later}`);
}
async function serverAction(act, id) {
  if (act === "srv-copy") { const s = app.servers.find((x) => x.id === id); await navigator.clipboard?.writeText(s?.command ?? "").catch(() => {}); return toast("Copied. Run it in a terminal, then Check again.", 3000); }
  const path = { "srv-install": "install", "srv-check": "check", "srv-later": "decline", "srv-never": "decline" }[act];
  const r = await api(`/api/servers/${path}`, { id, never: act === "srv-never" }).catch((e) => (toast(esc(e.message), 6000), {}));
  if (r.servers) app.servers = r.servers;
  close();
  app.emit("llm");
  app.watchServers?.();
  const s = app.servers.find((x) => x.id === id);
  if (act === "srv-check" && s?.state === "missing") serverCard(id); // still not there: say so again
}

// ---------------------------------------------------------------- clicks
function onClick(ev) {
  const lay = ev.target.closest("[data-flayout]");
  if (lay) return app.toggleLayout(lay.dataset.flayout);
  const t = ev.target.closest("[data-act],[data-view],[data-level],[data-set],[data-submit],[data-gdel],[data-gonote]");
  if (!t) { if (ev.target.id === "overlay" && downOnOverlay) close(); return; } // not the end of a text selection dragged out
  const ds = t.dataset;
  if (ds.view) app.switchView(ds.view);
  else if (ds.level) app.setLevel(Number(ds.level));
  else if (ds.set) { const v = /^\d+$/.test(ds.val) ? Number(ds.val) : ds.val; app.saveSettings({ [ds.set]: v }); settings(); }
  else if (ds.submit) doSubmit(ds.submit);
  else if (ds.gdel) app.deleteNote(ds.gdel).then(notes);
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
    resume: () => { close(); if (resumeTo) app.setFocus(resumeTo.pid, { level: resumeTo.level }); },
    "switch-tree": () => app.switchTree(),
    refresh: () => { $("#toast").hidden = true; app.refreshReview(); },
    undo: () => { const put = app._undo; app._undo = null; $("#toast").hidden = true; put?.(); },
    tour: () => { close(); tour.start(); },
    "save-note": () => saveNote($("#note").value.trim()),
    "clear-note": () => saveNote(""),
    "toast-close": () => ($("#toast").hidden = true),
    "rabbit-flag": () => { $("#toast").hidden = true; app.mark(app.focus, "flagged"); app.nextUnreviewed(); },
    "drift-park": () => parkDrift(),
    layout: () => app.saveSettings({ diffLayout: ds.val }),
    untouched: () => app.saveSettings({ untouched: app.settings.untouched === "hide" ? "show" : "hide" }),
    tests: () => app.saveSettings({ tests: app.settings.tests === "show" ? "hide" : "show" }),
    generated: () => app.saveSettings({ generated: app.settings.generated === "show" ? "hide" : "show" }),
    files: () => toggleFiles(),
    keys: () => keysEditor(),
    "pr-comments": () => togglePR(app),
    "next-unresolved": () => nextUnresolved(app),
    "key-add": () => keyEdit("key-add", ds.id), "key-unbind": () => keyEdit("key-unbind", ds.id, ds.key), "key-reset": () => keyEdit("key-reset", ds.id),
    "key-reset-all": () => keyEdit("key-reset-all"),
    server: () => serverCard(ds.id),
    ...Object.fromEntries(["srv-install", "srv-check", "srv-later", "srv-never", "srv-copy"].map((a) => [a, () => serverAction(a, ds.id)])),
  })[ds.act]?.();
}

const GEAR = `<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 1 1-4 0v-.09a1.65 1.65 0 0 0-1-1.51 1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 1 1 0-4h.09a1.65 1.65 0 0 0 1.51-1 1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06a1.65 1.65 0 0 0 1.82.33h0a1.65 1.65 0 0 0 1-1.51V3a2 2 0 1 1 4 0v.09a1.65 1.65 0 0 0 1 1.51h0a1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82v0a1.65 1.65 0 0 0 1.51 1H21a2 2 0 1 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z"/></svg>`;
