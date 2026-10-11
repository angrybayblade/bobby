// Shared runtime: graph lookups, walk/focus/level, review marks, settings. Views only talk to this.
export const BANDS = ["upUnchanged", "upChanged", "core", "downChanged", "downUnchanged"];
export const BAND_TEXT = {
  upUnchanged: "Relies on · untouched",
  upChanged: "Relies on · changed",
  core: "Core change",
  downChanged: "Affects · changed",
  downUnchanged: "Affects · untouched",
};
export const LEVELS = ["Overview", "Core", "Page"];
export const LOW = "@low"; // pseudo-placement: low-signal hunks
export const DONE = "@done"; // pseudo-placement: end of walk

export const DEFAULT_SETTINGS = {
  view: "flow",
  theme: "system", // system | dark | light
  font: "sans", // sans | hyper | serif | mono
  size: 15,
  spacing: "normal", // normal | wide | wider
  motion: "system", // system | on | off
  hints: "fade", // fade | always | never
  timebox: 0, // minutes; 0 = off
  edges: "all", // all | focus: Diff draws background edges, or only the focused ones
  rabbit: 12, // minutes on one page before offering to flag it and move on; 0 = off
  drift: "on", // on | off: after 90s idle on a page, offer to park a thought
  prComments: "hide", // hide | show: other reviewers' comments, behind a per-page toggle when hidden
  diffLayout: "split", // split | inline: old beside new, or changed lines in one column
  palette: "github", // github | warm: colours (and, for github, fonts); theme picks dark or light
  hintUses: {},
};

