// Diff: one diff viewer per file on a canvas, laid out as a graph: each file right of the files it relies on.
// Scrolling a viewer moves your focus to the section you're reading; j/k scrolls the viewer for you.
// What you're reading gets full edges: sections visible in the active viewer connect to related
// sections in other files, and those viewers scroll so the other end is in view. Every other
// relationship is a faint background line; ones whose ends are scrolled away merge into one.
import { BANDS, esc } from "../core.js";
import { injectCss } from "./flow.js";
import { layered } from "./layered.js";

const CSS = `
.dv { position: absolute; inset: 0; }
.dv .stage { position: absolute; inset: 0; overflow: hidden; cursor: grab; touch-action: pan-x pan-y; } /* two-finger gestures are ours */
.dv.dragging .stage { cursor: grabbing; }
.dv.dragging { user-select: none; }
.dv .world { position: absolute; left: 0; top: 0; transform-origin: 0 0; transition: transform var(--dur) var(--ease); }
.dv.dragging .world, .dv .world.still { transition: none; }
.dv .bhead { position: absolute; font-size: 11px; letter-spacing: .08em; text-transform: uppercase; color: var(--faint); white-space: nowrap; }
.dv .fv { position: absolute; left: 0; top: 0; display: flex; flex-direction: column; background: var(--surface); border: 1px solid var(--line); border-radius: 4px; overflow: hidden; box-shadow: var(--shadow); z-index: 2; transition: transform var(--dur) var(--ease), opacity var(--dur); }
.dv.dragging .fv, .dv .fv.held { transition: none; }
.dv .fv.context { border-style: dashed; }
/* Weight: what you're in and what it reaches (w-focus) > other changed files (w-semi) > untouched files (w-none).
   Until you're in a viewer, only untouched files sit back. */
.dv .fv.w-none { opacity: .5; box-shadow: none; }
.dv.engaged .fv.w-semi { opacity: .6; box-shadow: none; }
.dv.engaged .fv.w-none { opacity: .3; }
.dv .fv.w-none:hover, .dv.engaged .fv.w-semi:hover { opacity: .9; }
.dv .fv.w-focus { box-shadow: var(--shadow), 0 2px 12px rgba(0,0,0,.2); z-index: 3; }
.dv .fv.active { border-style: solid; z-index: 3; } /* no border of its own: weight (opacity, shadow) says where you are */
.dv .fvh { display: flex; gap: 10px; align-items: center; padding: 9px 12px; border-bottom: 1px solid var(--line-soft); font: 12.5px var(--font-code); color: var(--muted); cursor: grab; user-select: none; background: var(--raised); }
.dv .fvh b { font-weight: 600; }
.dv .fvh .p { flex: 1; color: var(--text); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.dv .fvh .st { white-space: nowrap; }
.dv .fvh .band { font: 500 10.5px var(--font-ui); letter-spacing: .06em; text-transform: uppercase; color: var(--faint); white-space: nowrap; padding: 1px 7px; border: 1px solid var(--line-soft); border-radius: 1px; }
.dv .fvh .band.core { color: var(--text); border-color: var(--muted); }
.dv .fvh .max { width: 26px; height: 22px; border-radius: 1px; color: var(--muted); font-size: 14px; line-height: 1; }
.dv .fvh .max:hover { background: var(--bg); color: var(--text); }
.dv .fvh .lay { font-size: 13px; }
/* Header tooltips: quick, below the button, right-aligned so they stay inside the viewer. */
.dv .fvh [data-tip] { position: relative; }
.dv .fvh [data-tip]::after { content: attr(data-tip); position: absolute; top: calc(100% + 8px); right: 0; z-index: 6; padding: 4px 9px; border-radius: 1px; background: var(--text); color: var(--bg); font: 500 12px var(--font-ui); white-space: nowrap; pointer-events: none; opacity: 0; transform: translateY(-2px); transition: opacity .12s, transform .12s; }
.dv .fvh [data-tip]:hover::after { opacity: 1; transform: none; transition-delay: .25s; }
.dv .viewed .fvh .vwf::after { content: attr(data-tip-on); }
.dv .viewed .fvh .vwf { color: var(--ok); }
.dv .fvb { position: relative; overflow: auto; overscroll-behavior: contain; cursor: auto; flex: 1; min-height: 0; }
.dv .sec { padding: 10px 12px 2px; border-bottom: 1px solid var(--line-soft); }
.dv .sec:last-child { border-bottom: 0; }
.dv .sec.cur { box-shadow: inset 3px 0 0 var(--muted); }
.dv .sech { display: flex; gap: 8px; align-items: center; font: 600 12.5px var(--font-code); color: var(--muted); padding: 0 2px 8px; }
.dv .sec.cur .sech { color: var(--text); }
.dv .sec.done .sech span:first-of-type { color: var(--faint); }
.dv .sec .code { margin-bottom: 10px; }
.dv .world .lines { font-size: calc(var(--code-size) - 2px); } /* a size down from the page: more fits, and zoom brings it back */
.dv .world .ln .no { font-size: calc(var(--code-size) - 3px); }
.dv .sec .notes { margin-bottom: 10px; }
.dv .sec.rel { box-shadow: inset 3px 0 0 var(--line); }
.dv svg.edges { position: absolute; left: 0; top: 0; overflow: visible; pointer-events: none; z-index: 1; } /* under the viewers: edges live in the gaps */
.dv svg.edges path { fill: none; stroke: var(--muted); stroke-width: 2; }
.dv svg.edges marker path { fill: var(--muted); stroke: none; }
.dv svg.edges .bg path { stroke-width: 1.5; opacity: .16; transition: opacity var(--dur); }
.dv svg.edges .bg path.merged { opacity: .24; }
.dv svg.edges .bg path:has(+ .hit:hover) { opacity: .6; }
.dv svg.edges .bg path.in, .dv svg.edges .bg path.out { opacity: 0; }
.dv svg.edges .bg path.hit { stroke: transparent; stroke-width: 12px !important; opacity: 1; pointer-events: stroke; } /* hover target: names what a line connects */
.dv svg.edges .bg path.hit.out { pointer-events: none; }
.dv .elbl { position: absolute; z-index: 4; font: 11.5px var(--font-ui); color: var(--muted); background: var(--bg); border: 1px solid var(--line-soft); padding: 1px 7px; border-radius: 1px; white-space: nowrap; transform: translate(-50%, -50%); pointer-events: none; }
.dv .fvh:active { cursor: grabbing; }
.dv .fv.held { box-shadow: 0 12px 40px rgba(0,0,0,.25); }
.dv .dfocus { position: absolute; inset: 0; display: grid; grid-template-columns: minmax(180px, 260px) minmax(0, 1fr) minmax(180px, 260px); gap: 22px; padding: 18px 22px; background: var(--bg); z-index: 5; }
.dv .dfocus[hidden] { display: none; }
.dv .dfocus .big { position: relative; transform: none; width: auto; height: auto; min-height: 0; }
.dv .dfocus .big .fvh { cursor: default; }
.dv .dfocus .page-only { overflow: auto; }
.dv .rail { display: flex; flex-direction: column; gap: 8px; overflow: auto; padding-top: 4px; }
.dv .rail h4 { margin: 0 0 4px; font: 600 10.5px var(--font-ui); letter-spacing: .09em; text-transform: uppercase; color: var(--faint); }
.dv .rail.up { align-items: stretch; text-align: right; }
.dv .rc { text-align: left; border: 1px solid var(--line); border-radius: 3px; padding: 8px 11px; background: var(--surface); }
.dv .rc:hover { border-color: var(--muted); }
.dv .rc.context { border-style: dashed; }
.dv .rc .t { display: flex; gap: 7px; align-items: center; font: 500 12.5px var(--font-code); }
.dv .rc .t span { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.dv .rc .f { font: 11.5px var(--font-code); color: var(--faint); margin-top: 3px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.dv .rc .l { font: 11.5px var(--font-ui); color: var(--muted); margin-top: 3px; }
.dv .rail .none { color: var(--faint); font-size: 13px; }
.dv .empty { position: absolute; inset: 0; display: grid; place-items: center; color: var(--faint); }
.dv .fv.pinned > .fvh, .dv .fv.pinned > .fvb { zoom: var(--fill, 1); } /* filled: the viewer is zoomed up, its contents back down */
/* Compact, GitHub-like code: one box per file, slim hunk rows, a tight gutter. */
.dv .fvh { gap: 8px; padding: 5px 6px 5px 10px; font-size: 12px; }
.dv .fvh .band { font-size: 9.5px; padding: 0 5px; }
.dv .fvh .max { width: 22px; height: 20px; font-size: 12.5px; }
.dv .sec { padding: 0; }
.dv .sec .notes { margin: 6px 10px; }
.dv .sech { position: sticky; top: 0; z-index: 2; gap: 7px; padding: 4px 8px 4px 10px; font: 600 12px var(--font-ui); background: var(--surface); border-bottom: 1px solid var(--line-soft); }
.dv .sech .vw { font-size: 11px; padding: 0 7px; line-height: 18px; }
.dv .sec .code { margin: 0; border: 0; border-radius: 0; background: none; }
.dv .sec .code + .code { border-top: 1px solid var(--line-soft); }
.dv .code .fh { padding: 2px 10px 2px 72px; font-size: 11.5px; line-height: 18px; border-bottom: 0; color: var(--faint); background: var(--hunk); }
.dv .code .fh b { color: var(--muted); font-weight: 500; }
.dv .code .more { padding: 0 10px 0 72px; font-size: 11px; line-height: 18px; background: var(--hunk); opacity: .85; }
.dv .lines { line-height: 1.55; }
.dv .ln { grid-template-columns: 3px 34px 34px 14px 1fr; }
.dv .srow > .ln { grid-template-columns: 3px 34px 14px minmax(0, 1fr); }
.dv .ln .no { padding-right: 8px; }
.dv .dfocus .lines { font-size: calc(var(--code-size) - 2px); }
.dv .dfocus .ln .no { font-size: calc(var(--code-size) - 3px); }
`;

