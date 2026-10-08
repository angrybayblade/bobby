// Diff: one diff viewer per file on a canvas, columns by band (relies on ← core → affects).
// Scrolling a viewer moves your focus to the section you're reading; j/k scrolls the viewer for you.
import { BANDS, esc } from "../core.js";
import { injectCss } from "./flow.js";

const CSS = `
.dv { position: absolute; inset: 0; }
.dv .stage { position: absolute; inset: 0; overflow: hidden; cursor: grab; }
.dv.dragging .stage { cursor: grabbing; }
.dv .world { position: absolute; left: 0; top: 0; transform-origin: 0 0; transition: transform var(--dur) var(--ease); }
.dv.dragging .world, .dv .world.still { transition: none; }
.dv .bhead { position: absolute; font-size: 11px; letter-spacing: .08em; text-transform: uppercase; color: var(--faint); white-space: nowrap; }
.dv .fv { position: absolute; left: 0; top: 0; display: flex; flex-direction: column; background: var(--surface); border: 1px solid var(--line); border-radius: 12px; overflow: hidden; box-shadow: var(--shadow); transition: transform var(--dur) var(--ease), opacity var(--dur); }
.dv.dragging .fv, .dv .fv.held { transition: none; }
.dv .fv.context { border-style: dashed; }
.dv .fv.active { border: 2px solid var(--signal); box-shadow: 0 0 0 6px var(--signal-soft), var(--shadow); z-index: 2; }
.dv .fvh { display: flex; gap: 10px; align-items: center; padding: 9px 12px; border-bottom: 1px solid var(--line-soft); font: 12.5px var(--font-code); color: var(--muted); cursor: grab; user-select: none; background: var(--raised); }
.dv .fvh b { color: var(--text); font-weight: 600; }
.dv .fvh .p { flex: 1; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.dv .fvh .st { white-space: nowrap; }
.dv .fvh .max { width: 26px; height: 22px; border-radius: 6px; color: var(--muted); font-size: 14px; line-height: 1; }
.dv .fvh .max:hover { background: var(--bg); color: var(--text); }
.dv .fvb { overflow: auto; overscroll-behavior: contain; cursor: auto; flex: 1; min-height: 0; }
.dv .sec { padding: 10px 12px 2px; border-bottom: 1px solid var(--line-soft); }
.dv .sec:last-child { border-bottom: 0; }
.dv .sec.cur { box-shadow: inset 3px 0 0 var(--signal); }
.dv .sech { display: flex; gap: 8px; align-items: center; font: 600 12.5px var(--font-code); color: var(--muted); padding: 0 2px 8px; }
.dv .sec.cur .sech { color: var(--text); }
.dv .sec.done .sech span:first-of-type { color: var(--faint); }
.dv .sec .code { margin-bottom: 10px; }
.dv .sec .notes { margin-bottom: 10px; }
.dv .empty { position: absolute; inset: 0; display: grid; place-items: center; color: var(--faint); }
`;

const W = 600, MAX_H = 460, GX = 120, GY = 34, TOP = 34;