export const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);
/** Escaped text with `backtick` spans as <code>, for model-written prose like hooks. */
export const inline = (s) => esc(s).replace(/`([^`]+)`/g, "<code>$1</code>");
export const api = (url, body, method = body ? "POST" : "GET") =>
  fetch(url, { method, headers: body ? { "content-type": "application/json" } : {}, body: body ? JSON.stringify(body) : undefined }).then((r) => r.json());

export function indexGraph(g) {
  const ix = { placement: new Map(), node: new Map(), hunk: new Map(), core: new Map(), edgesByCore: new Map(), walkPos: new Map() };
  for (const n of g.nodes) ix.node.set(n.id, n);
  for (const h of g.hunks) ix.hunk.set(h.id, h);
  g.cores.forEach((c, ci) => {
    ix.core.set(c.id, { core: c, ci });
    for (const b of BANDS) for (const pl of c.bands[b]) ix.placement.set(pl.id, { pl, core: c, ci });
  });
  for (const e of g.edges) (ix.edgesByCore.get(e.core) ?? ix.edgesByCore.set(e.core, []).get(e.core)).push(e);
  ix.walk = [...g.walk, ...(g.lowSignal.length ? [LOW] : []), DONE];
  ix.walk.forEach((id, i) => ix.walkPos.set(id, i));
  return ix;
}

export function createApp({ graph, session }) {
  const listeners = new Set();
  session.state.notes ??= [];
  const app = {
    graph,
    index: indexGraph(graph),
    state: session.state,
    settings: { ...DEFAULT_SETTINGS, ...session.settings },
    caps: session.caps,
    llm: session.llm,
    focus: null,
    level: 0,
    page: { exp: {}, open: new Set(), sel: null, composing: null }, // transient code-page state; open = unfolded blocks

    on(fn) { listeners.add(fn); return () => listeners.delete(fn); },
    emit(reason) { for (const fn of listeners) fn(reason); },

    // ---- lookups
    get(pid) { return app.index.placement.get(pid); },
    canonical(pid) { const p = app.get(pid)?.pl; return p?.repeatOf ?? pid; },
    nodeOf(pid) { const p = app.get(pid)?.pl; return p && app.index.node.get(p.node); },
    hunksOf(pid) {
      if (pid === LOW) return graph.lowSignal.map((id) => app.index.hunk.get(id));
      const n = app.nodeOf(pid);
      return n?.kind === "change" ? n.hunkIds.map((id) => app.index.hunk.get(id)).filter(Boolean) : [];
    },
    edgesOf(coreId) { return app.index.edgesByCore.get(coreId) ?? []; },
    neighbours(pid) {
      const c = app.get(pid)?.core;
      if (!c) return { up: [], down: [] };
      const es = app.edgesOf(c.id);
      return { up: es.filter((e) => e.to === pid), down: es.filter((e) => e.from === pid) };
    },
    stat(pid) {
      let a = 0, d = 0;
      for (const h of app.hunksOf(pid)) for (const l of h.lines) l.t === "+" ? a++ : l.t === "-" ? d++ : 0;
      return { a, d };
    },
    corePlacements(c) { return BANDS.flatMap((b) => c.bands[b]); },

    // ---- review marks (keyed by content, so they survive re-pushes and tree regeneration)
    markKeys(pid) {
      pid = app.canonical(pid);
      if (pid === LOW) return app.hunksOf(LOW).map((h) => h.hash);
      const n = app.nodeOf(pid);
      if (!n) return [];
      return n.kind === "context" ? [`ref:${n.location.path}:${n.location.line}`] : app.hunksOf(pid).map((h) => h.hash);
    },
    isReviewed(pid) { const k = app.markKeys(pid); return k.length > 0 && k.every((x) => app.state.marks[x] === "reviewed"); },
    isFlagged(pid) { return app.markKeys(pid).some((x) => app.state.marks[x] === "flagged"); },
    mark(pid, mark) {
      const keys = app.markKeys(pid);
      for (const k of keys) mark ? (app.state.marks[k] = mark) : delete app.state.marks[k];
      api("/api/mark", { keys, mark });
      app.emit("marks");
    },
    progress() {
      const pages = app.index.walk.filter((p) => p !== DONE);
      const left = pages.filter((p) => !app.isReviewed(p));
      const secs = left.reduce((s, p) => { const { a, d } = app.stat(p); return s + 12 + (a + d) * 1.1; }, 0);
      return { done: pages.length - left.length, total: pages.length, mins: Math.round(secs / 60) };
    },

    // ---- private notes: on a line, a file (no line) or the PR (no path). Never posted to GitHub.
    async addNote(n) {
      const note = await api("/api/notes", n);
      app.state.notes.push(note);
      app.emit("comments"); // shown where comments are, so views re-render the same way
      return note;
    },
    deleteNote(id) {
      api(`/api/notes/${id}`, null, "DELETE");
      app.state.notes = app.state.notes.filter((n) => n.id !== id);
      app.emit("comments");
    },
    /** The page that shows a file's line (or just the file), for jumping to a note. */
    pidAt(path, line) {
      let first = null;
      for (const pid of app.index.walk) {
        const n = app.nodeOf(pid);
        if (!n || (n.kind === "change" ? n.file : n.location.path) !== path) continue;
        first ??= pid;
        if (!line) break;
        const hit = n.kind === "context"
          ? line >= n.snippet.start && line < n.snippet.start + n.snippet.lines.length
          : app.hunksOf(pid).some((h) => (line >= h.newStart && line < h.newStart + h.lines.length) || (line >= h.oldStart && line < h.oldStart + h.lines.length));
        if (hit) return pid;
      }
      return first;
    },

    // ---- navigation (always along graph.walk, so every view agrees on "next")
    setFocus(pid, { level } = {}) {
      if (!pid) return;
      pid = app.canonical(pid);
      const changed = pid !== app.focus;
      app.focus = pid;
      const fileNote = app.page.composing?.file ? app.page.composing : null; // a note on the whole file outlives moving within it
      app.page = { exp: app.page.exp, open: app.page.open, kind: app.page.kind, sel: null, composing: fileNote };
      if (level !== undefined && level !== app.level) { app.level = level; app.emit("level"); }
      if (changed) {
        app.emit("focus");
        app.savePosition();
      }
    },
    setLevel(l) {
      l = Math.max(0, Math.min(2, l));
      if (l === app.level) return;
      app.level = l;
      app.page.composing = null;
      app.emit("level");
      app.savePosition();
    },
    /** Remembers the page and zoom level, debounced, so a return lands where you were. */
    savePosition() {
      clearTimeout(app._pos);
      app._pos = setTimeout(() => api("/api/position", { nodeId: app.nodeOf(app.focus)?.id ?? app.focus, level: app.level }), 500);
    },
    step(d) {
      const i = app.index.walkPos.get(app.focus) ?? 0;
      app.setFocus(app.index.walk[Math.max(0, Math.min(app.index.walk.length - 1, i + d))]);
    },
    stepCore(d) {
      const cur = app.get(app.focus)?.ci ?? (d > 0 ? graph.cores.length : -1);
      const target = cur + d;
      if (target < 0) return;
      if (target >= graph.cores.length) return app.setFocus(app.index.walk.find((p) => !app.get(p)) ?? DONE);
      const first = app.index.walk.find((p) => app.get(p)?.ci === target);
      app.setFocus(first);
    },
    /**
     * Where to start a PR you haven't opened before: the core with the fewest up- and downstream pages
     * (its dependencies), then the fewest changed lines. Cores linked to nothing are only used if every
     * core is like that, so you start somewhere small but central. Returns that core's first unreviewed page.
     */
    entryPoint() {
      const cores = graph.cores.map((c, ci) => {
        const pages = app.index.walk.filter((p) => app.get(p)?.ci === ci && !app.isReviewed(p));
        const deps = BANDS.filter((b) => b !== "core").reduce((n, b) => n + c.bands[b].length, 0);
        const size = app.corePlacements(c).reduce((n, pl) => { const { a, d } = app.stat(pl.id); return n + a + d; }, 0);
        return { c, pages, deps, size };
      }).filter((x) => x.pages.length);
      const linked = cores.filter((x) => x.deps > 0);
      const pool = linked.length ? linked : cores;
      pool.sort((x, y) => x.deps - y.deps || x.size - y.size);
      const best = pool[0];
      // Start at changed code: the core change itself, else the first changed page, never the context around it.
      const changed = (p) => app.nodeOf(p)?.kind === "change";
      const pid = best && (best.pages.find((p) => app.get(p).pl.band === "core") ?? best.pages.find(changed) ?? best.pages[0]);
      return best && { pid, deps: best.deps };
    },
    /** `F`: the deep pass. Next flagged page after the focus, wrapping around. Returns false if nothing is flagged. */
    nextFlagged() {
      const w = app.index.walk, i = app.index.walkPos.get(app.focus) ?? -1;
      for (let k = 1; k <= w.length; k++) {
        const p = w[(i + k) % w.length];
        if (app.get(p) && app.isFlagged(p)) { app.setFocus(p); return true; }
      }
      return false;
    },
    nextUnreviewed() {
      const w = app.index.walk, i = app.index.walkPos.get(app.focus) ?? -1;
      for (let k = 1; k <= w.length; k++) {
        const p = w[(i + k) % w.length];
        if (p !== DONE && !app.isReviewed(p)) return app.setFocus(p);
      }
      app.setFocus(DONE);
    },

    // ---- diff layout: global (a setting), or switched for one file until the global one changes
    fileLayout: new Map(),
    layoutOf(path) { return app.fileLayout.get(path) ?? app.settings.diffLayout; },
    toggleLayout(path) {
      if (!path) return app.saveSettings({ diffLayout: app.settings.diffLayout === "split" ? "inline" : "split" });
      const next = app.layoutOf(path) === "split" ? "inline" : "split";
      if (next === app.settings.diffLayout) app.fileLayout.delete(path); else app.fileLayout.set(path, next);
      app.emit("settings");
    },

    // ---- settings
    saveSettings(patch) {
      if ("diffLayout" in patch) app.fileLayout.clear(); // the global layout applies to every file again
      Object.assign(app.settings, patch);
      api("/api/settings", patch);
      app.emit("settings");
    },
    useKey(k) {
      const u = app.settings.hintUses;
      u[k] = (u[k] ?? 0) + 1;
      if (u[k] === 5) app.saveSettings({ hintUses: u });
    },

    replaceGraph(g) {
      const keepNode = app.nodeOf(app.focus)?.id;
      app.graph = graph = g;
      app.index = indexGraph(g);
      const pid = keepNode && [...app.index.placement.values()].find((x) => x.pl.node === keepNode && !x.pl.repeatOf)?.pl.id;
      app.focus = pid ?? app.index.walk[0];
      app.emit("graph");
    },
  };
  return app;
}
