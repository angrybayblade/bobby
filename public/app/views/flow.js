// Flow: left→right node-link canvas of pages. Each core is laid out as a graph (a page sits one column right of
// what leads into it; its band is a chip on the card), with degree-of-interest sizing (focus big, neighbours medium,
// rest small, long columns folded into "+N"), labelled edges, and a camera that glides between overview → core → page.
import { DONE, LOW, esc } from "../core.js";
import { layered } from "./layered.js";

const CSS = `
.flow { position: absolute; inset: 0; display: grid; grid-template-rows: 1fr; }
.flow .stage { position: relative; overflow: hidden; transition: height var(--dur) var(--ease); height: 100%; cursor: grab; }
.flow .world { position: absolute; left: 0; top: 0; transform-origin: 0 0; transition: transform var(--dur) var(--ease); }
.flow.dragging .world { transition: none; }
.flow.dragging { user-select: none; }
.flow svg.edges { position: absolute; left: 0; top: 0; overflow: visible; pointer-events: none; }
.flow svg path { fill: none; stroke: var(--line); stroke-width: 1.5; transition: d var(--dur) var(--ease), stroke var(--dur); }
.flow svg path.hot { stroke: var(--muted); stroke-width: 2; }
.flow svg path.dim { opacity: .35; }
.flow svg path.rep { stroke-dasharray: 4 4; }
.flow .card, .flow .lbl, .flow .chead, .flow .bhead { position: absolute; left: 0; top: 0; transition: transform var(--dur) var(--ease), width var(--dur) var(--ease), height var(--dur) var(--ease), opacity var(--dur); }
.flow .card { border-radius: 3px; background: var(--surface); border: 1px solid var(--line); padding: 8px 12px; overflow: hidden; cursor: pointer; display: flex; flex-direction: column; gap: 4px; }
.flow .card:hover { border-color: var(--muted); }
.flow .card .t { display: flex; align-items: center; gap: 8px; font: 500 13px/1.3 var(--font-code); white-space: nowrap; }
.flow .card .t span { overflow: hidden; text-overflow: ellipsis; flex: 1; }
.flow .card .w { font: 13px/1.45 var(--font-prose); color: var(--muted); display: -webkit-box; -webkit-line-clamp: 2; -webkit-box-orient: vertical; overflow: hidden; }
.flow .card .m { font: 11.5px var(--font-code); color: var(--faint); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; margin-top: auto; }
.flow .card.context { border-style: dashed; }
.flow .card.core { border-color: color-mix(in srgb, var(--signal) 45%, var(--line)); }
.flow .card.focus { border: 2px solid var(--signal); background: var(--surface); box-shadow: 0 0 0 6px var(--signal-soft), var(--shadow); padding: 12px 16px; z-index: 2; }
.flow .card.focus .t { font-size: 15px; font-weight: 600; }
.flow .card.focus .w { font-size: 14px; color: var(--text); -webkit-line-clamp: 4; }
.flow .card.withbody { cursor: default; z-index: 3; transition: transform var(--dur) var(--ease), opacity var(--dur); } /* no width/height easing: it is measured */
.flow .card.withbody .t { cursor: zoom-in; }
.flow .card.withbody .w { display: block; }
.flow .card .nbody { margin-top: 8px; max-height: 560px; overflow: auto; overscroll-behavior: contain; cursor: auto; }
.flow .card .nbody .code { margin-bottom: 10px; }
.flow .card .nbody .notes { margin-bottom: 10px; }
.flow .card.done { opacity: .5; }
.flow .card.done.focus { opacity: 1; }
.flow .card.rep { opacity: .45; border-style: dotted; }
.flow .card.other { opacity: .32; }
.flow .card.aside { opacity: .55; } /* in the current core, not the focus or its neighbours */
.flow .card.pinned { z-index: 6; border-radius: 0; border-width: 0; box-shadow: none; padding: 10px 14px; } /* f: fills the canvas */
.flow .card.pinned > * { zoom: var(--fill, 1); }
.flow .card.pinned .nbody { max-height: none; flex: 1; min-height: 0; }
.flow .card.agg { background: none; border-style: dashed; color: var(--muted); font-size: 13px; justify-content: center; }
.flow .lbl { font: 11.5px var(--font-ui); color: var(--muted); background: var(--bg); padding: 1px 6px; border-radius: 1px; white-space: nowrap; transform-origin: 50% 50%; }
.flow .chead { font-size: 14px; font-weight: 600; white-space: nowrap; cursor: pointer; display: flex; gap: 10px; align-items: baseline; max-width: 1400px; }
.flow .chead small { font-weight: 400; color: var(--muted); overflow: hidden; text-overflow: ellipsis; }
.flow .chead.other { opacity: .45; }
.flow .card .t .bandc { font: 500 9.5px var(--font-ui); letter-spacing: .06em; text-transform: uppercase; color: var(--faint); white-space: nowrap; padding: 0 5px; border: 1px solid var(--line-soft); border-radius: 1px; flex: none; }
.flow .card.core .t .bandc { color: var(--text); border-color: var(--muted); }
.flow .pane { overflow: auto; border-top: 1px solid var(--line); background: var(--bg); }
.flow.paged { grid-template-rows: var(--rail, 220px) 1fr; }
.flow.paged .stage { cursor: default; }
.flow .intent { position: absolute; left: 32px; top: 20px; right: 32px; max-width: 80ch; z-index: 3; font: 600 calc(var(--size) * 1.35)/1.35 var(--font-prose); pointer-events: none; transition: opacity var(--dur); }
.flow .intent small { display: block; font: 12px var(--font-ui); letter-spacing: .08em; text-transform: uppercase; color: var(--faint); margin-bottom: 6px; }
`;

