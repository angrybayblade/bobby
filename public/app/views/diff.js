// Diff: one diff viewer per file on a canvas, columns by band (relies on ← core → affects).
// Scrolling a viewer moves your focus to the section you're reading; j/k scrolls the viewer for you.
// Only what you're reading gets edges: sections visible in the active viewer connect to related
// sections in other files, and those viewers scroll so the other end is in view.
import { BANDS, esc } from "../core.js";
import { injectCss } from "./flow.js";

const CSS = `
.dv { position: absolute; inset: 0; }
.dv .stage { position: absolute; inset: 0; overflow: hidden; cursor: grab; }
.dv.dragging .stage { cursor: grabbing; }
.dv .world { position: absolute; left: 0; top: 0; transform-origin: 0 0; transition: transform var(--dur) var(--ease); }
.dv.dragging .world, .dv .world.still { transition: none; }
.dv .bhead { position: absolute; font-size: 11px; letter-spacing: .08em; text-transform: uppercase; color: var(--faint); white-space: nowrap; }
.dv .fv { position: absolute; left: 0; top: 0; display: flex; flex-direction: column; background: var(--surface); border: 1px solid var(--line); border-radius: 12px; overflow: hidden; box-shadow: var(--shadow); z-index: 2; transition: transform var(--dur) var(--ease), opacity var(--dur); }
.dv.dragging .fv, .dv .fv.held { transition: none; }
.dv .fv.context { border-style: dashed; }
.dv .fv.active { border: 2px solid var(--signal); box-shadow: 0 0 0 6px var(--signal-soft), var(--shadow); z-index: 3; }
.dv .fvh { display: flex; gap: 10px; align-items: center; padding: 9px 12px; border-bottom: 1px solid var(--line-soft); font: 12.5px var(--font-code); color: var(--muted); cursor: grab; user-select: none; background: var(--raised); }
.dv .fvh b { color: var(--text); font-weight: 600; }
.dv .fvh .p { flex: 1; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.dv .fvh .st { white-space: nowrap; }
.dv .fvh .max { width: 26px; height: 22px; border-radius: 6px; color: var(--muted); font-size: 14px; line-height: 1; }
.dv .fvh .max:hover { background: var(--bg); color: var(--text); }
.dv .fvb { position: relative; overflow: auto; overscroll-behavior: contain; cursor: auto; flex: 1; min-height: 0; }
.dv .sec { padding: 10px 12px 2px; border-bottom: 1px solid var(--line-soft); }
.dv .sec:last-child { border-bottom: 0; }
.dv .sec.cur { box-shadow: inset 3px 0 0 var(--signal); }
.dv .sech { display: flex; gap: 8px; align-items: center; font: 600 12.5px var(--font-code); color: var(--muted); padding: 0 2px 8px; }
.dv .sec.cur .sech { color: var(--text); }
.dv .sec.done .sech span:first-of-type { color: var(--faint); }
.dv .sec .code { margin-bottom: 10px; }
.dv .sec .notes { margin-bottom: 10px; }
.dv .sec.rel { box-shadow: inset 3px 0 0 var(--muted); }
.dv svg.edges { position: absolute; left: 0; top: 0; overflow: visible; pointer-events: none; z-index: 1; } /* under the viewers: edges live in the gaps */
.dv svg.edges path { fill: none; stroke: var(--muted); stroke-width: 2; }
.dv svg.edges marker path { fill: var(--muted); stroke: none; }
.dv .elbl { position: absolute; z-index: 4; font: 11.5px var(--font-ui); color: var(--muted); background: var(--bg); border: 1px solid var(--line-soft); padding: 1px 7px; border-radius: 6px; white-space: nowrap; transform: translate(-50%, -50%); pointer-events: none; }
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
.dv .rc { text-align: left; border: 1px solid var(--line); border-radius: 10px; padding: 8px 11px; background: var(--surface); }
.dv .rc:hover { border-color: var(--muted); }
.dv .rc.context { border-style: dashed; }
.dv .rc .t { display: flex; gap: 7px; align-items: center; font: 500 12.5px var(--font-code); }
.dv .rc .t span { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.dv .rc .f { font: 11.5px var(--font-code); color: var(--faint); margin-top: 3px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.dv .rc .l { font: 11.5px var(--font-ui); color: var(--muted); margin-top: 3px; }
.dv .rail .none { color: var(--faint); font-size: 13px; }
.dv .empty { position: absolute; inset: 0; display: grid; place-items: center; color: var(--faint); }
`;

