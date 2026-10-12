// Lens: ego-centric. The current node sits dead centre, what it relies on fans in from the left,
// what it affects fans out to the right, and everything else is hidden. Walking re-centres the lens.
import { BANDS, BAND_TEXT, DONE, LOW, esc } from "../core.js";
import { injectCss } from "./flow.js";

const CSS = `
.lens { position: absolute; inset: 0; display: grid; grid-template-rows: 1fr; }
.lens.paged { grid-template-rows: auto 1fr; }
.lens .ring { position: relative; display: grid; grid-template-columns: 1fr minmax(320px, 420px) 1fr; gap: 0 90px; align-items: center; padding: 30px 40px 20px; min-height: 0; }
.lens .ring.wide { grid-template-columns: minmax(200px, 1fr) minmax(480px, 760px) minmax(200px, 1fr); gap: 0 60px; align-items: start; }
.lens .ring.wide .side { margin-top: 40px; }
.lens .focus .nbody { margin-top: 12px; max-height: calc(100vh - 330px); overflow: auto; overscroll-behavior: contain; cursor: auto; }
.lens .focus .nbody .code { margin-bottom: 10px; }
.lens .focus .nbody .notes { margin-bottom: 10px; }
.lens.paged .ring { padding: 14px 40px 12px; gap: 0 60px; border-bottom: 1px solid var(--line); }
.lens .side { display: flex; flex-direction: column; gap: 10px; min-width: 0; }
.lens .side.left { align-items: flex-end; }
.lens .side h4, .lens .center h4 { margin: 0 0 10px; font: 600 10.5px var(--font-ui); letter-spacing: .09em; text-transform: uppercase; color: var(--faint); }
.lens .nb { width: min(100%, 320px); text-align: left; border: 1px solid var(--line); border-radius: 3px; padding: 9px 12px; background: var(--surface); position: relative; z-index: 1; }
.lens .nb.context { border-style: dashed; }
.lens .nb:hover { border-color: var(--muted); }
.lens .nb .t { display: flex; gap: 8px; align-items: center; font: 500 13px var(--font-code); white-space: nowrap; }
.lens .nb .t span { overflow: hidden; text-overflow: ellipsis; flex: 1; }
.lens .nb .w { font: 12.5px/1.45 var(--font-prose); color: var(--muted); margin-top: 4px; display: -webkit-box; -webkit-line-clamp: 2; -webkit-box-orient: vertical; overflow: hidden; }
.lens.paged .nb .w { display: none; }
.lens .nb.done { opacity: .55; }
.lens .center { position: relative; z-index: 1; }
.lens .focus { border: 2px solid var(--signal); border-radius: 4px; padding: 18px 22px; background: var(--surface); box-shadow: 0 0 0 8px var(--signal-soft), var(--shadow); cursor: pointer; }
.lens .focus.context { border-style: dashed; }
.lens .focus .t { display: flex; gap: 10px; align-items: center; font: 650 calc(var(--size) * 1.1) var(--font-code); }
.lens .focus .w { font: calc(var(--size) * 1.02)/1.55 var(--font-prose); margin-top: 8px; }
.lens.paged .focus { padding: 10px 16px; box-shadow: 0 0 0 5px var(--signal-soft); }
.lens.paged .focus .w { display: none; }
.lens .focus .m { font: 12px var(--font-code); color: var(--faint); margin-top: 10px; }
.lens .none { color: var(--faint); font-size: 13px; padding: 8px 4px; }
.lens svg { position: absolute; inset: 0; width: 100%; height: 100%; pointer-events: none; overflow: visible; }
.lens svg path { fill: none; stroke: var(--muted); stroke-width: 1.5; opacity: .7; }
.lens .elbl { position: absolute; font: 11.5px var(--font-ui); color: var(--muted); background: var(--bg); padding: 1px 6px; border-radius: 1px; white-space: nowrap; transform: translate(-50%, -50%); z-index: 2; }
.lens .orbit { grid-column: 1 / 4; display: flex; gap: 6px; align-items: center; justify-content: center; margin-top: 28px; flex-wrap: wrap; font-size: 12.5px; color: var(--faint); }
.lens.paged .orbit { margin-top: 12px; }
.lens .orbit i { width: 9px; height: 9px; border-radius: 50%; border: 1.5px solid var(--muted); cursor: pointer; }
.lens .orbit i.change, .lens .orbit i.core { background: var(--muted); }
.lens .orbit i.done { opacity: .35; }
.lens .orbit i.cur { border-color: var(--signal); background: var(--signal); box-shadow: 0 0 0 4px var(--signal-soft); }
.lens .orbit .sep { width: 1px; height: 12px; background: var(--line); margin: 0 6px; }
.lens .orbit .lab { margin: 0 10px; }
.lens .pane { overflow: auto; }
.lens .slide-l { animation: slideL var(--dur) var(--ease); }
.lens .slide-r { animation: slideR var(--dur) var(--ease); }
@keyframes slideL { from { transform: translateX(60px); opacity: .2; } }
@keyframes slideR { from { transform: translateX(-60px); opacity: .2; } }
.lens .grid { position: absolute; inset: 0; overflow: auto; padding: 30px 40px 60px; }
/* f: the focus fills the stage with its code; the sides and the orbit step away */
.lens.filled .ring { grid-template-columns: 1fr; padding: 0; gap: 0; align-items: stretch; height: 100%; }
.lens.filled .side, .lens.filled .orbit, .lens.filled svg, .lens.filled .elbl, .lens.filled .center h4 { display: none; }
.lens.filled .center { height: 100%; min-height: 0; }
.lens.filled .focus { height: 100%; display: flex; flex-direction: column; border-radius: 0; border-width: 0; box-shadow: none; padding: 12px 16px; cursor: default; }
.lens.filled .focus .nbody { max-height: none; flex: 1; min-height: 0; }
.lens .grid .intent { max-width: 70ch; font: 600 calc(var(--size) * 1.4)/1.35 var(--font-prose); margin: 0 auto 26px; }
.lens .grid .intent small { display: block; font: 12px var(--font-ui); letter-spacing: .08em; text-transform: uppercase; color: var(--faint); margin-bottom: 6px; }
.lens .planets { display: grid; grid-template-columns: repeat(auto-fill, minmax(260px, 1fr)); gap: 14px; max-width: 1100px; margin: 0 auto; }
.lens .planet { min-width: 0; overflow: hidden; display: flex; flex-direction: column; justify-content: flex-start; text-align: left; border: 1px solid var(--line); border-radius: 4px; padding: 16px 18px; background: var(--surface); }
.lens .planet.cur { border-color: var(--signal); box-shadow: 0 0 0 5px var(--signal-soft); }
.lens .planet h3 { margin: 0 0 6px; font-size: calc(var(--size) * 1.02); display: flex; gap: 6px; min-width: 0; }
.lens .planet h3 .n { flex: none; color: var(--faint); }
.lens .planet h3 .tt { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.lens .planet p { margin: 0 0 12px; color: var(--muted); font: 14px/1.5 var(--font-prose); display: -webkit-box; -webkit-line-clamp: 2; -webkit-box-orient: vertical; overflow: hidden; overflow-wrap: anywhere; }
.lens .planet .dots { display: flex; gap: 3px; flex-wrap: wrap; }
.lens .planet .dots i { width: 7px; height: 7px; border-radius: 50%; background: var(--line); }
.lens .planet .dots i.d { background: var(--muted); }
`;