const GUTTER = 90, PAD = 40, GAP_Y = 12, CORE_GAP = 80, HEAD = 40, MAX_COL = 5;
const SIZES = { focus: [290, 172], near: [250, 100], far: [230, 38], agg: [230, 34] };
const BODY_W = 720; // focused card when it shows its code (core level only)
const BAND_CHIP = { upUnchanged: "relies on · untouched", upChanged: "relies on · changed", core: "core", downChanged: "affects · changed", downUnchanged: "affects · untouched" };

export default {
  id: "flow",
  name: "Flow",
  hint: "Node-link canvas: relies on ← core → affects",
  mount(el, app) {
    injectCss("flow", CSS);
    el.innerHTML = `<div class="flow"><div class="stage"><div class="intent"></div><div class="world"><svg class="edges"></svg></div></div><div class="pane" hidden></div></div>`;
    const root = el.firstElementChild, stage = root.querySelector(".stage"), world = root.querySelector(".world"), svg = root.querySelector("svg"), pane = root.querySelector(".pane");
    const intentEl = root.querySelector(".intent");
    const els = new Map(); // key → element (reused so moves animate)
    const expanded = new Set(); // "coreId:band" opened by the user
    let lastPagePid = null;
    // The camera: auto-framed for the focus and level, until you pan or zoom; then yours until the focus or level moves.
    let view = { tx: 0, ty: 0, s: 1 }, mine = false, lastL = null;
    const apply = () => { world.style.transform = `translate(${view.tx}px, ${view.ty}px) scale(${view.s})`; };
    let bodyH = 420; // last measured height of the focused card with its code
    const withBody = () => (app.level === 1 && app.get(app.focus) ? app.focus : null);

    function layout() {
      const focusLoc = app.get(app.focus);
      const body = withBody();
      const items = [], heads = [], labels = [];
      let y = 0, width = 0;
      const lowY = () => y;
      app.graph.cores.forEach((c) => {
        const current = focusLoc?.core === c && app.level > 0;
        const nb = current ? app.neighbours(app.focus) : { up: [], down: [] };
        const near = new Set([...nb.up.map((e) => e.from), ...nb.down.map((e) => e.to)]);
        const pls = app.corePlacements(c), ids = pls.map((pl) => pl.id), byId = new Map(pls.map((pl) => [pl.id, pl]));
        const es = app.edgesOf(c.id).map((e) => [e.from, e.to]);
        const sizeOf = (pl) => (!current ? "far" : pl.id === app.focus ? "focus" : near.has(pl.id) ? "near" : "far");
        const dims = (pl) => (sizeOf(pl) === "focus" && body ? [BODY_W, bodyH] : SIZES[sizeOf(pl)]);
        // Fold long columns into "+N": rank everything once, then keep the focus, its neighbours and the first few.
        const ranks = layered(ids, es, { h: () => 40, gap: GAP_Y, compGap: GAP_Y }).rank;
        const cols = new Map();
        for (const id of ids) (cols.get(ranks.get(id)) ?? cols.set(ranks.get(id), []).get(ranks.get(id))).push(id);
        const foldTo = new Map(), aggs = new Map();
        for (const [r, list] of cols) {
          const key = `${c.id}:r${r}`;
          if (list.length <= MAX_COL + 1 || expanded.has(key)) continue;
          const keep = (id) => !current || id === app.focus || near.has(id);
          const must = list.filter(keep), rest = list.filter((id) => !keep(id));
          const shown = new Set([...must, ...rest.slice(0, Math.max(0, MAX_COL - must.length))]);
          const folded = list.filter((id) => !shown.has(id));
          if (!folded.length) continue;
          const agg = `agg:${key}`;
          aggs.set(agg, { key, n: folded.length });
          for (const id of folded) foldTo.set(id, agg);
        }
        const vis = [...ids.filter((id) => !foldTo.has(id)), ...aggs.keys()];
        const ves = [...new Set(es.map(([a, b]) => `${foldTo.get(a) ?? a}\n${foldTo.get(b) ?? b}`))].map((k) => k.split("\n")).filter(([a, b]) => a !== b);
        const hOf = (id) => (aggs.has(id) ? SIZES.agg[1] : dims(byId.get(id))[1]);
        const L = layered(vis, ves, { h: hOf, gap: GAP_Y, compGap: GAP_Y * 4 });
        // Columns as wide as their widest card.
        const wOf = (id) => (aggs.has(id) ? SIZES.agg[0] : dims(byId.get(id))[0]);
        const colW = [];
        for (const id of vis) { const r = L.rank.get(id); colW[r] = Math.max(colW[r] ?? 0, wOf(id)); }
        const colX = []; let acc = 0;
        for (let r = 0; r < colW.length; r++) { colX[r] = acc; acc += (colW[r] ?? 0) + GUTTER; }
        heads.push({ c, x: 0, y, current });
        const top = y + HEAD;
        let bottom = top;
        for (const id of vis) {
          const r = L.rank.get(id), w = wOf(id), h = hOf(id), x = colX[r] + ((colW[r] ?? w) - w) / 2, cy = top + L.y.get(id);
          bottom = Math.max(bottom, cy + h);
          if (aggs.has(id)) { const a = aggs.get(id); items.push({ kind: "agg", key: a.key, n: a.n, size: "agg", w, h, x, y: cy, current }); continue; }
          const pl = byId.get(id), size = sizeOf(pl);
          items.push({ kind: "pl", pl, size, body: size === "focus" && !!body, w, h, x, y: cy, current, foldTo });
        }
        width = Math.max(width, acc);
        c._box = { x: -20, y, w: Math.max(acc, 400), h: bottom - y + 10 };
        c._foldTo = foldTo;
        y = bottom + CORE_GAP;
      });
      if (app.graph.lowSignal.length) {
        const sel = app.focus === LOW;
        items.push({ kind: "low", size: sel ? "near" : "far", w: 260, h: 38, x: 0, y: lowY(), current: sel });
        y += 38 + CORE_GAP;
      }
      // Edges between visible cards (folded endpoints route to the "+N" card).
      const pos = new Map(items.filter((i) => i.kind === "pl").map((i) => [i.pl.id, i]));
      const aggOf = (pid) => { const loc = app.get(pid); const a = loc && loc.core._foldTo?.get(pid); return a && items.find((i) => i.kind === "agg" && `agg:${i.key}` === a); };
      const edges = [], said = new Set();
      for (const e of app.graph.edges) {
        const a = pos.get(e.from) ?? aggOf(e.from), b = pos.get(e.to) ?? aggOf(e.to);
        if (!a || !b) continue;
        const hot = app.level > 0 && (e.from === app.focus || e.to === app.focus);
        edges.push({ e, a, b, hot, dim: !a.current, rep: !!(app.get(e.from).pl.repeatOf || app.get(e.to).pl.repeatOf) });
        if (hot && e.label && !said.has(e.label) && said.add(e.label)) labels.push({ key: `${e.from}>${e.to}`, text: e.label, x: (a.x + a.w + b.x) / 2, y: (a.y + a.h / 2 + b.y + b.h / 2) / 2 });
      }
      return { items, heads, edges, labels, height: y, width };
    }

    function card(it) {
      if (it.kind === "agg") return { cls: "agg", html: `+${it.n} more`, data: { expand: it.key } };
      if (it.kind === "low") return { cls: `${it.current ? "focus" : ""} ${app.isReviewed(LOW) ? "done" : ""}`, html: `<div class="t"><i class="glyph context"></i><span>Low-signal changes</span>${app.isReviewed(LOW) ? "✓" : ""}</div>`, data: { go: LOW } };
      const { pl, size, current } = it;
      const node = app.nodeOf(pl.id);
      const done = app.isReviewed(pl.id), flag = app.isFlagged(pl.id);
      const glyph = pl.band === "core" ? "core" : node.kind;
      const status = `${pl.risk === "high" ? `<i class="riskdot" title="high risk"></i>` : ""}${flag ? `<span class="status flag">⚑</span>` : ""}${done ? `<span class="status">✓</span>` : ""}${pl.repeatOf ? `<span class="status">↺</span>` : ""}`;
      let meta = "";
      if (size === "focus" || size === "near") {
        if (node.kind === "context") meta = `${node.location.path}:${node.location.line}`;
        else { const { a, d } = app.stat(pl.id); meta = `${node.file} · +${a} −${d}`; }
      }
      const chip = size === "focus" || size === "near" ? `<span class="bandc">${BAND_CHIP[pl.band]}</span>` : "";
      const html = `<div class="t"><i class="glyph ${glyph}"></i><span>${esc(pl.title)}</span>${status}${chip}</div>`
        + (size === "focus" || size === "near" ? `<div class="w">${esc(pl.why)}</div>${it.body ? "" : `<div class="m">${esc(meta)}</div>`}` : "")
        + (it.body ? `<div class="nbody"></div>` : "");
      const cls = [it.body ? "withbody" : "", node.kind, pl.band === "core" ? "core" : "", size === "focus" ? "focus" : "", done ? "done" : "", pl.repeatOf ? "rep" : "", !current && app.level > 0 ? "other" : "", current && size === "far" && app.level === 1 ? "aside" : ""].join(" ");
      return { cls, html, data: { go: pl.id }, title: `${BAND_CHIP[pl.band]} · ${pl.why}` };
    }

    function place(key, cls, html, x, y, w, h, data = {}, title = "") {
      let n = els.get(key);
      if (!n) { n = document.createElement("div"); world.appendChild(n); els.set(key, n); }
      n.className = cls;
      if (n._html !== html) { n.innerHTML = html; n._html = html; }
      n.style.transform = `translate(${x}px, ${y}px)`;
      if (w != null) { n.style.width = `${w}px`; n.style.height = h == null ? "auto" : `${h}px`; }
      for (const k of Object.keys(n.dataset)) delete n.dataset[k];
      Object.assign(n.dataset, data);
      n.title = title;
      n._seen = true;
    }

    function camera(L) {
      const sw = stage.clientWidth, sh = stage.clientHeight;
      let box, maxScale = 1, minScale = 0.4;
      const focusItem = L.items.find((i) => i.kind === "pl" && i.pl.id === app.focus) ?? L.items.find((i) => i.kind === "low" && app.focus === LOW);
      const loc = app.get(app.focus);
      const top = app.level === 0 ? intentEl.offsetHeight + 30 : 0;
      if (app.level === 0 || !loc) box = { x: -20, y: -10, w: L.width, h: L.height };
      else if (app.level === 1 && !withBody()) box = loc.core._box;
      else {
        // Page mode (a rail above the code), or a code-bearing focus card: frame the focus and its neighbours.
        const nb = app.neighbours(app.focus);
        const ids = new Set([app.focus, ...nb.up.map((e) => e.from), ...nb.down.map((e) => e.to)]);
        const its = L.items.filter((i) => i.kind === "pl" && ids.has(i.pl.id));
        const xs = its.flatMap((i) => [i.x, i.x + i.w]), ys = its.flatMap((i) => [i.y, i.y + i.h]);
        box = its.length ? { x: Math.min(...xs) - 20, y: Math.min(...ys) - 16, w: Math.max(...xs) - Math.min(...xs) + 40, h: Math.max(...ys) - Math.min(...ys) + 32 } : loc.core._box;
        if (app.level === 2) { maxScale = 0.9; minScale = 0.3; } else { maxScale = 1; minScale = 0.6; }
      }
      let s = Math.min(maxScale, (sw - PAD * 2) / box.w, (sh - PAD * 2) / box.h);
      s = Math.max(minScale, s);
      if (top) s = Math.max(minScale, Math.min(s, (sh - top - PAD) / box.h));
      let tx = sw / 2 - (box.x + box.w / 2) * s, ty = top + (sh - top) / 2 - (box.y + box.h / 2) * s;
      if (app.level === 1 && focusItem?.body) {
        if (box.w * s > sw - PAD * 2) tx = sw / 2 - (focusItem.x + focusItem.w / 2) * s; // too wide: the code wins the centre
        if (box.h * s > sh - PAD * 2) ty = PAD - focusItem.y * s;
      }
      if (app.level === 0 && box.h * s > sh - top - PAD) {
        ty = top - box.y * s; // too tall to fit: start under the intent, keep the current core in view
        const cur = loc?.core._box ?? (focusItem && { y: focusItem.y, h: focusItem.h });
        if (cur) ty = Math.min(ty, sh * 0.45 - (cur.y + cur.h / 2) * s);
      }
      if (filled) return fillCam();
      if (!mine) { view = { tx, ty, s }; apply(); }
    }

    // Leaving the canvas for a page (g, enter) keeps the camera; coming back restores it.
    let lastLevel = app.level, beforePage = null;
    function update(reason) {
      if (reason === "level") {
        if (app.level === 2 && lastLevel < 2) beforePage = { view: { ...view }, mine };
        const back = app.level === 1 && lastLevel === 2 && beforePage;
        if (back) { view = beforePage.view; mine = true; } else mine = false; // back from a page: as you left it; else reframe
        if (app.level !== 2) beforePage = null;
        lastLevel = app.level;
      }
      if (reason === "focus" || reason === "graph") mine = false;
      const paged = app.level === 2;
      root.classList.toggle("paged", paged);
      pane.hidden = !paged;
      let L = layout();

      intentEl.innerHTML = `<small>What this PR does</small>${esc(app.graph.intent)}`;
      intentEl.style.opacity = app.level === 0 ? 1 : 0;

      placeAll(L);
      // The code-bearing card sizes itself; re-lay out around its real height in the same frame.
      const body = L.items.find((i) => i.body);
      if (body) {
        const n = els.get(body.pl.id);
        if (reason !== "measure") app.renderNode(n.querySelector(".nbody"), app.focus);
        if (filled) observe(null); else observe(n);
        if (!filled && Math.abs(n.offsetHeight - bodyH) > 2) { bodyH = n.offsetHeight; L = layout(); placeAll(L); }
      } else observe(null);

      svg.setAttribute("width", L.width); svg.setAttribute("height", L.height);
      svg.innerHTML = L.edges.map(({ a, b, hot, dim, rep }) => {
        const x1 = a.x + a.w, y1 = a.y + a.h / 2, x2 = b.x, y2 = b.y + b.h / 2, mx = (x1 + x2) / 2;
        return `<path class="${hot ? "hot" : ""} ${dim && !hot ? "dim" : ""} ${rep ? "rep" : ""}" d="M${x1},${y1} C${mx},${y1} ${mx},${y2} ${x2},${y2}"/>`;
      }).join("");

      // Labels sit centred on their point; measure after insertion.
      for (const l of L.labels) { const n = els.get(`lbl:${l.key}`); n.style.transform = `translate(${l.x - n.offsetWidth / 2}px, ${l.y - 11}px)`; }

      lastL = L;
      if (filled && (app.level !== 1 || !L.items.some((i) => i.body))) unfill(false); // f only holds on the canvas, with code showing
      requestAnimationFrame(() => (mine && !filled ? apply() : camera(L)));
      if (paged && (reason !== "marks" || lastPagePid !== app.focus)) {
        const fresh = lastPagePid !== app.focus;
        app.renderPage(pane, app.focus);
        if (fresh) pane.scrollTop = 0;
        lastPagePid = app.focus;
      } else if (paged && reason === "marks") app.renderPage(pane, app.focus);
      if (!paged) lastPagePid = null;
    }

    // Composer, folding and context expansion change the card's height without an app event.
    let watched = null;
    const ro = new ResizeObserver(() => { if (watched && Math.abs(watched.offsetHeight - bodyH) > 2) update("measure"); });
    function observe(n) {
      if (n === watched) return;
      if (watched) ro.unobserve(watched);
      watched = n;
      if (n) ro.observe(n);
    }

    function placeAll(L) {
      for (const n of els.values()) n._seen = false;
      for (const h of L.heads) {
        const items = app.index.walk.filter((p) => app.get(p)?.core === h.c);
        const done = items.filter((p) => app.isReviewed(p)).length;
        place(`ch:${h.c.id}`, `chead ${app.level > 0 && !h.current ? "other" : ""}`, `${app.graph.cores.indexOf(h.c) + 1} · ${esc(h.c.title)} <small>${done}/${items.length}${h.current || app.level === 0 ? ` · ${esc(h.c.summary)}` : ""}</small>`, h.x, h.y, null, null, { core: h.c.id });
      }
      for (const it of L.items) {
        const c = card(it);
        const key = it.kind === "pl" ? it.pl.id : it.kind === "agg" ? `agg:${it.key}` : "low";
        const pin = filled?.h && it.body; // the filled card keeps its size through updates
        place(key, `card ${c.cls}${pin ? " pinned" : ""}`, c.html, it.x, it.y, it.w, pin ? filled.h : it.body ? null : it.h, c.data, c.title);
      }
      for (const l of L.labels) place(`lbl:${l.key}`, "lbl", esc(l.text), l.x - 40, l.y - 11, null, null);
      for (const [k, n] of els) if (!n._seen) { n.remove(); els.delete(k); }
    }

    // ---- interaction
    world.addEventListener("click", (ev) => {
      if (moved || ev.target.closest(".nbody")) return;
      const t = ev.target.closest("[data-go],[data-expand],[data-core]");
      if (!t) return;
      if (t.dataset.expand) { expanded.add(t.dataset.expand); return update("expand"); }
      if (t.dataset.core) { const first = app.index.walk.find((p) => app.get(p)?.core.id === t.dataset.core); app.setFocus(first, { level: 1 }); return; }
      const go = t.dataset.go;
      if (go === app.canonical(go) && go === app.focus) app.setLevel(app.level + 1);
      else app.setFocus(go, { level: app.level === 0 ? 1 : app.level });
    });
    let drag = null, moved = false;
    stage.addEventListener("pointerdown", (ev) => {
      if (app.level === 2 || ev.target.closest(".nbody")) return; // code in a card stays selectable
      if (ev.pointerType === "mouse") ev.preventDefault(); // a press-and-drag pans; it must not start a text selection
      drag = { x: ev.clientX, y: ev.clientY, v: { ...view } }; moved = false;
    });
    window.addEventListener("pointermove", (ev) => {
      if (!drag) return;
      const dx = ev.clientX - drag.x, dy = ev.clientY - drag.y;
      if (!moved && Math.hypot(dx, dy) < 4) return;
      moved = true; root.classList.add("dragging");
      if (filled) unfill(false);
      view = { ...drag.v, tx: drag.v.tx + dx, ty: drag.v.ty + dy }; mine = true;
      requestAnimationFrame(apply);
    });
    window.addEventListener("pointerup", () => { drag = null; root.classList.remove("dragging"); setTimeout(() => (moved = false)); });
    stage.addEventListener("wheel", (ev) => {
      if (app.level === 2) return;
      const r = stage.getBoundingClientRect();
      if (ev.ctrlKey) { // pinch, or ctrl+scroll: zoom around the pointer
        ev.preventDefault(); if (filled) unfill(false);
        const k = Math.exp(-ev.deltaY * 0.01), s = Math.max(0.15, Math.min(Math.max(2, view.s), view.s * k)), px = ev.clientX - r.left, py = ev.clientY - r.top;
        view = { s, tx: px - ((px - view.tx) / view.s) * s, ty: py - ((py - view.ty) / view.s) * s }; mine = true;
        root.classList.add("dragging"); apply();
        clearTimeout(stage._w); stage._w = setTimeout(() => root.classList.remove("dragging"), 120);
        return;
      }
      if (filled) { ev.preventDefault(); els.get(app.focus)?.querySelector(".nbody")?.scrollBy(ev.deltaX / view.s, ev.deltaY / view.s); return; } // filled: the canvas is this card
      if (ev.target.closest(".nbody")) return; // let the code scroll
      ev.preventDefault();
      view = { ...view, tx: view.tx - ev.deltaX, ty: view.ty - ev.deltaY }; mine = true;
      root.classList.add("dragging");
      apply();
      clearTimeout(stage._w); stage._w = setTimeout(() => root.classList.remove("dragging"), 120);
    }, { passive: false });

    // ---- f: the focused card, with its code, fills the canvas. Its contents are scaled back down to a reading size.
    const FILL_ZOOM = 1.1;
    let filled = null; // { prev view, prev mine }
    function fillCam() {
      const n = els.get(app.focus), it = lastL?.items.find((i) => i.kind === "pl" && i.pl.id === app.focus);
      if (!n || !it) return;
      const sw = stage.clientWidth, sh = stage.clientHeight, s = sw / it.w;
      observe(null); // its size is ours while filled
      n.classList.add("pinned");
      filled.h = sh / s;
      n.style.height = `${filled.h}px`;
      n.style.setProperty("--fill", Math.min(1, FILL_ZOOM / s));
      view = { s, tx: -it.x * s, ty: -it.y * s }; apply();
    }
    function fill() {
      if (filled) return unfill(true);
      if (app.level !== 1 || !lastL?.items.some((i) => i.body)) { app.setLevel(1); return setTimeout(fill, 60); }
      filled = { view: { ...view }, mine };
      fillCam();
    }
    function unfill(restore) {
      const was = filled; filled = null;
      for (const n of world.querySelectorAll(".card.pinned")) { n.classList.remove("pinned"); n.style.removeProperty("--fill"); }
      if (restore && was) { view = was.view; mine = was.mine; apply(); }
      update("measure"); // its own height again
    }

    // ---- arrows follow edges: → to what this leads into, ← to what leads into it, ↑/↓ within its column
    function move(dc, dr) {
      const its = (lastL?.items ?? []).filter((i) => i.kind === "pl");
      const at = its.find((i) => i.pl.id === app.focus);
      if (!at) return;
      const cx = (i) => i.x + i.w / 2, cy = (i) => i.y + i.h / 2;
      const dist = (i) => Math.abs(cx(i) - cx(at)) + Math.abs(cy(i) - cy(at)) * 2;
      let to;
      if (dr) {
        const col = its.filter((i) => Math.abs(cx(i) - cx(at)) < 2).sort((a, b) => a.y - b.y);
        to = col[col.indexOf(at) + dr];
      } else {
        const nb = app.neighbours(app.focus), ids = new Set((dc > 0 ? nb.down.map((e) => e.to) : nb.up.map((e) => e.from)));
        const linked = its.filter((i) => ids.has(i.pl.id));
        const beside = its.filter((i) => (dc > 0 ? cx(i) > cx(at) + 2 : cx(i) < cx(at) - 2) && i.current === at.current);
        to = [...(linked.length ? linked : beside)].sort((a, b) => dist(a) - dist(b))[0];
      }
      if (to) app.setFocus(to.pl.id);
    }
    const keys = {
      ArrowLeft: () => move(-1, 0), ArrowRight: () => move(1, 0), ArrowUp: () => move(0, -1), ArrowDown: () => move(0, 1),
      f: () => fill(),
      g: () => app.setLevel(app.level === 2 ? 1 : 2),
      Escape: () => (filled ? unfill(true) : app.setLevel(app.level - 1)),
    };

    update("mount");
    return { update, keys, destroy() { ro.disconnect(); } };
  },
};

export function injectCss(id, css) {
  if (document.getElementById(`css-${id}`)) return;
  const s = document.createElement("style");
  s.id = `css-${id}`;
  s.textContent = css;
  document.head.appendChild(s);
}
