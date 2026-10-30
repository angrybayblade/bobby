// Map: how the PR changes what the system does, as a diagram, before and after. Claude draws it (map.ts, through
// /api/map) at the level the change lives at: local (one function to another), module, service, the end user's or the
// infrastructure's. It's one graph whose parts are marked same, added, removed or changed, so Before, After and Changes
// are three ways of drawing the same data; the rail lists the behavioural changes, and picking one lights up its part
// of the diagram. A node's code, and the code a change cites, open in the code viewer.
import { api, esc } from "../core.js";
import { md } from "../comments.js";
import { openRef } from "../code.js";
import { layered } from "./layered.js";
import { injectCss } from "./flow.js";

const LEVELS = [["local", "Local", "function to function"], ["module", "Module", "module to module"], ["service", "Service", "service to service"], ["user", "End user", "what users see"], ["infra", "Infra", "how it runs"]];
const KIND = { function: "function", module: "module", service: "service", actor: "person", screen: "screen", store: "data store", queue: "queue", external: "outside system", infra: "infra" };
const MODES = [["before", "Before"], ["changes", "Changes"], ["after", "After"]];
const W = 210, COL = 130; // a node's width; the gap between columns, where the edges' labels go

const CSS = `
.bmap { position: absolute; inset: 0; display: flex; flex-direction: column; min-height: 0; }
.bmap .mhd { display: flex; gap: 24px; align-items: flex-start; justify-content: space-between; padding: 14px 24px 12px; border-bottom: 1px solid var(--line-soft); }
.bmap .mhd h2 { margin: 3px 0 3px; font: 600 calc(var(--size) * .95)/1.45 var(--font-prose); max-width: 100ch; }
.bmap .mlevel { font: 600 10.5px var(--font-ui); letter-spacing: .09em; text-transform: uppercase; color: var(--faint); }
.bmap .mlevel b { color: var(--text); font-weight: 650; }
.bmap .mwhy { margin: 0; font-size: 12.5px; line-height: 1.45; color: var(--muted); max-width: 100ch; display: -webkit-box; -webkit-line-clamp: 2; -webkit-box-orient: vertical; overflow: hidden; }
.bmap .mctl { display: flex; gap: 10px; align-items: center; flex: none; }
.bmap .seg { display: inline-flex; border: 1px solid var(--line); border-radius: 3px; overflow: hidden; }
.bmap .seg button { padding: 5px 12px; font-size: 13px; color: var(--muted); background: none; border: 0; }
.bmap .seg button + button { border-left: 1px solid var(--line); }
.bmap .seg button.on { color: var(--text); font-weight: 650; background: var(--raised); } /* weight, not colour */
.bmap select { font: 13px var(--font-ui); padding: 5px 8px; border: 1px solid var(--line); border-radius: 3px; background: var(--surface); color: var(--text); }
.bmap .mctl .btn { padding: 5px 12px; font-size: 13px; }
.bmap .banner { padding: 7px 24px; font-size: 13px; color: var(--muted); background: var(--raised); border-bottom: 1px solid var(--line-soft); display: flex; gap: 10px; align-items: center; }
.bmap .banner .btn { padding: 3px 10px; font-size: 12.5px; }
.bmap .mbody { flex: 1; min-height: 0; display: grid; grid-template-columns: 1fr 340px; }
.bmap .stage { overflow: auto; display: flex; min-width: 0; }
.bmap .stage.pans { cursor: grab; }
.bmap .stage.panning { cursor: grabbing; user-select: none; }
.bmap .fit { margin: auto; padding: 28px; flex: none; box-sizing: content-box; }
.bmap .plane { position: relative; transform-origin: 0 0; }
.bmap .plane > svg { position: absolute; inset: 0; overflow: visible; pointer-events: none; }
.bmap .mn { position: absolute; width: ${W}px; box-sizing: border-box; padding: 9px 12px 10px; border: 1px solid var(--line); border-radius: 3px; background: var(--surface); transition: opacity var(--dur, .2s); }
.bmap .mn[data-ref] { cursor: pointer; }
.bmap .mn[data-ref]:hover { border-color: var(--muted); }
.bmap .mn.kind-actor { border-radius: 18px; }
.bmap .mn.kind-store { border-bottom-width: 3px; }
.bmap .mn.kind-external { border-style: dashed; }
.bmap .mk { display: flex; gap: 6px; align-items: baseline; font: 600 9.5px var(--font-ui); letter-spacing: .08em; text-transform: uppercase; color: var(--faint); white-space: nowrap; overflow: hidden; }
.bmap .mk .g { overflow: hidden; text-overflow: ellipsis; text-transform: none; letter-spacing: 0; font-weight: 500; font-size: 11px; }
.bmap .mk .st { margin-left: auto; letter-spacing: .06em; }
.bmap .ml { margin-top: 3px; font: 600 13.5px/1.3 var(--font-prose); overflow-wrap: anywhere; }
.bmap .mn.kind-function .ml, .bmap .mn.kind-module .ml { font: 600 12.5px/1.35 var(--font-code); }
.bmap .mo { margin-top: 4px; font-size: 12px; line-height: 1.4; color: var(--muted); }
.bmap .changes .mn.st-added { border-color: var(--ok); border-width: 1.5px; }
.bmap .changes .mn.st-added .st { color: var(--ok); }
.bmap .changes .mn.st-removed { border-color: var(--risk); border-style: dashed; opacity: .75; }
.bmap .changes .mn.st-removed .ml { text-decoration: line-through; text-decoration-color: var(--risk); }
.bmap .changes .mn.st-removed .st { color: var(--risk); }
.bmap .changes .mn.st-changed { border-color: var(--signal); border-width: 1.5px; }
.bmap .changes .mn.st-changed .st { color: var(--signal); }
.bmap .plane path { fill: none; stroke: var(--muted); stroke-width: 1.4; transition: opacity var(--dur, .2s); }
.bmap .changes path.st-added { stroke: var(--ok); stroke-width: 2; }
.bmap .changes path.st-removed { stroke: var(--risk); stroke-dasharray: 5 4; }
.bmap .changes path.st-changed { stroke: var(--signal); stroke-width: 2; }
.bmap .el { position: absolute; transform: translate(-50%, -50%); max-width: ${COL - 14}px; width: max-content; padding: 1px 5px; border-radius: 2px; background: var(--bg); font: 11.5px/1.3 var(--font-ui); color: var(--muted); text-align: center; text-wrap: balance; transition: opacity var(--dur, .2s); }
.bmap .changes .el.st-added { color: var(--ok); }
.bmap .changes .el.st-removed { color: var(--risk); text-decoration: line-through; }
.bmap .changes .el.st-changed { color: var(--text); }
.bmap .el s { display: block; color: var(--faint); }
.bmap .plane.lit .dim { opacity: .18; }
.bmap .mrail { border-left: 1px solid var(--line-soft); overflow: auto; padding: 16px 18px 40px; }
.bmap .mrail h4 { margin: 0 0 10px; font: 600 10.5px var(--font-ui); letter-spacing: .09em; text-transform: uppercase; color: var(--faint); }
.bmap .mrail ol { list-style: none; margin: 0; padding: 0; display: flex; flex-direction: column; gap: 6px; }
.bmap .mrail li { padding: 9px 11px; border: 1px solid transparent; border-radius: 3px; cursor: pointer; }
.bmap .mrail li:hover { background: var(--raised); }
.bmap .mrail li.on { background: var(--raised); border-color: var(--line); }
.bmap .mrail li .ct { font: 500 13.5px/1.4 var(--font-prose); }
.bmap .mrail li.on .ct { font-weight: 650; }
.bmap .mrail li .ct i { font-style: normal; color: var(--faint); margin-right: 6px; }
.bmap .mrail li .cd { margin-top: 6px; font-size: 13px; line-height: 1.5; color: var(--muted); }
.bmap .mrail li .cd p { margin: 0 0 6px; }
.bmap .mfoot { margin-top: 18px; font-size: 12px; color: var(--faint); }
.bmap .mkeys { margin-top: 6px; font-size: 12px; color: var(--faint); }
.bmap .mintro { max-width: 620px; margin: auto; padding: 40px 24px; }
.bmap .mintro h2 { margin: 0 0 10px; font: 650 calc(var(--size) * 1.5)/1.3 var(--font-prose); }
.bmap .mintro p { font: calc(var(--size) * .98)/1.6 var(--font-prose); color: var(--muted); margin: 0 0 14px; }
.bmap .lvls { display: flex; flex-wrap: wrap; gap: 6px; margin: 18px 0 20px; }
.bmap .lvls button { padding: 6px 11px; border: 1px solid var(--line); border-radius: 3px; background: none; font-size: 13px; color: var(--muted); text-align: left; }
.bmap .lvls button small { display: block; font-size: 11px; color: var(--faint); }
.bmap .lvls button.on { color: var(--text); font-weight: 650; background: var(--raised); }
.bmap .merr { color: var(--risk); font-size: 13.5px; }
.bmap .msteps { list-style: none; padding: 0; margin: 14px 0 20px; font: 13px/1.7 var(--font-ui); color: var(--muted); }
.bmap .msteps li:last-child { color: var(--text); }
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
    let data = null, mode = "changes", sel = -1, want = "", dead = false, timer = 0, plane = null, fitEl = null, size = null;

    async function load() {
      clearTimeout(timer);
      try { data = await api("/api/map"); } catch (e) { data = { error: e.message, map: null, running: false, steps: [] }; }
      if (dead) return;
      render();
      if (data.running) timer = setTimeout(load, 1500);
    }
    async function draw(level) {
      const r = await api("/api/map/start", level ? { level } : {}).catch((e) => ({ ok: false, error: e.message }));
      if (!r.ok) { data = { ...data, error: r.error }; return render(); }
      sel = -1;
      load();
    }

    function render() {
      const m = data?.map;
      if (!m) return intro();
      const lvl = LEVELS.find((l) => l[0] === m.level) ?? LEVELS[1];
      const banner = data.running ? `<div class="banner">Redrawing the map: ${esc(data.steps.at(-1) ?? "starting")}… <button class="btn quiet" data-cancel>Stop</button></div>`
        : data.error ? `<div class="banner">Couldn't redraw it: ${esc(data.error)}</div>`
        : data.stale ? `<div class="banner">Drawn for an earlier commit of this PR. <button class="btn" data-redraw>Redraw it</button></div>` : "";
      root.innerHTML = `
        <div class="mhd">
          <div><div class="mlevel"><b>${lvl[1]}</b> · ${lvl[2]}</div><h2>${esc(m.summary)}</h2><p class="mwhy" title="${esc(m.why)}">${esc(m.why)}</p></div>
          <div class="mctl">
            <div class="seg">${MODES.map(([id, name]) => `<button data-mode="${id}" class="${mode === id ? "on" : ""}">${name}</button>`).join("")}</div>
            <select data-level title="The level to draw it at"><option value="">Claude picks the level</option>${LEVELS.map(([id, name, sub]) => `<option value="${id}"${want === id ? " selected" : ""}>${name}: ${sub}</option>`).join("")}</select>
            <button class="btn" data-redraw ${data.running ? "disabled" : ""}>Redraw</button>
          </div>
        </div>
        ${banner}
        <div class="mbody">
          <div class="stage"><div class="fit"><div class="plane ${mode}${sel >= 0 ? " lit" : ""}"></div></div></div>
          <aside class="mrail">
            <h4>What changes</h4>
            <ol>${m.changes.map((c, i) => `<li data-change="${i}" class="${sel === i ? "on" : ""}"><div class="ct"><i>${i + 1}</i>${esc(c.title)}</div><div class="cd">${md(c.detail)}</div></li>`).join("")}</ol>
            <div class="mkeys">← → before, changes, after · ↑ ↓ step through the changes</div>
            <div class="mfoot">Drawn by Claude ${new Date(m.at).toLocaleString()}${m.cost ? ` · $${m.cost.toFixed(2)}` : ""}</div>
          </aside>
        </div>`;
      plane = root.querySelector(".plane");
      fitEl = root.querySelector(".fit");
      root.querySelector(".mrail li.on")?.scrollIntoView({ block: "nearest" });
      diagram(m);
    }

    function intro() {
      const running = data?.running;
      root.innerHTML = `<div class="mintro">${running
        ? `<h2>Drawing the map…</h2><p>Claude is reading the PR and the code around it.</p>
           <ul class="msteps">${(data.steps.length ? data.steps : ["Starting"]).map((s) => `<li>${esc(s)}</li>`).join("")}</ul>
           <button class="btn" data-cancel>Stop</button>`
        : `<h2>Map</h2>
           <p>How this PR changes what the system does: a diagram of before and after, at the level the change lives at, from one function calling another up to services, what users see, or how it runs.</p>
           <p>Claude draws it from the PR and the code around it, reading only. It takes a minute or two.</p>
           <div class="lvls"><button data-want="" class="${want ? "" : "on"}">Claude picks<small>the level of the change</small></button>${LEVELS.map(([id, name, sub]) => `<button data-want="${id}" class="${want === id ? "on" : ""}">${name}<small>${sub}</small></button>`).join("")}</div>
           <button class="btn primary" data-draw>Draw the map</button>
           ${data?.error ? `<p class="merr">${esc(data.error)}</p>` : ""}`}</div>`;
    }

    /** The parts to draw in this mode: before has no added parts, after no removed ones. */
    function shown(m) {
      const keep = (st) => (mode === "before" ? st !== "added" : mode === "after" ? st !== "removed" : true);
      const nodes = m.nodes.filter((n) => keep(n.status)), ids = new Set(nodes.map((n) => n.id));
      const edges = m.edges.map((e, i) => ({ ...e, i })).filter((e) => keep(e.status) && ids.has(e.from) && ids.has(e.to));
      return { nodes, edges };
    }

    function diagram(m) {
      const { nodes, edges } = shown(m), change = m.changes[sel];
      const litNodes = new Set(change ? [...change.nodes, ...change.edges.flatMap((i) => [m.edges[i]?.from, m.edges[i]?.to])] : []);
      const litEdges = new Set(change?.edges ?? []);
      const dim = (lit) => (change && !lit ? " dim" : "");
      const badge = (st) => (mode === "changes" && st !== "same" ? `<span class="st">${st}</span>` : "");
      plane.innerHTML = nodes.map((n) => `<div class="mn kind-${esc(n.kind)} st-${n.status}${dim(litNodes.has(n.id))}" data-id="${esc(n.id)}"${n.ref ? ` data-ref="${esc(n.ref)}" title="Open its code"` : ""}>
          <div class="mk">${KIND[n.kind] ?? esc(n.kind)}${n.group ? `<span class="g">· ${esc(n.group)}</span>` : ""}${badge(n.status)}</div>
          <div class="ml">${esc(n.label)}</div>${n.note ? `<div class="mo">${esc(n.note)}</div>` : ""}</div>`).join("");
      const box = new Map([...plane.querySelectorAll(".mn")].map((d) => [d.dataset.id, d]));
      const h = (id) => box.get(id)?.offsetHeight ?? 60;
      const lay = layered(nodes.map((n) => n.id), edges.map((e) => [e.from, e.to]), { h, gap: 30, compGap: 56, wrap: 3 });
      const at = new Map(nodes.map((n) => [n.id, { x: lay.rank.get(n.id) * (W + COL), y: lay.y.get(n.id), h: h(n.id) }]));
      for (const [id, d] of box) { const p = at.get(id); d.style.left = `${p.x}px`; d.style.top = `${p.y}px`; }

      // Edges: forward ones from the right side to the left side; one that goes back (or within a column) loops under
      // both. Edges between the same two nodes fan out, so each label has its own place.
      const seen = new Map(), paths = [], labels = [];
      let bottom = Math.max(0, ...[...at.values()].map((p) => p.y + p.h));
      for (const e of edges) {
        const a = at.get(e.from), b = at.get(e.to), pair = [e.from, e.to].sort().join(" "), k = seen.get(pair) ?? 0;
        seen.set(pair, k + 1);
        const off = (k % 2 ? 1 : -1) * Math.ceil(k / 2) * 16;
        let d, mx, my;
        if (b.x > a.x) {
          const x1 = a.x + W, y1 = a.y + a.h / 2 + off, x2 = b.x, y2 = b.y + b.h / 2 + off, c = Math.max(40, Math.min(COL, (x2 - x1) / 2));
          d = `M${x1},${y1} C${x1 + c},${y1} ${x2 - c},${y2} ${x2},${y2}`;
          // the label goes in the gap after the source, where no node can be, on the curve there
          const bez = (t, p0, p1, p2, p3) => (1 - t) ** 3 * p0 + 3 * (1 - t) ** 2 * t * p1 + 3 * (1 - t) * t ** 2 * p2 + t ** 3 * p3;
          mx = x1 + COL / 2;
          let lo = 0, hi = 1;
          for (let i = 0; i < 24; i++) { const t = (lo + hi) / 2; if (bez(t, x1, x1 + c, x2 - c, x2) < mx) lo = t; else hi = t; }
          my = bez(lo, y1, y1, y2, y2);
        } else {
          const x1 = a.x + W / 2 + off, y1 = a.y + a.h, x2 = b.x + W / 2 + off, y2 = b.y + b.h, dip = Math.max(y1, y2) + 46 + Math.abs(off);
          d = `M${x1},${y1} C${x1},${dip} ${x2},${dip} ${x2},${y2}`;
          mx = (x1 + 3 * x1 + 3 * x2 + x2) / 8; my = (y1 + 3 * dip + 3 * dip + y2) / 8;
          bottom = Math.max(bottom, my + 20);
        }
        const cls = `st-${e.status}${dim(litEdges.has(e.i))}`;
        paths.push(`<path class="${cls}" d="${d}" marker-end="url(#mapArrow-${mode === "changes" ? e.status : "same"})"/>`);
        const was = mode === "changes" && e.status === "changed" && e.before ? `<s>${esc(e.before)}</s>` : "";
        const label = mode === "before" && e.status === "changed" && e.before ? e.before : e.label;
        if (label || was) labels.push(`<div class="el ${cls}" style="left:${mx}px;top:${my}px">${esc(label)}${was}</div>`);
      }
      const colour = { same: "var(--muted)", added: "var(--ok)", removed: "var(--risk)", changed: "var(--signal)" };
      const width = Math.max(W, ...[...at.values()].map((p) => p.x + W));
      plane.insertAdjacentHTML("afterbegin", `<svg width="${width}" height="${bottom}"><defs>${Object.entries(colour).map(([st, c]) =>
        `<marker id="mapArrow-${st}" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse"><path d="M0,1 L9,5 L0,9 z" style="fill:${c};stroke:none"/></marker>`).join("")}</defs>${paths.join("")}</svg>`);
      plane.insertAdjacentHTML("beforeend", labels.join(""));
      // labels that land on each other (several edges leaving one node) move apart, down the gap
      const placed = [];
      for (const lb of [...plane.querySelectorAll(".el")].sort((p, q) => parseFloat(p.style.top) - parseFloat(q.style.top))) {
        const w = lb.offsetWidth, hh = lb.offsetHeight, x = parseFloat(lb.style.left);
        let y = parseFloat(lb.style.top);
        for (let moved = true; moved;) {
          moved = false;
          for (const o of placed) { // overlapping by more than half a pixel: below it (always further down, so it ends)
            const below = o.y + (o.h + hh) / 2 + 3;
            if (Math.abs(o.x - x) < (o.w + w) / 2 && Math.abs(o.y - y) < (o.h + hh) / 2 + 2.5 && below > y + 0.5) { y = below; moved = true; }
          }
        }
        lb.style.top = `${y}px`;
        placed.push({ x, y, w, h: hh });
        bottom = Math.max(bottom, y + hh);
      }
      size = { w: width, h: bottom };
      const s = fit();
      if (change) { // bring the change's part of the diagram into view
        const lit = [...plane.querySelectorAll(".mn:not(.dim)")], stage = root.querySelector(".stage");
        if (lit.length && s) {
          const rs = lit.map((d) => d.getBoundingClientRect()), at = stage.getBoundingClientRect();
          const cx = (Math.min(...rs.map((r) => r.left)) + Math.max(...rs.map((r) => r.right))) / 2, cy = (Math.min(...rs.map((r) => r.top)) + Math.max(...rs.map((r) => r.bottom))) / 2;
          stage.scrollTo({ left: stage.scrollLeft + cx - at.left - stage.clientWidth / 2, top: stage.scrollTop + cy - at.top - stage.clientHeight / 2, behavior: "instant" });
        }
      }
    }

    /** Scales the diagram to the stage: smaller to fit, down to a readable size, then it scrolls; never bigger. */
    function fit() {
      if (!plane || !size) return;
      const stage = root.querySelector(".stage"), s = Math.max(0.8, Math.min(1, (stage.clientWidth - 56) / size.w, (stage.clientHeight - 56) / size.h));
      plane.style.width = `${size.w}px`; plane.style.height = `${size.h}px`;
      plane.style.transform = `scale(${s})`;
      fitEl.style.width = `${size.w * s}px`; fitEl.style.height = `${size.h * s}px`;
      stage.classList.toggle("pans", stage.scrollWidth > stage.clientWidth || stage.scrollHeight > stage.clientHeight);
      return s;
    }
    // a diagram bigger than the stage: drag its background to pan
    let pan = null;
    root.addEventListener("pointerdown", (ev) => {
      const stage = ev.target.closest(".stage.pans");
      if (!stage || ev.button || ev.target.closest(".mn[data-ref]")) return;
      pan = { stage, x: ev.clientX, y: ev.clientY, l: stage.scrollLeft, t: stage.scrollTop, id: ev.pointerId };
      stage.setPointerCapture(ev.pointerId);
      stage.classList.add("panning");
    });
    root.addEventListener("pointermove", (ev) => { if (pan?.id === ev.pointerId) { pan.stage.scrollLeft = pan.l - (ev.clientX - pan.x); pan.stage.scrollTop = pan.t - (ev.clientY - pan.y); } });
    const endPan = () => { pan?.stage.classList.remove("panning"); pan = null; };
    root.addEventListener("pointerup", endPan);
    root.addEventListener("pointercancel", endPan);

    const setMode = (to) => { if (to !== mode) { mode = to; render(); } };
    const pick = (i, toggle = true) => { sel = toggle && i === sel ? -1 : i; render(); };
    root.addEventListener("click", (ev) => {
      const t = ev.target;
      if (t.closest("a")) return; // a reference in a change: the viewer opens it (code.js)
      const b = t.closest("[data-mode],[data-want],[data-draw],[data-redraw],[data-cancel],[data-change],.mn[data-ref]");
      if (!b) return;
      if (b.dataset.mode) setMode(b.dataset.mode);
      else if (b.dataset.want !== undefined) { want = b.dataset.want; render(); }
      else if (b.hasAttribute("data-draw")) draw(want);
      else if (b.hasAttribute("data-redraw")) draw(want);
      else if (b.hasAttribute("data-cancel")) api("/api/map/cancel", {}).then(load);
      else if (b.dataset.change) pick(Number(b.dataset.change));
      else if (b.dataset.ref) { const r = parseRef(b.dataset.ref); if (r) openRef(app, r); }
    });
    root.addEventListener("change", (ev) => { if (ev.target.matches("[data-level]")) want = ev.target.value; });

    const step = (d) => { const n = data?.map?.changes.length ?? 0; if (n) pick(sel < 0 ? (d > 0 ? 0 : n - 1) : Math.max(0, Math.min(n - 1, sel + d)), false); };
    const turn = (d) => { const i = MODES.findIndex((x) => x[0] === mode) + d; if (MODES[i]) setMode(MODES[i][0]); };
    const keys = { // by action (keys.js)
      left: () => turn(-1), right: () => turn(1), up: () => step(-1), down: () => step(1),
      zoomOut: () => { if (sel >= 0) pick(sel); },
    };

    load();
    return {
      update(why) { if (why === "resize") fit(); else if (why === "settings" && data) render(); },
      keys,
      destroy() { dead = true; clearTimeout(timer); root.remove(); },
    };
  },
};