const BAND_LABEL = { upUnchanged: "relies on · untouched", upChanged: "relies on · changed", core: "core", downChanged: "affects · changed", downUnchanged: "affects · untouched" };
let W = 840; // a viewer's width: wider in split layout, so each side keeps room
const MAX_H = 460, GX = 200, GY = 64, TOP = 34;

export default {
  id: "diff",
  name: "Diff",
  hint: "A diff viewer per file; edges follow what you're reading",
  mount(el, app) {
    injectCss("diff", CSS);
    el.innerHTML = `<div class="dv"><div class="stage"><div class="world"></div></div>
      <div class="dfocus" hidden><nav class="rail up"></nav><div class="fv big"></div><nav class="rail down"></nav></div></div>`;
    const root = el.firstElementChild, stage = root.querySelector(".stage"), world = root.querySelector(".world");
    const dfocus = root.querySelector(".dfocus"), big = dfocus.querySelector(".big");
    const railUp = dfocus.querySelector(".rail.up"), railDown = dfocus.querySelector(".rail.down");
    let bigPath = null; // file shown in focus mode
    let M = null; // model: files, relations, lookups
    const views = new Map(); // path → { el, body, f, x, y, h }
    const placedBy = new Map(); // path → {x, y} set by dragging
    let cam = { tx: 0, ty: 0, s: 1 }, pan = { x: 0, y: 0 };
    let quietUntil = 0; // our own scrolling (j/k, opening a file) must not be read back as the reader moving
    let selfFocus = false; // focus change came from scrolling a viewer: don't move the camera or the scroll
    // You're in the active viewer once you click into its code or step with j/k; until then the wheel pans the
    // canvas everywhere. Clicking the background or zooming out to the overview lets go.
    let engaged = false;
    const engage = (on) => { if (engaged !== on) { engaged = on; root.classList.toggle("engaged", on); redraw(); } };

    // ---- model: one file per path, sections = canonical placements of the nodes in that file.
    function model() {
      const first = new Map(); // node id → first placement in walk order
      for (const pid of app.index.walk) { const n = app.nodeOf(pid); if (n && !first.has(n.id)) first.set(n.id, pid); }
      const files = new Map(), fileOf = new Map();
      for (const pid of first.values()) {
        const node = app.nodeOf(pid), pl = app.get(pid).pl;
        const path = node.kind === "change" ? node.file : node.location.path;
        let f = files.get(path);
        if (!f) files.set(path, (f = { path, band: pl.band, order: app.index.walkPos.get(pid), sections: [], changed: false }));
        f.changed ||= node.kind === "change";
        if (Math.abs(BANDS.indexOf(pl.band) - 2) < Math.abs(BANDS.indexOf(f.band) - 2)) f.band = pl.band; // column of its most central code
        const line = node.kind === "change" ? Math.min(...app.hunksOf(pid).map((h) => h.newStart)) : node.location.line;
        f.sections.push({ pid, line });
        fileOf.set(pid, f);
      }
      for (const f of files.values()) f.sections.sort((a, b) => a.line - b.line);
      const canon = (pid) => first.get(app.get(pid)?.pl.node);
      // Relations between sections, across cores, deduped. dir is from the section's point of view.
      const rel = new Map();
      const add = (a, b, dir, label) => {
        const list = rel.get(a) ?? rel.set(a, []).get(a);
        if (!list.some((r) => r.pid === b && r.dir === dir)) list.push({ pid: b, dir, label });
      };
      for (const e of app.graph.edges) {
        const a = canon(e.from), b = canon(e.to);
        if (!a || !b || a === b) continue;
        add(a, b, "down", e.label);
        add(b, a, "up", e.label);
      }
      const pairs = []; // every relation once, for background edges
      for (const [a, list] of rel) for (const r of list) if (r.dir === "down") pairs.push({ a, b: r.pid, label: r.label });
      return { files: [...files.values()], fileOf, canon, rel, pairs };
    }
    const activeFile = () => M?.fileOf.get(M.canon(app.focus) ?? "");

    function stat(f) {
      let a = 0, d = 0;
      for (const s of f.sections) { const x = app.stat(s.pid); a += x.a; d += x.d; }
      return f.changed ? `<span style="color:var(--ok)">+${a}</span> <span style="color:var(--risk)">−${d}</span>` : "untouched";
    }
    function header(f, exit = false) {
      const dir = f.path.includes("/") ? f.path.slice(0, f.path.lastIndexOf("/") + 1) : "";
      return `<i class="glyph ${f.changed ? "change" : "context"}"></i><span class="p">${esc(dir)}<b>${esc(f.path.split("/").pop())}</b></span><span class="band ${f.band}">${BAND_LABEL[f.band]}</span><span class="st">${stat(f)}</span>`
        + `<button class="max vwf" data-fviewed="${esc(f.path)}" aria-label="Mark file viewed" data-tip="Mark whole file viewed · local only" data-tip-on="Unmark file viewed">✓</button>`
        + `<button class="max lay" data-flayout="${esc(f.path)}" aria-label="Inline or split" data-tip="${app.layoutOf(f.path) === "split" ? "Show this file inline" : "Show this file split"} · d for every file">${app.layoutOf(f.path) === "split" ? "▤" : "◫"}</button>`
        + `<button class="max" data-fnote="${esc(f.path)}" aria-label="Note on this file" data-tip="Private note on this file · only you see it">✎</button>`
        + (exit ? `<button class="max" data-exit="1" aria-label="Back to all files" data-tip="Back to all files · esc">⤡</button>`
          : `<button class="max" data-max="${esc(f.path)}" aria-label="Expand this file" data-tip="Expand to full screen · or double-click the header">⤢</button>`);
    }

    // ---- build: render every viewer, measure, then lay out as a graph.
    function build() {
      const keep = new Map([...views].map(([p, v]) => [p, v.body.scrollTop]));
      world.innerHTML = `<svg class="edges"><defs><marker id="dv-arrow" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse"><path d="M0,0 L10,5 L0,10 z"/></marker></defs><g class="bg"></g><g class="fg"></g></svg>`;
      views.clear(); drawn.clear(); secs.clear(); relShown = new Set();
      W = app.settings.diffLayout === "split" ? 1280 : 840;
      M = model();
      if (!M.files.length) { world.innerHTML = `<div class="empty">Nothing to show</div>`; return; }
      for (const f of M.files) {
        const v = document.createElement("div");
        v.className = `fv ${f.changed ? "" : "context"}`;
        v.dataset.file = f.path;
        v.style.width = `${W}px`;
        v.innerHTML = `<div class="fvh" data-handle="${esc(f.path)}">${header(f)}</div><div class="fvb"></div>`;
        world.appendChild(v);
        const body = v.querySelector(".fvb");
        app.renderFile(body, f.sections.map((s) => s.pid));
        views.set(f.path, { el: v, body, f });
      }
      layout();
      for (const [p, top] of keep) if (views.has(p)) views.get(p).body.scrollTop = top;
    }

    // Files are laid out as a graph: each one a column right of the files that lead into it, so a chain
    // a → b → c reads left to right even inside one band. The band is a label on the file, not a column.
    let columns = [], fileLinks = { prev: new Map(), next: new Map() };
    function layout() {
      for (const el of world.querySelectorAll(".bhead")) el.remove();
      const prev = new Map(M.files.map((f) => [f, new Set()])), next = new Map(M.files.map((f) => [f, new Set()]));
      for (const { a, b } of M.pairs) {
        const fa = M.fileOf.get(a), fb = M.fileOf.get(b);
        if (fa !== fb) { next.get(fa).add(fb); prev.get(fb).add(fa); }
      }
      fileLinks = { prev, next };
      const files = [...M.files].sort((a, b) => BANDS.indexOf(a.band) - BANDS.indexOf(b.band) || a.order - b.order);
      for (const f of files) {
        const v = views.get(f.path);
        v.el.style.height = "";
        v.h = Math.min(MAX_H, v.el.offsetHeight);
        v.el.style.height = `${v.h}px`;
      }
      const edges = [...next].flatMap(([a, bs]) => [...bs].map((b) => [a.path, b.path]));
      const L = layered(files.map((f) => f.path), edges, { h: (p) => views.get(p).h, gap: GY, compGap: GY * 2 + TOP });
      columns = [];
      for (const f of files) {
        const v = views.get(f.path), r = L.rank.get(f.path);
        (columns[r] ??= []).push(f);
        const at = placedBy.get(f.path) ?? { x: r * (W + GX), y: L.y.get(f.path) + TOP };
        v.x = at.x; v.y = at.y;
        v.el.style.transform = `translate(${v.x}px, ${v.y}px)`;
      }
      // Each group of linked files is headed by the cores it holds.
      for (const comp of L.comps) {
        const paths = new Set(comp.ids);
        const fileOfPl = (pl) => { const n = app.nodeOf(pl.id); return n.kind === "change" ? n.file : n.location.path; };
        const cores = app.graph.cores.map((c, ci) => ({ c, ci })).filter(({ c }) => c.bands.core.some((pl) => paths.has(fileOfPl(pl))));
        const text = !comp.linked ? "not linked to other files"
          : cores.slice(0, 3).map(({ c, ci }) => `core ${ci + 1} · ${c.title}`).join("   ·   ") + (cores.length > 3 ? `   +${cores.length - 3}` : "");
        if (!text) continue;
        const h = document.createElement("div");
        h.className = "bhead";
        h.textContent = text;
        h.style.transform = `translate(4px, ${comp.top}px)`;
        world.appendChild(h);
      }
    }

    // ---- focus: highlight the current section and the viewer it's in
    function restyle() {
      const act = activeFile();
      for (const v of views.values()) v.el.classList.toggle("active", v.f === act);
      const cur = M?.canon(app.focus);
      for (const s of root.querySelectorAll(".sec")) {
        s.classList.toggle("cur", s.dataset.pid === cur);
        s.classList.toggle("done", app.isReviewed(s.dataset.pid));
      }
      const all = (f) => f.sections.every((s) => app.isReviewed(s.pid));
      for (const v of views.values()) v.el.classList.toggle("viewed", all(v.f));
      big.classList.toggle("viewed", !!bigPath && all(views.get(bigPath).f));
      const body = readingBody();
      if (body) app.pageEl = body; // c / e act on the file you're in
    }
    function readingBody() {
      if (app.level === 2) return big.querySelector(".fvb");
      const act = activeFile();
      return act && views.get(act.path)?.body;
    }
    // j/k: bring the focused section to the top of its viewer
    function reveal(smooth) {
      const body = readingBody(), cur = M.canon(app.focus);
      const sec = body?.querySelector(`.sec[data-pid="${cur}"]`);
      if (!sec) return;
      quietUntil = Date.now() + (smooth ? 700 : 200);
      body.scrollTo({ top: sec.offsetTop - 6, behavior: smooth ? "smooth" : "auto" });
    }
    // Scrolling a viewer: the section under its top third becomes the focus.
    function readFocus(v) {
      if (Date.now() < quietUntil) return;
      const line = v.body.getBoundingClientRect().top + v.body.clientHeight / 3;
      let pick = null;
      for (const s of v.body.querySelectorAll(".sec")) { if (s.getBoundingClientRect().top <= line) pick = s; else break; }
      pick ??= v.body.querySelector(".sec");
      if (pick && pick.dataset.pid !== M.canon(app.focus)) { selfFocus = true; app.setFocus(pick.dataset.pid); selfFocus = false; }
    }

    // ---- edges: only from the sections visible in the active viewer
    // A redraw reads every position before it changes the page (so the browser lays out once per frame),
    // then updates the curves it already has instead of rebuilding them.
    const SVG = "http://www.w3.org/2000/svg";
    const secs = new Map(); // pid → section element, re-found when a viewer re-renders
    function secEl(v, pid) {
      let s = secs.get(pid);
      if (!s?.isConnected || !v.body.contains(s)) secs.set(pid, (s = v.body.querySelector(`.sec[data-pid="${pid}"]`)));
      return s;
    }
    const port = (v) => ({ top: v.body.scrollTop, h: v.body.clientHeight, off: v.body.offsetTop }); // a viewer's scroll window
    function visible(v, p = port(v)) {
      const bot = p.top + p.h;
      const seen = (s) => Math.min(bot, s.offsetTop + s.offsetHeight) - Math.max(p.top, s.offsetTop) >= 28; // a sliver at the edge doesn't count
      return [...v.body.querySelectorAll(".sec")].filter(seen).map((s) => s.dataset.pid);
    }
    // World y of a section's heading, pinned to the viewer's top (pin -1) or bottom (pin 1) when scrolled out of view.
    function anchor(v, pid, p = port(v)) {
      const s = secEl(v, pid);
      const y = p.off + s.offsetTop - p.top + Math.min(16, s.offsetHeight / 2), lo = p.off + 10, hi = v.h - 10;
      return { y: v.y + Math.max(lo, Math.min(hi, y)), pin: y < lo ? -1 : y > hi ? 1 : 0 };
    }
    function links(p = port) {
      const act = activeFile(), v = act && views.get(act.path);
      if (!v || app.level === 2) return [];
      return visible(v, p(v)).flatMap((pid) => (M.rel.get(pid) ?? []).map((r) => ({ from: pid, ...r, to: views.get(M.fileOf.get(r.pid)?.path) })))
        .filter((l, i, all) => l.to // same-file relations loop out of the viewer's right edge
          && !(l.dir === "up" && all.some((m) => m.dir === "down" && m.from === l.pid && m.pid === l.from))); // both ends visible: draw once
    }
    // A curve between two viewers at world heights y1, y2; label at (lx, ly).
    function curve(v, y1, o, y2) {
      if (Math.abs(o.x - v.x) < W / 2) { // same column: loop out to the right
        const x1 = v.x + W, x2 = o.x + W, bx = Math.max(x1, x2) + 70;
        return { d: `M${x1},${y1} C${bx},${y1} ${bx},${y2} ${x2},${y2}`, lx: (x1 + x2) / 2 + 52, ly: (y1 + y2) / 2 };
      }
      const [x1, x2] = o.x > v.x ? [v.x + W, o.x] : [v.x, o.x + W], mx = (x1 + x2) / 2;
      return { d: `M${x1},${y1} C${mx},${y1} ${mx},${y2} ${x2},${y2}`, lx: mx, ly: (y1 + y2) / 2 };
    }
    // Background: every relation not already drawn as focused, faint, with no arrow or label. Both ends in
    // view: its own line. An end scrolled away would pin to the viewer's border, so edges that share both
    // ends become one line, thicker with the count. Past BG_CAP relations: one line per pair of files.
    const BG_CAP = 300;
    function background(p, focused) {
      const out = [], groups = new Map(), byFile = M.pairs.length > BG_CAP;
      const viewOf = (pid) => views.get(M.fileOf.get(pid).path);
      const name = (v) => v.f.path.split("/").pop();
      const group = (key, A, B, title) => (groups.get(key) ?? groups.set(key, { key, A, B, title, n: 0 }).get(key)).n++;
      const title = (pid) => app.get(pid).pl.title;
      for (const { a, b, label } of M.pairs) {
        if (focused.has(`${a}|${b}`)) continue;
        const va = viewOf(a), vb = viewOf(b);
        if (byFile) {
          if (va === vb) continue;
          const [x, y] = va.f.path < vb.f.path ? [va, vb] : [vb, va];
          group(`h:${x.f.path}|${y.f.path}`, { v: x, y: x.y + 18 }, { v: y, y: y.y + 18 }, () => `between ${name(x)} and ${name(y)}`);
          continue;
        }
        const ea = anchor(va, a, p(va)), eb = anchor(vb, b, p(vb));
        if (!ea.pin && !eb.pin) { // hover names both ends and how they relate
          out.push({ key: `b:${a}>${b}`, bg: true, cls: "", title: `${title(a)} → ${title(b)}${label ? ` · ${label.replace(/`/g, "")}` : ""}`, ...curve(va, ea.y, vb, eb.y) });
          continue;
        }
        let A = { v: va, y: ea.y, pin: ea.pin, k: ea.pin ? `${va.f.path}${ea.pin}` : a }, B = { v: vb, y: eb.y, pin: eb.pin, k: eb.pin ? `${vb.f.path}${eb.pin}` : b };
        if (A.k === B.k) continue; // both ends pinned to the same border
        if (A.k > B.k) [A, B] = [B, A];
        const where = [A, B].filter((e) => e.pin).map((e) => `${e.pin < 0 ? "↑" : "↓"} in ${name(e.v)}`).join(", ");
        group(`m:${A.k}|${B.k}`, A, B, () => `scrolled ${where}`);
      }
      for (const g of groups.values()) out.push({
        key: g.key, bg: true, cls: "merged", width: 1.5 + Math.log(g.n),
        title: `${g.n} relationship${g.n === 1 ? "" : "s"} ${g.title()}`, ...curve(g.A.v, g.A.y, g.B.v, g.B.y),
      });
      return out;
    }
    const drawn = new Map(); // key → { path, lbl, d, … } currently on the page
    let relShown = new Set();
    function draw() {
      const fg = world.querySelector("svg.edges g.fg"), bgl = world.querySelector("svg.edges g.bg");
      if (!fg) return;
      // read
      const ports = new Map(), p = (v) => ports.get(v) ?? ports.set(v, port(v)).get(v);
      const act = activeFile(), v = act && views.get(act.path);
      const ls = links(p);
      const shapes = ls.map((l) => ({
        key: `f:${l.from}>${l.pid}:${l.dir}`, label: l.label,
        // Arrows point downstream: into the other file when it's affected, into yours when it's relied on.
        marker: l.dir === "down" ? "marker-end" : "marker-start",
        ...curve(v, anchor(v, l.from, p(v)).y, l.to, anchor(l.to, l.pid, p(l.to)).y),
      }));
      if (app.level !== 2 && app.settings.edges !== "focus") shapes.unshift(...background(p, new Set(ls.flatMap((l) => [`${l.from}|${l.pid}`, `${l.pid}|${l.from}`]))));
      // write
      const rel = new Set(ls.map((l) => l.pid));
      for (const pid of new Set([...relShown, ...rel])) for (const s of world.querySelectorAll(`.sec[data-pid="${pid}"]`)) s.classList.toggle("rel", rel.has(pid));
      relShown = rel;
      const near = new Set(engaged && v ? [v, ...ls.map((l) => l.to)] : []);
      // At the core level, changed files outside the current core sit back with the untouched ones.
      const core = app.level === 1 ? app.get(app.focus)?.core : null;
      const coreNodes = core && new Set(app.corePlacements(core).map((pl) => pl.node));
      const inCore = (o) => !coreNodes || o.f.sections.some((s) => coreNodes.has(app.get(s.pid).pl.node));
      for (const o of views.values()) {
        const w = near.has(o) ? "focus" : o.f.changed && inCore(o) ? "semi" : "none";
        if (o.w !== w) { o.el.classList.remove(`w-${o.w}`); o.el.classList.add(`w-${(o.w = w)}`); }
      }
      const keep = new Set(), entering = [];
      for (const s of shapes) {
        keep.add(s.key);
        let e = drawn.get(s.key);
        if (!e) {
          e = { bg: s.bg, path: (s.bg ? bgl : fg).appendChild(document.createElementNS(SVG, "path")) };
          if (s.marker) e.path.setAttribute(s.marker, "url(#dv-arrow)");
          if (s.bg) { e.path.setAttribute("class", `${s.cls} in`); entering.push(e.path); } // fades in rather than popping
          if (s.title) {
            e.hit = bgl.appendChild(document.createElementNS(SVG, "path"));
            e.hit.setAttribute("class", "hit");
            e.tip = e.hit.appendChild(document.createElementNS(SVG, "title"));
          }
          drawn.set(s.key, e);
        } else if (e.out) { // came back while fading out
          clearTimeout(e.out); e.out = 0;
          e.path.classList.remove("out"); e.hit?.classList.remove("out");
        }
        if (e.d !== s.d) { e.path.setAttribute("d", (e.d = s.d)); e.hit?.setAttribute("d", s.d); }
        if (s.width && e.w !== s.width) e.path.style.strokeWidth = `${(e.w = s.width)}px`;
        if (s.title && e.title !== s.title) e.tip.textContent = e.title = s.title;
        if (s.label) {
          e.lbl ??= world.appendChild(Object.assign(document.createElement("div"), { className: "elbl", textContent: s.label }));
          if (e.lx !== s.lx || e.ly !== s.ly) { e.lbl.style.left = `${(e.lx = s.lx)}px`; e.lbl.style.top = `${(e.ly = s.ly)}px`; }
        }
      }
      const gone = (k, e) => { e.path.remove(); e.hit?.remove(); e.lbl?.remove(); if (drawn.get(k) === e) drawn.delete(k); };
      for (const [k, e] of drawn) {
        if (keep.has(k) || e.out) continue;
        if (!e.bg) { gone(k, e); continue; }
        e.path.classList.add("out"); e.hit?.classList.add("out");
        e.out = setTimeout(() => gone(k, e), 260);
      }
      if (entering.length) requestAnimationFrame(() => entering.forEach((el) => el.classList.remove("in")));
    }
    // Bring the other end of every edge into view in its own viewer.
    let followKey = "";
    function follow() {
      const ls = links();
      const key = ls.map((l) => l.pid).join(",");
      if (key === followKey) return;
      followKey = key;
      const done = new Set();
      for (const l of ls) {
        if (done.has(l.to) || l.to.f === activeFile()) continue; // never scroll the file you're reading
        done.add(l.to);
        if (visible(l.to).includes(l.pid)) continue;
        l.to.body.scrollTo({ top: secEl(l.to, l.pid).offsetTop - 6, behavior: "smooth" });
      }
    }
    let raf = 0;
    const redraw = () => { cancelAnimationFrame(raf); raf = requestAnimationFrame(draw); };

    // ---- focus mode (level 2): one file fills the stage; what its visible sections relate to sits in rails.
    function showFocus(reason) {
      const act = activeFile();
      if (!act) { // end of walk or low-signal: the shared page
        bigPath = null;
        railUp.innerHTML = railDown.innerHTML = "";
        big.className = "fv big page-only";
        app.renderPage(big, app.focus);
        return;
      }
      if (act.path !== bigPath || reason === "comments" || reason === "graph" || reason === "settings") {
        const fresh = act.path !== bigPath;
        const top = big.querySelector(".fvb")?.scrollTop ?? 0;
        bigPath = act.path;
        big.className = `fv big ${act.changed ? "" : "context"}`;
        big.innerHTML = `<div class="fvh">${header(act, true)}</div><div class="fvb"></div>`;
        app.renderFile(big.querySelector(".fvb"), act.sections.map((s) => s.pid));
        restyle();
        if (fresh) reveal(false); else big.querySelector(".fvb").scrollTop = top;
      }
      rails();
    }
    function rails() {
      const body = big.querySelector(".fvb");
      if (!body || !bigPath) return;
      const ls = visible({ body }).flatMap((pid) => (M.rel.get(pid) ?? []).map((r) => ({ from: pid, ...r })));
      const card = (l) => {
        const pl = app.get(l.pid).pl, node = app.nodeOf(l.pid), f = M.fileOf.get(l.pid);
        const same = f.path === bigPath;
        return `<button class="rc ${node.kind}" data-rel="${l.pid}"><div class="t"><i class="glyph ${pl.band === "core" ? "core" : node.kind}"></i><span>${esc(pl.title)}</span>${app.isReviewed(l.pid) ? `<span class="status">✓</span>` : ""}</div>
          <div class="f">${same ? "in this file" : esc(f.path)}</div>${l.label ? `<div class="l">${esc(l.label)}</div>` : ""}</button>`;
      };
      const side = (dir) => { const seen = new Set(); return ls.filter((l) => l.dir === dir && !seen.has(l.pid) && seen.add(l.pid)); };
      const up = side("up"), down = side("down");
      railUp.innerHTML = `<h4>relies on</h4>${up.map(card).join("") || `<div class="none">nothing in view relies on other code</div>`}`;
      railDown.innerHTML = `<h4>affects</h4>${down.map(card).join("") || `<div class="none">nothing in view affects other code</div>`}`;
    }
    dfocus.addEventListener("click", (ev) => {
      const n = ev.target.closest("[data-fnote]");
      if (n) return app.noteOnFile(big.querySelector(".fvb"), n.dataset.fnote);
      const vf = ev.target.closest("[data-fviewed]");
      if (vf) return viewFile(vf.dataset.fviewed);
      const t = ev.target.closest("[data-rel],[data-exit]");
      if (!t) return;
      if (t.dataset.exit) return app.setLevel(1);
      app.setFocus(t.dataset.rel); // same file: scrolls there; another file: swaps it in
    });
    dfocus.addEventListener("scroll", (ev) => {
      if (!ev.target.matches?.(".big .fvb")) return;
      clearTimeout(big._t);
      big._t = setTimeout(() => { readFocus({ body: ev.target }); rails(); }, 90);
    }, true);
    // ✓ in a header: mark every section of the file viewed, or clear them all if they already are.
    function viewFile(path) {
      const pids = views.get(path).f.sections.map((s) => s.pid);
      const on = !pids.every((pid) => app.isReviewed(pid));
      for (const pid of pids) app.mark(pid, on ? "reviewed" : null);
    }
    function openFocus(path) {
      const v = views.get(path);
      if (!v) return;
      const pid = visible(v)[0] ?? v.f.sections[0].pid;
      if (M.canon(app.focus) !== pid && M.fileOf.get(M.canon(app.focus)) !== v.f) app.setFocus(pid);
      app.setLevel(2);
    }

    // ---- camera
    function bounds(list) {
      const xs = list.flatMap((v) => [v.x, v.x + W]), ys = list.flatMap((v) => [v.y, v.y + v.h]);
      return { x: Math.min(...xs), y: Math.min(...ys) - TOP, w: Math.max(...xs) - Math.min(...xs), h: Math.max(...ys) - Math.min(...ys) + TOP };
    }
    function frame() {
      const all = [...views.values()];
      if (!all.length) return;
      const sw = stage.clientWidth, sh = stage.clientHeight, PAD = 40;
      const act = activeFile(), v = act && views.get(act.path);
      let box, s;
      if (app.level === 0 || !v) { box = bounds(all); s = Math.max(0.2, Math.min(1, (sw - PAD * 2) / box.w, (sh - PAD * 2) / box.h)); }
      else { box = bounds([v]); s = Math.max(0.75, Math.min(1, (sh - PAD * 2) / box.h)); }
      cam = { s, tx: sw / 2 - (box.x + box.w / 2) * s, ty: box.h * s > sh - PAD * 2 ? PAD - box.y * s : sh / 2 - (box.y + box.h / 2) * s };
      pan = { x: 0, y: 0 };
      apply();
    }
    // The focus moved (arrows, j/k, a click): keep the zoom and pan to the viewer. At the Core level it's
    // centred; at the Overview the camera only moves if the viewer isn't already on screen.
    function track() {
      const act = activeFile(), v = act && views.get(act.path);
      if (!v) return frame();
      const sw = stage.clientWidth, sh = stage.clientHeight, PAD = 40, s = cam.s;
      const left = (v.x * s) + cam.tx + pan.x, top = (v.y - TOP) * s + cam.ty + pan.y, w = W * s, h = (v.h + TOP) * s;
      if (app.level === 0 && left >= 0 && top >= 0 && left + w <= sw && top + h <= sh) return;
      if (filled && filled.s === s) { filled.path = act.path; cam = { s, tx: -v.x * s, ty: -v.y * s }; pan = { x: 0, y: 0 }; pin(v); return apply(); } // still filled: same alignment
      cam = { s, tx: sw / 2 - (v.x + W / 2) * s, ty: h > sh - PAD * 2 ? PAD - (v.y - TOP) * s : sh / 2 - (v.y - TOP + (v.h + TOP) / 2) * s };
      pan = { x: 0, y: 0 };
      apply();
    }
    // Shift+F: the focused file fills the canvas, flush with its top-left. The viewer keeps its width, takes the canvas's
    // proportions, and is zoomed to fill it; its contents shrink by as much, so code reads at FILL_ZOOM× its canvas size
    // and more of each line fits. Again to go back.
    const FILL_ZOOM = 1.1;
    let filled = null;
    function fill() {
      const act = activeFile(), v = act && views.get(act.path);
      if (!v) return;
      if (filled?.path === act.path && filled.s === cam.s && !pan.x && !pan.y) { // back out: the earlier zoom, on the file you're on now
        const back = filled.prev; filled = null; pin(null);
        if (back.path === act.path) { cam = back; return apply(); }
        cam = { ...cam, s: back.s }; return track();
      }
      const s = stage.clientWidth / W; // may pass the wheel's 2× limit on a wide screen
      const prev = { s: cam.s, tx: cam.tx + pan.x, ty: cam.ty + pan.y, path: act.path };
      cam = { s, tx: -v.x * s, ty: -v.y * s };
      pan = { x: 0, y: 0 };
      filled = { path: act.path, s, prev };
      engage(true); pin(v); apply();
    }
    // While filled, the viewer has the canvas's proportions, its contents are scaled to a reading size, and every scroll is its code's.
    function pin(v) {
      for (const o of views.values()) if (o !== v && o.el.classList.contains("pinned")) { o.el.classList.remove("pinned"); o.el.style.removeProperty("--fill"); o.el.style.height = `${o.h}px`; }
      if (!v) return;
      v.el.style.height = `${stage.clientHeight / cam.s}px`;
      v.el.style.setProperty("--fill", Math.min(1, FILL_ZOOM / cam.s));
      v.el.classList.add("pinned");
    }
    function apply() {
      if (filled && (cam.s !== filled.s || pan.x || pan.y)) { filled = null; pin(null); } // zoomed or panned away: no longer filled
      world.style.transform = `translate(${cam.tx + pan.x}px, ${cam.ty + pan.y}px) scale(${cam.s})`;
    }
    // Zoom by k around a point on the stage, keeping whatever is under it in place.
    function zoomAt(k, px, py) {
      const s = Math.max(0.15, Math.min(Math.max(2, cam.s), cam.s * k)); // never jumps down from a filled view past 2×
      const wx = (px - cam.tx - pan.x) / cam.s, wy = (py - cam.ty - pan.y) / cam.s;
      cam = { s, tx: px - wx * s - pan.x, ty: py - wy * s - pan.y };
      apply();
    }
    const still = () => { world.classList.add("still"); clearTimeout(stage._w); stage._w = setTimeout(() => world.classList.remove("still"), 120); };

    function update(reason) {
      dfocus.hidden = app.level !== 2;
      if (reason === "mount" || reason === "graph" || reason === "settings") {
        build(); bigPath = null;
        if (app.level === 2) showFocus(reason);
        restyle(); reveal(false); followKey = ""; follow(); redraw();
        return void requestAnimationFrame(frame);
      }
      if (app.level === 2) {
        showFocus(reason);
        restyle();
        if (reason === "focus" && !selfFocus) reveal(true);
        return;
      }
      if (reason === "level") { bigPath = null; reveal(false); followKey = ""; setTimeout(follow, 50); }
      if (reason === "level" && app.level === 0) engage(false);
      if (reason === "focus" && !selfFocus) engage(true); // j/k or a click elsewhere: you're reading that file
      if (reason === "comments") { for (const v of views.values()) { const t = v.body.scrollTop; app.renderFile(v.body, v.f.sections.map((s) => s.pid)); v.body.scrollTop = t; } }
      restyle();
      if (reason === "focus" && !selfFocus) { reveal(true); track(); setTimeout(follow, 350); } // after the smooth scroll settles
      if (reason === "level" || reason === "resize") frame();
      redraw();
    }

    // ---- interaction: scroll inside a viewer reads focus; drag or wheel on the background pans.
    stage.addEventListener("scroll", (ev) => {
      const v = views.get(ev.target.closest?.(".fv")?.dataset.file);
      redraw();
      if (v && v.f === activeFile()) { clearTimeout(v._t); v._t = setTimeout(() => { readFocus(v); follow(); }, 90); }
    }, true);
    stage.addEventListener("pointerdown", (ev) => {
      const fv = ev.target.closest(".fv");
      if (fv && !ev.target.closest(".fvh")) { // clicking into another file makes it the one you're reading
        const v = views.get(fv.dataset.file);
        if (v.f !== activeFile()) { quietUntil = 0; readFocus(v); } // a click is never our own scroll settling
        engage(true);
      }
    });
    let drag = null, moved = false, held = null;
    // The header is the handle: drag to move a viewer, click it to read that file, double-click it (or ⤢) to expand it.
    stage.addEventListener("pointerdown", (ev) => {
      const h = ev.target.closest(".fvh");
      if (!h || ev.target.closest("button")) return;
      if (ev.pointerType === "mouse") ev.preventDefault(); // dragging a viewer must not select text
      const v = views.get(h.parentElement.dataset.file);
      held = { v, x: ev.clientX, y: ev.clientY, ox: v.x, oy: v.y, moved: false };
    });
    stage.addEventListener("click", (ev) => {
      const b = ev.target.closest("[data-max]");
      if (b) openFocus(b.dataset.max);
      const n = ev.target.closest("[data-fnote]");
      if (n) { const v = views.get(n.dataset.fnote); engage(true); app.noteOnFile(v.body, v.f.path); }
      const vf = ev.target.closest("[data-fviewed]");
      if (vf) viewFile(vf.dataset.fviewed);
    });
    stage.addEventListener("pointerdown", (ev) => {
      if (ev.target.closest(".fv")) return; // inside a viewer: code stays selectable
      if (ev.pointerType === "mouse") ev.preventDefault(); // a press-and-drag pans; it must not start a text selection
      drag = { x: ev.clientX, y: ev.clientY, p: { ...pan } }; moved = false;
    });
    stage.addEventListener("dblclick", (ev) => {
      const h = ev.target.closest(".fvh");
      if (h && !ev.target.closest("button")) openFocus(h.parentElement.dataset.file);
    });
    const onMove = (ev) => {
      if (held) {
        const dx = (ev.clientX - held.x) / cam.s, dy = (ev.clientY - held.y) / cam.s;
        if (!held.moved && Math.hypot(dx, dy) < 4) return;
        held.moved = true;
        const v = held.v;
        v.el.classList.add("held");
        v.x = held.ox + dx; v.y = held.oy + dy;
        v.el.style.transform = `translate(${v.x}px, ${v.y}px)`;
        placedBy.set(v.f.path, { x: v.x, y: v.y });
        redraw();
        return;
      }
      if (!drag) return;
      const dx = ev.clientX - drag.x, dy = ev.clientY - drag.y;
      if (!moved && Math.hypot(dx, dy) < 4) return;
      moved = true; root.classList.add("dragging");
      pan = { x: drag.p.x + dx, y: drag.p.y + dy };
      apply();
    };
    const onUp = () => {
      if (held) {
        const h = held; held = null;
        h.v.el.classList.remove("held");
        if (!h.moved) { // a click on the header, not a drag: that's the file you're reading now
          if (h.v.f !== activeFile()) { quietUntil = 0; readFocus(h.v); }
          engage(true);
        }
      }
      if (drag && !moved) engage(false); // a click on the background, not a pan
      drag = null; root.classList.remove("dragging");
    };
    window.addEventListener("pointermove", onMove);
    window.addEventListener("pointerup", onUp);
    // Trackpad: pinch arrives as ctrl+wheel (Chrome, Firefox) and zooms anywhere; two-finger scroll pans the
    // canvas, except over the code of the viewer you're in, which scrolls.
    stage.addEventListener("wheel", (ev) => {
      const r = stage.getBoundingClientRect();
      if (ev.ctrlKey) {
        ev.preventDefault(); still();
        return zoomAt(Math.exp(-ev.deltaY * 0.01), ev.clientX - r.left, ev.clientY - r.top);
      }
      if (filled) { ev.preventDefault(); views.get(filled.path)?.body.scrollBy(ev.deltaX / cam.s, ev.deltaY / cam.s); return; } // filled: the page is this file
      if (engaged && ev.target.closest(".fvb") && ev.target.closest(".fv").dataset.file === activeFile()?.path) return; // the code scrolls itself
      ev.preventDefault(); still();
      pan = { x: pan.x - ev.deltaX, y: pan.y - ev.deltaY };
      apply();
    }, { passive: false });
    // Safari's trackpad pinch
    let gScale = 1;
    stage.addEventListener("gesturestart", (ev) => { ev.preventDefault(); gScale = 1; });
    stage.addEventListener("gesturechange", (ev) => {
      ev.preventDefault(); still();
      const r = stage.getBoundingClientRect();
      zoomAt(ev.scale / gScale, ev.clientX - r.left, ev.clientY - r.top);
      gScale = ev.scale;
    });
    // Touchscreen: two fingers pan (midpoint moves) and zoom (spread changes), even over code.
    let touch = null;
    const two = (ev) => {
      const r = stage.getBoundingClientRect(), [a, b] = ev.touches;
      return { x: (a.clientX + b.clientX) / 2 - r.left, y: (a.clientY + b.clientY) / 2 - r.top, d: Math.hypot(a.clientX - b.clientX, a.clientY - b.clientY) };
    };
    stage.addEventListener("touchstart", (ev) => { if (ev.touches.length === 2) { ev.preventDefault(); touch = two(ev); drag = null; } }, { passive: false });
    stage.addEventListener("touchmove", (ev) => {
      if (!touch || ev.touches.length !== 2) return;
      ev.preventDefault(); still();
      const t = two(ev);
      pan = { x: pan.x + t.x - touch.x, y: pan.y + t.y - touch.y };
      zoomAt(t.d / touch.d, t.x, t.y);
      touch = t;
    }, { passive: false });
    stage.addEventListener("touchend", (ev) => { if (ev.touches.length < 2) touch = null; });

    update("mount");
    // Arrows follow the graph: → to a file this one leads into, ← to one that leads into it (the nearest,
    // or failing that the nearest in the next column); ↑ ↓ to the file above or below in the same column.
    function moveFile(dc, dr) {
      const act = activeFile();
      const ci = columns.findIndex((col) => col?.includes(act));
      if (ci < 0) return;
      const at = views.get(act.path), dist = (f) => { const v = views.get(f.path); return Math.abs(v.x - at.x) * 4 + Math.abs(v.y - at.y); };
      const nearest = (list) => [...list].sort((a, b) => dist(a) - dist(b))[0];
      let to;
      if (dr) {
        const col = [...columns[ci]].sort((a, b) => views.get(a.path).y - views.get(b.path).y); // as laid out, after any dragging
        to = col[col.indexOf(act) + dr];
      } else {
        to = nearest(fileLinks[dc > 0 ? "next" : "prev"].get(act) ?? []) ?? (columns[ci + dc] && nearest(columns[ci + dc]));
      }
      if (to) app.setFocus(to.sections[0].pid);
    }
    const keys = {
      ArrowLeft: () => moveFile(-1, 0), ArrowRight: () => moveFile(1, 0),
      ArrowUp: () => moveFile(0, -1), ArrowDown: () => moveFile(0, 1),
      F: () => { if (app.level < 2) return fill(); app.setLevel(1); setTimeout(fill, 60); }, // from the page, back to the canvas, filled
    };

    return { update, keys, destroy() { window.removeEventListener("pointermove", onMove); window.removeEventListener("pointerup", onUp); } };
  },
};