const W = 600, MAX_H = 460, GX = 120, GY = 34, TOP = 34;

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
      return { files: [...files.values()], fileOf, canon, rel };
    }
    const activeFile = () => M?.fileOf.get(M.canon(app.focus) ?? "");

    function stat(f) {
      let a = 0, d = 0;
      for (const s of f.sections) { const x = app.stat(s.pid); a += x.a; d += x.d; }
      return f.changed ? `<span style="color:var(--ok)">+${a}</span> <span style="color:var(--risk)">−${d}</span>` : "untouched";
    }
    function header(f, exit = false) {
      const dir = f.path.includes("/") ? f.path.slice(0, f.path.lastIndexOf("/") + 1) : "";
      return `<i class="glyph ${f.changed ? "change" : "context"}"></i><span class="p">${esc(dir)}<b>${esc(f.path.split("/").pop())}</b></span><span class="st">${stat(f)}</span>`
        + (exit ? `<button class="max" data-exit="1" title="Back to all files (esc)">⤡</button>`
          : `<button class="max" data-max="${esc(f.path)}" title="Focus on this file (or double-click the header)">⤢</button>`);
    }

    // ---- build: render every viewer, measure, then lay out in band columns.
    function build() {
      const keep = new Map([...views].map(([p, v]) => [p, v.body.scrollTop]));
      world.innerHTML = `<svg class="edges"><defs><marker id="dv-arrow" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse"><path d="M0,0 L10,5 L0,10 z"/></marker></defs><g></g></svg>`;
      views.clear();
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

    function layout() {
      for (const el of world.querySelectorAll(".bhead")) el.remove();
      const cols = BANDS.map((b) => M.files.filter((f) => f.band === b).sort((a, b2) => a.order - b2.order)).filter((c) => c.length);
      cols.forEach((col, ci) => {
        const x = ci * (W + GX);
        const h = document.createElement("div");
        h.className = "bhead";
        h.textContent = { upUnchanged: "relies on · untouched", upChanged: "relies on · changed", core: "core change", downChanged: "affects · changed", downUnchanged: "affects · untouched" }[col[0].band];
        h.style.transform = `translate(${x + 4}px, 0)`;
        world.appendChild(h);
        let y = TOP;
        for (const f of col) {
          const v = views.get(f.path);
          v.el.style.height = "";
          v.h = Math.min(MAX_H, v.el.offsetHeight);
          v.el.style.height = `${v.h}px`;
          const at = placedBy.get(f.path) ?? { x, y };
          v.x = at.x; v.y = at.y;
          v.el.style.transform = `translate(${v.x}px, ${v.y}px)`;
          y += v.h + GY;
        }
      });
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
    const secEl = (v, pid) => v.body.querySelector(`.sec[data-pid="${pid}"]`);
    function visible(v) {
      const top = v.body.scrollTop, bot = top + v.body.clientHeight;
      const seen = (s) => Math.min(bot, s.offsetTop + s.offsetHeight) - Math.max(top, s.offsetTop) >= 28; // a sliver at the edge doesn't count
      return [...v.body.querySelectorAll(".sec")].filter(seen).map((s) => s.dataset.pid);
    }
    // World y of a section's heading, pinned to the viewer's edge when scrolled out of view.
    function anchorY(v, pid) {
      const s = secEl(v, pid);
      const y = v.body.offsetTop + s.offsetTop - v.body.scrollTop + Math.min(16, s.offsetHeight / 2);
      return v.y + Math.max(v.body.offsetTop + 10, Math.min(v.h - 10, y));
    }
    function links() {
      const act = activeFile(), v = act && views.get(act.path);
      if (!v || app.level === 2) return [];
      return visible(v).flatMap((pid) => (M.rel.get(pid) ?? []).map((r) => ({ from: pid, ...r, to: views.get(M.fileOf.get(r.pid)?.path) })))
        .filter((l, i, all) => l.to // same-file relations loop out of the viewer's right edge
          && !(l.dir === "up" && all.some((m) => m.dir === "down" && m.from === l.pid && m.pid === l.from))); // both ends visible: draw once
    }
    function draw() {
      const svg = world.querySelector("svg.edges g");
      if (!svg) return;
      world.querySelectorAll(".elbl").forEach((n) => n.remove());
      const act = activeFile(), v = act && views.get(act.path);
      const ls = links();
      const relSet = new Set(ls.map((l) => l.pid));
      for (const s of world.querySelectorAll(".sec")) s.classList.toggle("rel", relSet.has(s.dataset.pid));
      svg.innerHTML = ls.map((l) => {
        const o = l.to, y1 = anchorY(v, l.from), y2 = anchorY(o, l.pid);
        let x1, x2, d;
        if (Math.abs(o.x - v.x) < W / 2) { // same column: loop out to the right
          x1 = v.x + W; x2 = o.x + W;
          const bx = Math.max(x1, x2) + 70;
          d = `M${x1},${y1} C${bx},${y1} ${bx},${y2} ${x2},${y2}`;
        } else {
          [x1, x2] = o.x > v.x ? [v.x + W, o.x] : [v.x, o.x + W];
          const mx = (x1 + x2) / 2;
          d = `M${x1},${y1} C${mx},${y1} ${mx},${y2} ${x2},${y2}`;
        }
        if (l.label) {
          const n = document.createElement("div");
          n.className = "elbl"; n.textContent = l.label;
          n.style.left = `${(x1 + x2) / 2 + (Math.abs(o.x - v.x) < W / 2 ? 52 : 0)}px`; n.style.top = `${(y1 + y2) / 2}px`;
          world.appendChild(n);
        }
        // Arrows point downstream: into the other file when it's affected, into yours when it's relied on.
        return `<path d="${d}" ${l.dir === "down" ? `marker-end="url(#dv-arrow)"` : `marker-start="url(#dv-arrow)"`}/>`;
      }).join("");
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
    function apply() { world.style.transform = `translate(${cam.tx + pan.x}px, ${cam.ty + pan.y}px) scale(${cam.s})`; }

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
      if (reason === "comments") { for (const v of views.values()) { const t = v.body.scrollTop; app.renderFile(v.body, v.f.sections.map((s) => s.pid)); v.body.scrollTop = t; } }
      restyle();
      if (reason === "focus" && !selfFocus) { reveal(true); frame(); setTimeout(follow, 350); } // after the smooth scroll settles
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
        if (v.f !== activeFile()) readFocus(v);
      }
    });
    let drag = null, moved = false, held = null;
    // The header is the handle: drag to move a viewer, double-click (or ⤢) to focus on it.
    stage.addEventListener("pointerdown", (ev) => {
      const h = ev.target.closest(".fvh");
      if (!h || ev.target.closest(".max")) return;
      const v = views.get(h.parentElement.dataset.file);
      held = { v, x: ev.clientX, y: ev.clientY, ox: v.x, oy: v.y, moved: false };
    });
    stage.addEventListener("click", (ev) => {
      const b = ev.target.closest("[data-max]");
      if (b) openFocus(b.dataset.max);
    });
    stage.addEventListener("dblclick", (ev) => {
      const h = ev.target.closest(".fvh");
      if (h && !ev.target.closest(".max")) openFocus(h.parentElement.dataset.file);
    });
    stage.addEventListener("pointerdown", (ev) => {
      if (ev.target.closest(".fv")) return;
      drag = { x: ev.clientX, y: ev.clientY, p: { ...pan } }; moved = false;
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
      if (held) { held.v.el.classList.remove("held"); held = null; }
      drag = null; root.classList.remove("dragging");
    };
    window.addEventListener("pointermove", onMove);
    window.addEventListener("pointerup", onUp);
    stage.addEventListener("wheel", (ev) => {
      if (ev.target.closest(".fvb")) return; // the code scrolls itself
      ev.preventDefault();
      pan = { x: pan.x - ev.deltaX, y: pan.y - ev.deltaY };
      world.classList.add("still"); apply();
      clearTimeout(stage._w); stage._w = setTimeout(() => world.classList.remove("still"), 120);
    }, { passive: false });

    update("mount");
    return { update, destroy() { window.removeEventListener("pointermove", onMove); window.removeEventListener("pointerup", onUp); } };
  },
};