export default {
  id: "lens",
  name: "Lens",
  hint: "Focus-centred: neighbours only",
  mount(el, app) {
    injectCss("lens", CSS);
    el.innerHTML = `<div class="lens"></div>`;
    const root = el.firstElementChild;
    let prevFocus = null, prevSides = { left: [], right: [] }, filled = false;

    const nbCard = (e, id) => {
      const loc = app.get(id); const pl = loc.pl, node = app.nodeOf(id);
      return `<button class="nb ${node.kind} ${app.isReviewed(id) ? "done" : ""}" data-go="${id}" data-edge="${esc(e.label ?? "")}">
        <div class="t"><i class="glyph ${pl.band === "core" ? "core" : node.kind}"></i><span>${esc(pl.title)}</span>${pl.risk === "high" ? `<i class="riskdot"></i>` : ""}${app.isReviewed(id) ? `<span class="status">✓</span>` : ""}${pl.repeatOf ? `<span class="status">↺</span>` : ""}</div>
        <div class="w">${esc(pl.why)}</div></button>`;
    };

    function planets() {
      const fc = app.get(app.focus)?.core;
      return `<div class="grid"><div class="intent"><small>What this PR does</small>${esc(app.graph.intent)}</div><div class="planets">${app.graph.cores.map((c, ci) => {
        if (!app.coreShown(c)) return "";
        const items = app.index.walk.filter((p) => app.get(p)?.core === c);
        return `<button class="planet ${c === fc ? "cur" : ""}" data-core="${c.id}"><h3 title="${esc(c.title)}"><span class="n">${ci + 1}</span><span class="tt">${esc(c.title)}</span></h3><p title="${esc(c.summary)}">${esc(c.summary)}</p><div class="dots">${items.map((p) => `<i class="${app.isReviewed(p) ? "d" : ""}"></i>`).join("")}</div></button>`;
      }).join("")}</div></div>`;
    }

    function ring(slide) {
      const loc = app.get(app.focus);
      const { pl, core, ci } = loc;
      const node = app.nodeOf(pl.id);
      const nb = app.neighbours(pl.id);
      const left = nb.up.map((e) => nbCard(e, e.from)).join("") || `<div class="none">nothing upstream in this core</div>`;
      const right = nb.down.map((e) => nbCard(e, e.to)).join("") || `<div class="none">nothing downstream in this core</div>`;
      let meta;
      if (node.kind === "context") meta = `${node.location.path}:${node.location.line} · untouched`;
      else { const { a, d } = app.stat(pl.id); meta = `${node.file} · +${a} −${d}`; }
      const items = BANDS.map((b) => app.band(core, b));
      const orbit = items.map((list, bi) => list.map((p) => {
        const n = app.nodeOf(p.id);
        const tgt = app.canonical(p.id);
        return `<i class="${p.band === "core" ? "core" : n.kind} ${p.id === app.focus ? "cur" : ""} ${app.isReviewed(tgt) ? "done" : ""}" data-go="${tgt}" title="${esc(BAND_TEXT[p.band])}: ${esc(p.title)}"></i>`;
      }).join("") + (bi < 4 && list.length ? `<span class="sep"></span>` : "")).join("");
      const body = app.level === 1; // the focus shows its comments + code; neighbours stay title + why
      return `<div class="ring ${body ? "wide" : ""}">
        <div class="side left ${slide}"><h4>relies on</h4>${left}</div>
        <div class="center ${slide}"><h4>${esc(BAND_TEXT[pl.band])} · core ${ci + 1}/${app.graph.cores.length}</h4>
          <div class="focus ${node.kind}" data-open="1"><div class="t"><i class="glyph ${pl.band === "core" ? "core" : node.kind}"></i>${esc(pl.title)}${app.isReviewed(pl.id) ? " ✓" : ""}</div><div class="w">${esc(pl.why)}</div>${body ? `<div class="nbody"></div>` : `<div class="m">${esc(meta)}</div>`}</div></div>
        <div class="side right ${slide}"><h4>affects</h4>${right}</div>
        <div class="orbit"><span class="lab">${esc(core.title)}</span>${orbit}</div>
        <svg></svg>
      </div>`;
    }

    function wire() {
      const r = root.querySelector(".ring");
      if (!r) return;
      const svg = r.querySelector("svg"), box = r.getBoundingClientRect(), f = r.querySelector(".focus").getBoundingClientRect();
      r.querySelectorAll(".elbl").forEach((n) => n.remove());
      const paths = [];
      const link = (n, side) => {
        const b = n.getBoundingClientRect();
        const [x1, y1, x2, y2] = side === "left"
          ? [b.right - box.left, b.top + b.height / 2 - box.top, f.left - box.left, f.top + f.height / 2 - box.top]
          : [f.right - box.left, f.top + f.height / 2 - box.top, b.left - box.left, b.top + b.height / 2 - box.top];
        const mx = (x1 + x2) / 2;
        paths.push(`<path d="M${x1},${y1} C${mx},${y1} ${mx},${y2} ${x2},${y2}"/>`);
        if (n.dataset.edge && app.level < 2) {
          const l = document.createElement("div");
          l.className = "elbl"; l.textContent = n.dataset.edge;
          l.style.left = `${mx}px`; l.style.top = `${(y1 + y2) / 2}px`;
          r.appendChild(l);
        }
      };
      r.querySelectorAll(".side.left .nb").forEach((n) => link(n, "left"));
      r.querySelectorAll(".side.right .nb").forEach((n) => link(n, "right"));
      svg.innerHTML = paths.join("");
    }

    function update(reason) {
      const loc = app.get(app.focus);
      const paged = app.level === 2;
      if (app.level !== 1) filled = false; // f holds at the core level, where the focus shows its code
      root.classList.toggle("paged", paged);
      root.classList.toggle("filled", filled);
      if (app.level === 0 || !loc) {
        if (!loc && paged) { root.innerHTML = `<div class="pane"></div>`; app.renderPage(root.firstElementChild, app.focus); return; }
        app.pageEl = null;
        root.innerHTML = planets();
        root.querySelector(".planet.cur")?.scrollIntoView({ block: "nearest" });
        prevFocus = null;
        return;
      }
      // Slide in from the side the new focus was on, so the move feels spatial.
      let slide = "";
      if (reason === "focus" && prevFocus) slide = prevSides.right.includes(app.focus) ? "slide-l" : prevSides.left.includes(app.focus) ? "slide-r" : "";
      const nb = app.neighbours(app.focus);
      prevSides = { left: nb.up.map((e) => e.from), right: nb.down.map((e) => e.to) };
      prevFocus = app.focus;
      const keepScroll = reason === "marks" || reason === "comments";
      const oldPane = root.querySelector(".pane, .nbody");
      const scroll = keepScroll && oldPane ? oldPane.scrollTop : 0;
      root.innerHTML = ring(slide) + (paged ? `<div class="pane"></div>` : "");
      const codeEl = root.querySelector(".pane, .nbody");
      if (paged) app.renderPage(codeEl, app.focus);
      else app.renderNode(codeEl, app.focus);
      codeEl.scrollTop = scroll;
      ro.disconnect();
      ro.observe(root.querySelector(".focus")); // folding/composing resizes the card: redraw the connectors
      requestAnimationFrame(wire);
      if (slide) setTimeout(wire, 340);
    }

    const ro = new ResizeObserver(() => requestAnimationFrame(wire));
    root.addEventListener("click", (ev) => {
      if (ev.target.closest(".node")) return;
      const t = ev.target.closest("[data-go],[data-core],[data-open]");
      if (!t) return;
      if (t.dataset.core) { const first = app.index.walk.find((p) => app.get(p)?.core.id === t.dataset.core && !app.isReviewed(p)) ?? app.index.walk.find((p) => app.get(p)?.core.id === t.dataset.core); return app.setFocus(first, { level: 1 }); }
      if (t.dataset.open) return app.setLevel(2);
      app.setFocus(t.dataset.go);
    });

    // ---- arrows follow edges: → to what the focus affects, ← to what it relies on, ↑/↓ to its siblings
    // (the other pages hanging off the same neighbour), in walk order.
    function move(dc, dr) {
      const loc = app.get(app.focus);
      if (!loc) return;
      const nb = app.neighbours(app.focus);
      if (dc) { const e = dc > 0 ? nb.down[0] : nb.up[0]; return e && app.setFocus(dc > 0 ? e.to : e.from); }
      const order = app.corePlacements(loc.core).map((pl) => pl.id);
      const via = nb.up[0] ? app.neighbours(nb.up[0].from).down.map((e) => e.to) : nb.down[0] ? app.neighbours(nb.down[0].to).up.map((e) => e.from) : [];
      const sib = [...new Set([app.focus, ...via])].sort((a, b) => order.indexOf(a) - order.indexOf(b));
      const to = sib[sib.indexOf(app.focus) + dr];
      if (to) app.setFocus(to);
    }
    const fill = () => { if (app.level !== 1) { app.setLevel(1); return setTimeout(fill, 60); } filled = !filled; update("fill"); };
    const keys = {
      ArrowLeft: () => move(-1, 0), ArrowRight: () => move(1, 0), ArrowUp: () => move(0, -1), ArrowDown: () => move(0, 1),
      f: () => fill(),
      g: () => app.setLevel(app.level === 2 ? 1 : 2),
      Escape: () => (filled ? fill() : app.setLevel(app.level - 1)),
    };

    update("mount");
    return { update: (r) => (r === "resize" ? wire() : update(r)), keys, destroy() { ro.disconnect(); } };
  },
};
