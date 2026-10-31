// Map: how the PR changes what the system does, as diagrams, before and after. Claude draws it (map.ts, through
// /api/map): it scopes the change and what it affects, then draws it at layers of abstraction it defines for the PR,
// from an overview in plain words down to the code. Each layer is one graph whose parts are marked same, added, removed
// or changed, laid out once: a slider runs from before to after, fading out what the PR removes and in what it adds,
// so nothing moves as you compare; or split, before and after side by side. A part's code opens in the code viewer.
import { api, esc } from "../core.js";
import { openRef } from "../code.js";
import { mapLayout } from "./maplayout.js";
import { injectCss } from "./flow.js";

const KIND = { function: "function", module: "module", service: "service", actor: "person", screen: "screen", store: "data store", queue: "queue", external: "outside system", infra: "infra" };
const W = 236; // a box's width (a step or an outcome is as wide as its words, up to this)
const STEPS = 8; // the steps the loader shows, the latest last (the server keeps as many)

const CSS = `
.bmap { position: absolute; inset: 0; display: flex; flex-direction: column; min-height: 0; }
.bmap .banner { padding: 7px 24px; font-size: 13px; color: var(--muted); background: var(--raised); border-bottom: 1px solid var(--line-soft); display: flex; gap: 10px; align-items: center; }
.bmap .banner .btn { padding: 3px 10px; font-size: 12.5px; }
.bmap .mbody { flex: 1; min-height: 0; display: flex; }
.bmap .mleft { flex: 1; display: flex; flex-direction: column; min-width: 0; min-height: 0; }
.bmap .stage { flex: 1; min-height: 0; position: relative; display: flex; min-width: 0; cursor: grab; touch-action: none; }
.bmap .pane { position: relative; flex: 1; min-width: 0; overflow: hidden; }
.bmap .pane + .pane { border-left: 1px solid var(--line-soft); }
.bmap .ptag { position: absolute; left: 16px; top: 12px; z-index: 1; font: 600 10.5px var(--font-ui); letter-spacing: .09em; text-transform: uppercase; color: var(--faint); pointer-events: none; }
.bmap .stage.panning { cursor: grabbing; user-select: none; }
.bmap .mzoom { position: absolute; left: 16px; bottom: 16px; display: flex; border: 1px solid var(--line); border-radius: 3px; background: var(--surface); overflow: hidden; cursor: default; }
.bmap .mzoom button { min-width: 30px; padding: 4px 8px; border: 0; background: none; font: 13px var(--font-ui); color: var(--muted); font-variant-numeric: tabular-nums; }
.bmap .mzoom button + button { border-left: 1px solid var(--line); }
.bmap .mzoom button:hover { color: var(--text); background: var(--raised); }
.bmap .plane { position: absolute; left: 0; top: 0; transform-origin: 0 0; }
.bmap .plane > svg { position: absolute; inset: 0; overflow: visible; pointer-events: none; }
.bmap .mn { position: absolute; width: ${W}px; box-sizing: border-box; padding: 8px 12px 9px; border: 1px solid var(--line); border-radius: 3px; background: var(--surface); transition: opacity var(--dur, .2s), border-color var(--dur, .2s); }
.bmap .mn[data-ref] { cursor: pointer; }
.bmap .mn[data-ref]:hover { border-color: var(--muted); }
.bmap .mn.kind-actor { border-radius: 20px; padding-left: 16px; padding-right: 16px; }
.bmap .mn.kind-store { border-bottom-width: 2px; }
.bmap .mn.kind-external, .bmap .mn.kind-infra { border-style: dashed; }
.bmap .mn.kind-step, .bmap .mn.kind-outcome { width: max-content; min-width: 104px; max-width: ${W}px; text-align: center; }
.bmap .mn.kind-step .ml { margin: 0; }
.bmap .mn.kind-outcome { border-color: transparent; background: var(--bg); }
.bmap .mn.kind-outcome .ml { margin: 0; font-weight: 500; color: var(--muted); }
.bmap .mp { list-style: none; margin: 6px 0 0; padding: 0; font-size: 12px; line-height: 1.45; color: var(--muted); text-align: left; }
.bmap .mp li::before { content: "· "; color: var(--faint); }
.bmap .mps { display: grid; }
.bmap .mps > .mp { grid-area: 1 / 1; }
.bmap .mps > .was { opacity: calc(1 - var(--t)); }
.bmap .mps > .now { opacity: var(--t); }
.bmap .mk { display: flex; gap: 6px; align-items: baseline; font: 500 11px var(--font-ui); color: var(--faint); white-space: nowrap; min-width: 0; }
.bmap .mk .kd { flex: none; }
.bmap .mk .g { overflow: hidden; text-overflow: ellipsis; min-width: 0; }
.bmap .mk .g::before { content: "· "; }
.bmap .ml { margin-top: 3px; font: 600 13.5px/1.3 var(--font-prose); color: var(--text); overflow-wrap: break-word; }
.bmap .mn.kind-function .ml, .bmap .mn.kind-module .ml { font: 600 12px/1.35 var(--font-code); overflow-wrap: anywhere; }
.bmap .plane path { fill: none; stroke: var(--faint); stroke-width: 1.2; transition: opacity var(--dur, .2s); }
.bmap .el { position: absolute; transform: translate(-50%, -50%); max-width: 168px; width: max-content; padding: 1px 6px; border-radius: 3px; background: var(--bg); font: 11.5px/1.35 var(--font-ui); color: var(--muted); text-align: center; text-wrap: balance; transition: opacity var(--dur, .2s); }
.bmap .el.two { display: grid; }
.bmap .el.two > span { grid-area: 1 / 1; align-self: center; }
.bmap .el .was { opacity: calc(1 - var(--t)); }
.bmap .el .now { opacity: var(--t); }
/* the slider: --t runs from 0 (before) to 1 (after); what's only in one of them fades with it */
@property --t { syntax: "<number>"; inherits: true; initial-value: 1; }
.bmap .plane { transition: --t .45s ease; }
.bmap .plane.glide { transition: --t .45s ease, transform .3s ease; }
.bmap .plane.sliding { transition: none; }
.bmap .mn, .bmap .el, .bmap .plane path { opacity: calc(var(--o, 1) * var(--d, 1)); }
.bmap .st-added { --o: var(--t); }
.bmap .st-removed { --o: calc(1 - var(--t)); }
.bmap .plane.at-before .st-added, .bmap .plane.at-after .st-removed { pointer-events: none; }
/* in the shell's crumb bar (chrome.js), beside its layout switch */
#where .mslide { display: flex; align-items: center; gap: 8px; }
#where .mslide button { padding: 2px 2px; }
#where .mslide input { width: 120px; accent-color: var(--text); }
#where .mi { font-style: normal; color: var(--faint); margin-right: 5px; font-variant-numeric: tabular-nums; }
/* before there's a map, or while Claude draws it: one card, anchored near the top at a set width, that never resizes */
.bmap .mintro { position: absolute; inset: 0; overflow: auto; display: grid; place-items: start center; padding: 12vh 24px 40px; }
.bmap .mcard { width: min(600px, 100%); background: var(--surface); border: 1px solid var(--line); border-radius: 6px; padding: 22px 26px; box-sizing: border-box; }
.bmap .mcard h2 { margin: 0; font: 600 16px var(--font-ui); }
.bmap .mcard p { margin: 6px 0 0; font-size: 14px; line-height: 1.55; color: var(--muted); }
.bmap .msteps { list-style: none; margin: 18px 0 0; padding: 0; height: calc(${STEPS} * 24px); display: grid; grid-auto-rows: 24px; align-content: start; font: 12.5px var(--font-code); }
.bmap .msteps li { display: grid; grid-template-columns: 18px minmax(0, 1fr); gap: 8px; align-items: center; color: var(--faint); }
.bmap .msteps li span { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.bmap .msteps li.now { color: var(--text); }
.bmap .msteps li i { width: 6px; height: 6px; margin-left: 4px; border-radius: 50%; background: var(--line); }
.bmap .msteps li.now i { width: 12px; height: 12px; margin-left: 1px; background: none; box-sizing: border-box; border: 2px solid var(--line); border-top-color: var(--text); animation: spin .8s linear infinite; }
@media (prefers-reduced-motion: reduce) { .bmap .msteps li.now i { animation: none; } }
.bmap .mfootrow { display: flex; align-items: center; gap: 12px; margin-top: 18px; padding-top: 14px; border-top: 1px solid var(--line-soft); font-size: 12.5px; color: var(--faint); }
.bmap .mfootrow .mel { font-variant-numeric: tabular-nums; color: var(--muted); }
.bmap .mfootrow .btn { margin-left: auto; padding: 4px 12px; font-size: 13px; }
.bmap .merr { margin-top: 12px !important; color: var(--risk) !important; }
`;