export default {
  id: "diff",
  name: "Diff",
  hint: "A diff viewer per file; edges follow what you're reading",
  mount(el, app) {
    injectCss("diff", CSS);
    el.innerHTML = `<div class="dv"><div class="stage"><div class="world"></div></div></div>`;
    const root = el.firstElementChild, stage = root.querySelector(".stage"), world = root.querySelector(".world");
    let M = null; // model: files, relations, lookups
    const views = new Map(); // path → { el, body, f, x, y, h }
    const placedBy = new Map(); // path → {x, y} set by dragging
    let cam = { tx: 0, ty: 0, s: 1 }, pan = { x: 0, y: 0 };
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
        const line = node.kind === "change" ? Math.min(...app.hunksOf(pid).map((h) => h.newStart)) : node.location.line;
        f.sections.push({ pid, line });
        fileOf.set(pid, f);
      }
      for (const f of files.values()) f.sections.sort((a, b) => a.line - b.line);
      const canon = (pid) => first.get(app.get(pid)?.pl.node);
      return { files: [...files.values()], fileOf, canon };
    }
    const activeFile = () => M?.fileOf.get(M.canon(app.focus) ?? "");

    function stat(f) {
      let a = 0, d = 0;
      for (const s of f.sections) { const x = app.stat(s.pid); a += x.a; d += x.d; }
      return f.changed ? `<span style="color:var(--ok)">+${a}</span> <span style="color:var(--risk)">−${d}</span>` : "untouched";
    }
    function header(f) {
      const dir = f.path.includes("/") ? f.path.slice(0, f.path.lastIndexOf("/") + 1) : "";
      return `<i class="glyph ${f.changed ? "change" : "context"}"></i><span class="p">${esc(dir)}<b>${esc(f.path.split("/").pop())}</b></span><span class="st">${stat(f)}</span>`
        + `<button class="max" data-max="${esc(f.path)}" title="Focus on this file (or double-click the header)">⤢</button>`;
    }

    // ---- build: render every viewer, measure, then lay out in band columns.
    function build() {
      const keep = new Map([...views].map(([p, v]) => [p, v.body.scrollTop]));
      world.innerHTML = "";
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
      for (const s of world.querySelectorAll(".sec")) {
        s.classList.toggle("cur", s.dataset.pid === cur);
        s.classList.toggle("done", app.isReviewed(s.dataset.pid));
      }
      const v = act && views.get(act.path);
      if (v) app.pageEl = v.body; // c / e act on the file you're in
    }
    // j/k: bring the focused section to the top of its viewer
    function reveal(smooth) {
      const act = activeFile(), cur = M.canon(app.focus);
      const v = act && views.get(act.path);
      const sec = v?.body.querySelector(`.sec[data-pid="${cur}"]`);
      if (sec) v.body.scrollTo({ top: sec.offsetTop - 6, behavior: smooth ? "smooth" : "auto" });
    }
    // Scrolling a viewer: the section under its top third becomes the focus.
    function readFocus(v) {
      const line = v.body.getBoundingClientRect().top + v.body.clientHeight / 3;
      let pick = null;
      for (const s of v.body.querySelectorAll(".sec")) { if (s.getBoundingClientRect().top <= line) pick = s; else break; }
      pick ??= v.body.querySelector(".sec");
      if (pick && pick.dataset.pid !== M.canon(app.focus)) { selfFocus = true; app.setFocus(pick.dataset.pid); selfFocus = false; }
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
      if (reason === "mount" || reason === "graph" || reason === "settings") { build(); restyle(); reveal(false); return void requestAnimationFrame(frame); }
      if (reason === "comments") { for (const v of views.values()) { const t = v.body.scrollTop; app.renderFile(v.body, v.f.sections.map((s) => s.pid)); v.body.scrollTop = t; } }
      restyle();
      if (reason === "focus" && !selfFocus) { reveal(true); frame(); }
      if (reason === "level") frame();
      if (reason === "resize") frame();
    }

    // ---- interaction: scroll inside a viewer reads focus; drag or wheel on the background pans.
    stage.addEventListener("scroll", (ev) => {
      const v = views.get(ev.target.closest?.(".fv")?.dataset.file);
      if (v && v.f === activeFile()) { clearTimeout(v._t); v._t = setTimeout(() => readFocus(v), 90); }
    }, true);
    stage.addEventListener("pointerdown", (ev) => {
      const fv = ev.target.closest(".fv");
      if (fv && !ev.target.closest(".fvh")) { // clicking into another file makes it the one you're reading
        const v = views.get(fv.dataset.file);
        if (v.f !== activeFile()) readFocus(v);
      }
    });
    let drag = null, moved = false;
    stage.addEventListener("pointerdown", (ev) => {
      if (ev.target.closest(".fv")) return;
      drag = { x: ev.clientX, y: ev.clientY, p: { ...pan } }; moved = false;
    });
    const onMove = (ev) => {
      if (!drag) return;
      const dx = ev.clientX - drag.x, dy = ev.clientY - drag.y;
      if (!moved && Math.hypot(dx, dy) < 4) return;
      moved = true; root.classList.add("dragging");
      pan = { x: drag.p.x + dx, y: drag.p.y + dy };
      apply();
    };
    const onUp = () => { drag = null; root.classList.remove("dragging"); };
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