/** ref://head/path#L12-L20 (map.ts) → what openRef takes. */
function parseRef(ref) {
  const m = /^ref:\/\/(head|base)\/(.+?)#L(\d+)(?:-L(\d+))?$/.exec(ref ?? "");
  if (!m) return null;
  const path = m[2].split("/").map((x) => { try { return decodeURIComponent(x); } catch { return x; } }).join("/");
  return { side: m[1], path, line: Number(m[3]), ...(m[4] ? { end: Number(m[4]) } : {}) };
}

export default {
  id: "map",
  name: "Map",
  hint: "How behaviour changes, before and after",
  apart: true, // a diagram of its own: it doesn't show the walk's focus, and its address names no step
  mount(el, app) {
    injectCss("map", CSS);
    const root = el.appendChild(Object.assign(document.createElement("div"), { className: "bmap" }));
    const isSplit = () => app.settings.diffLayout === "split"; // the shell's Inline / Split, as for Diff
    let split = isSplit();
    let planes = [];
    let tick = 0, data = null, t = 1, layer = 0, dead = false, timer = 0, plane = null, size = null, drawn = "";
    // the camera: framed to fit the map until you pan or zoom; then yours until another map is drawn
    let cam = { tx: 0, ty: 0, s: 1 }, mine = false;

    async function load() {
      clearTimeout(timer);
      try { data = await api("/api/map"); } catch (e) { data = { error: e.message, map: null, running: false, steps: [] }; }
      if (dead) return;
      render();
      if (data.running) timer = setTimeout(load, 1500);
    }
    async function draw() {
      const r = await api("/api/map/start", {}).catch((e) => ({ ok: false, error: e.message }));
      if (!r.ok) { data = { ...data, error: r.error }; return render(); }
      layer = 0;
      load();
    }

    function render() {
      const m = data?.map;
      if (!m) return intro();
      layer = Math.min(layer, m.layers.length - 1);
      const L = m.layers[layer];
      const banner = data.running ? `<div class="banner">Redrawing the map: ${esc(data.steps.at(-1) ?? "starting")}… <button class="btn quiet" data-cancel>Stop</button></div>`
        : data.error ? `<div class="banner">Couldn't redraw it: ${esc(data.error)}</div>`
        : data.stale ? `<div class="banner">Drawn for an earlier commit of this PR. <button class="btn" data-redraw>Redraw it</button></div>` : "";
      root.innerHTML = `
        ${banner}
        <div class="mbody">
          <div class="mleft">
            <div class="stage">${(split ? [["before", "Before"], ["after", "After"]] : [["", ""]]).map(([side, name]) => `<div class="pane">${name ? `<span class="ptag">${name}</span>` : ""}<div class="plane" data-side="${side}"></div></div>`).join("")}
              <div class="mzoom"><button data-zoom="-1" title="Zoom out">−</button><button data-zoom="fit" title="Fit the map to the canvas"></button><button data-zoom="1" title="Zoom in">+</button></div></div>
          </div>
        </div>`;
      planes = [...root.querySelectorAll(".plane")];
      plane = planes[0];
      app.renderWhere?.();
      if (drawn !== `${m.at} ${layer} ${split}`) { drawn = `${m.at} ${layer} ${split}`; mine = false; } // a new map, layer or mode: framed afresh
      diagram(m);
    }

    /** The shell's crumb bar, while Map is open (chrome.js): its layers as crumbs, the slider and Redraw. */
    function where() {
      const m = data?.map;
      if (!m) return { crumbs: [`<button class="here">Map</button>`] };
      return {
        crumbs: m.layers.map((x, i) => `<button data-mlayer="${i}" class="${i === layer ? "here" : ""}" title="${esc(x.about)}">${m.layers.length > 1 ? `<i class="mi">${i + 1}</i>` : ""}${esc(x.name)}</button>`),
        controls: `${split ? "" : `<span class="mslide"><button data-mend="0" class="${t < 0.5 ? "here" : ""}">Before</button><input type="range" min="0" max="1" step="0.01" value="${t}" aria-label="Before or after the PR"><button data-mend="1" class="${t >= 0.5 ? "here" : ""}">After</button></span>`}
          <button data-mredraw ${data.running ? "disabled" : ""} title="${esc(`Drawn by Claude ${new Date(m.at).toLocaleString()}${m.cost ? `, $${m.cost.toFixed(2)}` : ""}. Click to draw it again`)}">Redraw</button>`,
        layout: "Before and after: inline on a slider, or side by side",
      };
    }

    function intro() {
      app.renderWhere?.();
      if (data?.running) return drawing();
      clearInterval(tick);
      root.innerHTML = `<div class="mintro"><div class="mcard">
        <h2>Map</h2>
        <p>How this PR changes what the system does, drawn before and after. Claude works out what the change touches and how far its effect reaches, then draws it in layers: an overview in plain words first, then each layer opening up where the change is, down to the code.</p>
        <p>It reads the PR and the code around it, reading only, in a minute or two.</p>
        <p style="margin-top:18px"><button class="btn primary" data-draw>Draw the map</button></p>
        ${data?.error ? `<p class="merr">${esc(data.error)}</p>` : ""}
      </div></div>`;
    }

    /** While Claude draws it: the card is drawn once, then only its steps and its clock change, so nothing moves. */
    function drawing() {
      if (!root.querySelector(".mrun")) {
        root.innerHTML = `<div class="mintro"><div class="mcard mrun">
          <h2>Drawing the map</h2>
          <p>Claude is reading the PR and the code around it.</p>
          <ol class="msteps"></ol>
          <div class="mfootrow"><span class="mel"></span><span>usually a minute or two</span><button class="btn" data-cancel>Stop</button></div>
        </div></div>`;
        clearInterval(tick);
        tick = setInterval(clock, 1000);
      }
      const steps = (data.steps.length ? data.steps : ["Starting"]).slice(-STEPS);
      root.querySelector(".msteps").innerHTML = steps.map((x, k) => {
        const now = k === steps.length - 1;
        return `<li class="${now ? "now" : ""}" style="opacity:${now ? 1 : Math.max(0.35, 1 - (steps.length - 1 - k) * 0.09)}"><i></i><span title="${esc(x)}">${esc(middle(x))}</span></li>`;
      }).join("");
      clock();
    }
    /** A long step loses its middle, not its end, which is usually the file it's on. */
    const middle = (x, max = 68) => (x.length <= max ? x : `${x.slice(0, 26)}…${x.slice(x.length - (max - 27))}`);
    function clock() {
      const el = root.querySelector(".mel");
      if (!el || !data?.running) return clearInterval(tick);
      const secs = Math.max(0, Math.round((Date.now() - (data.startedAt || Date.now())) / 1000));
      el.textContent = secs < 60 ? `${secs}s` : `${Math.floor(secs / 60)}m ${String(secs % 60).padStart(2, "0")}s`;
    }

    /** Draws the layer on each plane: inline, all its parts, which the slider fades; split, before's on one side and
     *  after's on the other, each laid out on its own. The planes share a camera, so they pan and zoom together. */
    function diagram(m) {
      const L = m.layers[layer], sizes = [];
      for (const p of planes) {
        const side = p.dataset.side, keep = (st) => (side === "before" ? st !== "added" : side === "after" ? st !== "removed" : true);
        const nodes = L.nodes.filter((n) => keep(n.status)), ids = new Set(nodes.map((n) => n.id));
        const edges = L.edges.map((e, i) => ({ ...e, i })).filter((e) => keep(e.status) && ids.has(e.from) && ids.has(e.to));
        sizes.push(drawPlane(p, m, nodes, edges));
        if (side) { p.style.setProperty("--t", side === "after" ? 1 : 0); p.classList.add("sliding", side === "after" ? "at-after" : "at-before"); } // a side shows its own end
      }
      size = { w: Math.max(...sizes.map((x) => x.w)), h: Math.max(...sizes.map((x) => x.h)) };
      if (!split) slide(t);
      if (!mine) cam = fitted();
      apply();
    }

    function drawPlane(plane, m, nodes, edges) {
      const plain = (k) => k === "step" || k === "outcome"; // a box that's only its words
      const list = (ps, cls = "") => `<ul class="mp${cls}">${ps.map((x) => `<li>${esc(x)}</li>`).join("")}</ul>`;
      // the cases inside a part; a changed part's, fading from what they were into what they are
      const points = (n) => (n.before ? `<div class="mps">${list(n.before, " was")}${list(n.points ?? [], " now")}</div>` : n.points?.length ? list(n.points) : "");
      // boxes and labels first, so the layout knows their sizes
      plane.innerHTML = nodes.map((n) => `<div class="mn kind-${esc(n.kind)} st-${n.status}" data-id="${esc(n.id)}"${n.ref ? ` data-ref="${esc(n.ref)}"` : ""} title="${esc([n.note, n.ref ? "Click to open its code" : ""].filter(Boolean).join("\n"))}">
          ${plain(n.kind) ? "" : `<div class="mk"><span class="kd">${KIND[n.kind] ?? esc(n.kind)}</span>${n.group ? `<span class="g">${esc(n.group)}</span>` : ""}</div>`}
          <div class="ml">${esc(n.label)}</div>${points(n)}</div>`).join("") +
        edges.map((e, j) => {
          // a changed interaction: what it did, fading into what it does, in one place
          const two = e.status === "changed" && e.before && e.before !== e.label;
          const inner = two ? `<span class="was">${esc(e.before)}</span><span class="now">${esc(e.label)}</span>` : esc(e.label);
          return e.label || two ? `<div class="el st-${e.status}${two ? " two" : ""}" data-edge="${j}">${inner}</div>` : "";
        }).join("");
      const box = new Map([...plane.querySelectorAll(".mn")].map((d) => [d.dataset.id, d]));
      const tag = new Map([...plane.querySelectorAll(".el")].map((d) => [Number(d.dataset.edge), d]));
      const lay = mapLayout(nodes.map((n) => ({ id: n.id, w: box.get(n.id).offsetWidth, h: box.get(n.id).offsetHeight })),
        edges.map((e, j) => ({ from: e.from, to: e.to, label: tag.has(j) ? { w: tag.get(j).offsetWidth, h: tag.get(j).offsetHeight } : null })));
      for (const [id, d] of box) { const p = lay.nodes.get(id); d.style.left = `${p.x}px`; d.style.top = `${p.y}px`; }
      const paths = [];
      edges.forEach((e, j) => {
        const at = lay.edges[j];
        if (!at) return;
        // through each point in turn, leaving and arriving upright, so each bend is a soft S
        const [p0, ...rest] = at.points;
        let d = `M${p0[0]},${p0[1]}`, prev = p0;
        for (const q of rest) { const my = (prev[1] + q[1]) / 2; d += ` C${prev[0]},${my} ${q[0]},${my} ${q[0]},${q[1]}`; prev = q; }
        paths.push(`<path class="st-${e.status}" d="${d}" marker-end="url(#mapArrow)"/>`);
        const lb = tag.get(j);
        if (lb && at.label) { lb.style.left = `${at.label.x}px`; lb.style.top = `${at.label.y}px`; }
      });
      plane.insertAdjacentHTML("afterbegin", `<svg width="${lay.width}" height="${lay.height}"><defs><marker id="mapArrow" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="6" markerHeight="6" orient="auto-start-reverse"><path d="M0,1 L9,5 L0,9 z" style="fill:var(--faint);stroke:none"/></marker></defs>${paths.join("")}</svg>`);
      plane.style.width = `${lay.width}px`; plane.style.height = `${lay.height}px`;
      return { w: lay.width, h: lay.height };
    }

    // ---- the canvas: a fixed stage the map moves and scales in. Drag or scroll to pan; pinch or ctrl+scroll to zoom.
    const PAD = 40, MIN = 0.2, MAX = 2;
    const stageEl = () => root.querySelector(".pane"); // each pane is the same size
    function apply(glide = false) {
      if (!plane) return;
      for (const p of planes) { p.classList.toggle("glide", glide); p.style.transform = `translate(${cam.tx}px, ${cam.ty}px) scale(${cam.s})`; }
      const pct = root.querySelector('[data-zoom="fit"]');
      if (pct) pct.textContent = `${Math.round(cam.s * 100)}%`;
    }
    /** The whole map in view, centred; never bigger than life. */
    function fitted() {
      const st = stageEl(), s = Math.max(MIN, Math.min(1, (st.clientWidth - 2 * PAD) / size.w, (st.clientHeight - 2 * PAD) / size.h));
      return { s, tx: (st.clientWidth - size.w * s) / 2, ty: Math.max(PAD, (st.clientHeight - size.h * s) / 2) };
    }
    /** Zooms by k around a point of the stage (its centre by default). */
    function zoom(k, px, py, glide = false) {
      const st = stageEl(), s = Math.max(MIN, Math.min(MAX, cam.s * k));
      px ??= st.clientWidth / 2; py ??= st.clientHeight / 2;
      cam = { s, tx: px - ((px - cam.tx) / cam.s) * s, ty: py - ((py - cam.ty) / cam.s) * s };
      mine = true;
      apply(glide);
    }
    let pan = null, dragged = false;
    root.addEventListener("pointerdown", (ev) => {
      const st = ev.target.closest(".stage");
      if (!st || ev.button || ev.target.closest(".mzoom")) return;
      pan = { st, x: ev.clientX, y: ev.clientY, cam: { ...cam }, id: ev.pointerId };
      dragged = false;
    });
    root.addEventListener("pointermove", (ev) => {
      if (pan?.id !== ev.pointerId) return;
      const dx = ev.clientX - pan.x, dy = ev.clientY - pan.y;
      if (!dragged && Math.hypot(dx, dy) < 4) return; // a click on a box stays a click
      if (!dragged) { dragged = true; pan.st.setPointerCapture(ev.pointerId); pan.st.classList.add("panning"); }
      cam = { ...pan.cam, tx: pan.cam.tx + dx, ty: pan.cam.ty + dy };
      mine = true;
      apply();
    });
    const endPan = () => { pan?.st.classList.remove("panning"); pan = null; };
    root.addEventListener("pointerup", endPan);
    root.addEventListener("pointercancel", endPan);
    root.addEventListener("wheel", (ev) => {
      const st = ev.target.closest(".stage");
      if (!st) return;
      ev.preventDefault();
      const r = (ev.target.closest(".pane") ?? stageEl()).getBoundingClientRect(); // around the pointer in its own pane
      if (ev.ctrlKey || ev.metaKey) return zoom(Math.exp(-ev.deltaY * 0.01), ev.clientX - r.left, ev.clientY - r.top); // pinch, or ctrl+scroll
      cam = { ...cam, tx: cam.tx - ev.deltaX, ty: cam.ty - ev.deltaY };
      mine = true;
      apply();
    }, { passive: false });

    /** Moves the slider to v, 0 (before) to 1 (after): nothing is laid out again, the parts only in one fade. */
    function slide(v, sliding = false) {
      t = Math.max(0, Math.min(1, v));
      if (!plane || split) return;
      plane.classList.toggle("sliding", sliding);
      plane.style.setProperty("--t", t);
      plane.classList.toggle("at-before", t < 0.5);
      plane.classList.toggle("at-after", t >= 0.5);
      const input = whereEl.querySelector(".mslide input");
      if (input && Number(input.value) !== t) input.value = t;
      whereEl.querySelectorAll(".mslide [data-mend]").forEach((b) => b.classList.toggle("here", Math.round(t) === Number(b.dataset.mend)));
    }
    // the controls in the shell's crumb bar
    const whereEl = document.getElementById("where"), off = new AbortController();
    whereEl.addEventListener("input", (ev) => { if (ev.target.matches(".mslide input")) slide(Number(ev.target.value), true); }, { signal: off.signal });
    whereEl.addEventListener("click", (ev) => {
      const b = ev.target.closest("[data-mend],[data-mlayer],[data-mredraw]");
      if (!b) return;
      if (b.dataset.mend) slide(Number(b.dataset.mend));
      else if (b.dataset.mlayer) toLayer(Number(b.dataset.mlayer));
      else draw();
    }, { signal: off.signal });
    root.addEventListener("click", (ev) => {
      const t = ev.target;
      if (dragged) { dragged = false; return; } // the end of a pan, not a click
      const z = t.closest("[data-zoom]");
      if (z) { if (z.dataset.zoom === "fit") { cam = fitted(); mine = false; apply(true); } else zoom(z.dataset.zoom > 0 ? 1.25 : 0.8, undefined, undefined, true); return; }
      const b = t.closest("[data-draw],[data-redraw],[data-cancel],.mn[data-ref]");
      if (!b) return;
      if (b.hasAttribute("data-draw") || b.hasAttribute("data-redraw")) draw();
      else if (b.hasAttribute("data-cancel")) api("/api/map/cancel", {}).then(load);
      else if (b.dataset.ref) { const r = parseRef(b.dataset.ref); if (r) openRef(app, r); }
    });
    const toLayer = (i) => { const n = data?.map?.layers.length ?? 0; if (i >= 0 && i < n && i !== layer) { layer = i; render(); } };

    const keys = { // by action (keys.js)
      left: () => slide(0), right: () => slide(1), // inline only: split shows both
      zoomIn: () => toLayer(layer + 1),
      zoomOut: () => toLayer(layer - 1),
    };

    load();
    return {
      update(why) { if (why === "resize") { if (plane && size && !mine) { cam = fitted(); apply(); } } else if (why === "settings" && data) { split = isSplit(); render(); } },
      keys,
      where,
      destroy() { dead = true; off.abort(); clearTimeout(timer); clearInterval(tick); root.remove(); },
    };
  },
};
