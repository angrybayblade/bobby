// Flow: left→right node-link canvas. Degree-of-interest sizing (focus big, neighbours medium, rest small,
// long bands folded into "+N"), labelled edges, and a camera that glides between overview → core → page.
import { BANDS, DONE, LOW, esc } from "../core.js";

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
.flow .card { border-radius: 10px; background: var(--surface); border: 1px solid var(--line); padding: 8px 12px; overflow: hidden; cursor: pointer; display: flex; flex-direction: column; gap: 4px; }
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
.flow .card.agg { background: none; border-style: dashed; color: var(--muted); font-size: 13px; justify-content: center; }
.flow .lbl { font: 11.5px var(--font-ui); color: var(--muted); background: var(--bg); padding: 1px 6px; border-radius: 6px; white-space: nowrap; transform-origin: 50% 50%; }
.flow .chead { font-size: 14px; font-weight: 600; white-space: nowrap; cursor: pointer; display: flex; gap: 10px; align-items: baseline; max-width: ${5 * 320 - 60}px; }
.flow .chead small { font-weight: 400; color: var(--muted); overflow: hidden; text-overflow: ellipsis; }
.flow .chead.other { opacity: .45; }
.flow .bhead { font-size: 11px; letter-spacing: .08em; text-transform: uppercase; color: var(--faint); white-space: nowrap; }
.flow .pane { overflow: auto; border-top: 1px solid var(--line); background: var(--bg); }
.flow.paged { grid-template-rows: var(--rail, 220px) 1fr; }
.flow.paged .stage { cursor: default; }
.flow .intent { position: absolute; left: 32px; top: 20px; right: 32px; max-width: 80ch; z-index: 3; font: 600 calc(var(--size) * 1.35)/1.35 var(--font-prose); pointer-events: none; transition: opacity var(--dur); }
.flow .intent small { display: block; font: 12px var(--font-ui); letter-spacing: .08em; text-transform: uppercase; color: var(--faint); margin-bottom: 6px; }
`;

const PITCH = 320, PAD = 40, GAP_Y = 12, CORE_GAP = 80, HEAD = 46, MAX_BAND = 4;
const SIZES = { focus: [290, 172], near: [250, 100], far: [230, 38], agg: [230, 34] };
const BODY_W = 720; // focused card when it shows its code (core level only)
const BAND_HEAD = { upUnchanged: "relies on · untouched", upChanged: "relies on · changed", core: "core change", downChanged: "affects · changed", downUnchanged: "affects · untouched" };

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
    let pan = { x: 0, y: 0 }, lastPagePid = null;
    let bodyH = 420; // last measured height of the focused card with its code
    const withBody = () => (app.level === 1 && app.get(app.focus) ? app.focus : null);

    function layout() {
      const focusLoc = app.get(app.focus);
      const body = withBody();
      const items = [], heads = [], labels = [];
      let y = 0, width = 5 * PITCH;
      const lowY = () => y;
      app.graph.cores.forEach((c) => {
        const current = focusLoc?.core === c && app.level > 0;
        const nb = current ? app.neighbours(app.focus) : { up: [], down: [] };
        const near = new Set([...nb.up.map((e) => e.from), ...nb.down.map((e) => e.to)]);
        // The column holding a code-bearing focus card widens; the others keep their pitch.
        const colW = BANDS.map((b) => (current && body && focusLoc.pl.band === b ? BODY_W + 70 : PITCH));
        const colX = colW.map((_, i) => colW.slice(0, i).reduce((a, w) => a + w, 0));
        const cols = BANDS.map((b) => {
          const list = c.bands[b];
          const keep = (pl) => !current || pl.id === app.focus || near.has(pl.id);
          let shown = list, folded = 0;
          if (list.length > MAX_BAND + 1 && !expanded.has(`${c.id}:${b}`)) {
            const must = list.filter(keep);
            const rest = list.filter((pl) => !keep(pl));
            shown = [...must, ...rest.slice(0, Math.max(0, MAX_BAND - must.length))];
            shown.sort((a, b2) => list.indexOf(a) - list.indexOf(b2));
            folded = list.length - shown.length;
          }
          const cards = shown.map((pl) => {
            const size = !current ? "far" : pl.id === app.focus ? "focus" : near.has(pl.id) ? "near" : "far";
            if (size === "focus" && body) return { kind: "pl", pl, size, body: true, w: BODY_W, h: bodyH, current };
            return { kind: "pl", pl, size, w: SIZES[size][0], h: SIZES[size][1], current };
          });
          if (folded) cards.push({ kind: "agg", key: `${c.id}:${b}`, n: folded, size: "agg", w: SIZES.agg[0], h: SIZES.agg[1], current });
          return cards;
        });
        const colH = cols.map((cs) => cs.reduce((s, x) => s + x.h, 0) + Math.max(0, cs.length - 1) * GAP_Y);
        const colsH = Math.max(...colH, 40);
        heads.push({ c, x: 0, y, current });
        if (current) BANDS.forEach((b, i) => heads.push({ band: b, x: colX[i], y: y + 26, current: true }));
        const top = y + HEAD + (current ? 18 : 0);
        cols.forEach((cs, i) => {
          let cy = top + (colsH - colH[i]) / 2;
          for (const it of cs) {
            it.x = colX[i] + (colW[i] - 50 - it.w) / 2 + (i === 2 ? 0 : i < 2 ? 20 : -20);
            it.y = cy;
            cy += it.h + GAP_Y;
            items.push(it);
          }
        });
        const coreW = colW.reduce((a, w) => a + w, 0);
        width = Math.max(width, coreW);
        c._box = { x: -20, y, w: coreW, h: colsH + HEAD + (current ? 18 : 0) + 10 };
        y = top + colsH + CORE_GAP;
      });
      if (app.graph.lowSignal.length) {
        const sel = app.focus === LOW;
        items.push({ kind: "low", size: sel ? "near" : "far", w: 260, h: 38, x: 2 * PITCH - 10, y: lowY(), current: sel });
        y += 38 + CORE_GAP;
      }
      // Edges between visible cards (folded endpoints route to the "+N" card).
      const pos = new Map(items.filter((i) => i.kind === "pl").map((i) => [i.pl.id, i]));
      const aggOf = (pid) => { const loc = app.get(pid); return items.find((i) => i.kind === "agg" && i.key === `${loc.core.id}:${loc.pl.band}`); };
      const edges = [];
      for (const e of app.graph.edges) {
        const a = pos.get(e.from) ?? aggOf(e.from), b = pos.get(e.to) ?? aggOf(e.to);
        if (!a || !b) continue;
        const hot = app.level > 0 && (e.from === app.focus || e.to === app.focus);
        edges.push({ e, a, b, hot, dim: !a.current, rep: !!(app.get(e.from).pl.repeatOf || app.get(e.to).pl.repeatOf) });
        if (hot && e.label) labels.push({ key: `${e.from}>${e.to}`, text: e.label, x: (a.x + a.w + b.x) / 2, y: (a.y + a.h / 2 + b.y + b.h / 2) / 2 });
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
      const html = `<div class="t"><i class="glyph ${glyph}"></i><span>${esc(pl.title)}</span>${status}</div>`
        + (size === "focus" || size === "near" ? `<div class="w">${esc(pl.why)}</div>${it.body ? "" : `<div class="m">${esc(meta)}</div>`}` : "")
        + (it.body ? `<div class="nbody"></div>` : "");
      const cls = [it.body ? "withbody" : "", node.kind, pl.band === "core" ? "core" : "", size === "focus" ? "focus" : "", done ? "done" : "", pl.repeatOf ? "rep" : "", !current && app.level > 0 ? "other" : ""].join(" ");
      return { cls, html, data: { go: pl.id }, title: pl.why };
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
      world.style.transform = `translate(${tx + pan.x}px, ${ty + pan.y}px) scale(${s})`;
    }

    function update(reason) {
      if (reason === "focus" || reason === "level" || reason === "graph") pan = { x: 0, y: 0 };
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
        observe(n);
        if (Math.abs(n.offsetHeight - bodyH) > 2) { bodyH = n.offsetHeight; L = layout(); placeAll(L); }
      } else observe(null);

      svg.setAttribute("width", L.width); svg.setAttribute("height", L.height);
      svg.innerHTML = L.edges.map(({ a, b, hot, dim, rep }) => {
        const x1 = a.x + a.w, y1 = a.y + a.h / 2, x2 = b.x, y2 = b.y + b.h / 2, mx = (x1 + x2) / 2;
        return `<path class="${hot ? "hot" : ""} ${dim && !hot ? "dim" : ""} ${rep ? "rep" : ""}" d="M${x1},${y1} C${mx},${y1} ${mx},${y2} ${x2},${y2}"/>`;
      }).join("");

      // Labels sit centred on their point; measure after insertion.
      for (const l of L.labels) { const n = els.get(`lbl:${l.key}`); n.style.transform = `translate(${l.x - n.offsetWidth / 2}px, ${l.y - 11}px)`; }

      requestAnimationFrame(() => camera(L));
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
        if (h.band) { place(`bh:${h.band}`, "bhead", BAND_HEAD[h.band], h.x + 20, h.y, null, null); continue; }
        const items = app.index.walk.filter((p) => app.get(p)?.core === h.c);
        const done = items.filter((p) => app.isReviewed(p)).length;
        place(`ch:${h.c.id}`, `chead ${app.level > 0 && !h.current ? "other" : ""}`, `${app.graph.cores.indexOf(h.c) + 1} · ${esc(h.c.title)} <small>${done}/${items.length}${h.current || app.level === 0 ? ` · ${esc(h.c.summary)}` : ""}</small>`, h.x, h.y, null, null, { core: h.c.id });
      }
      for (const it of L.items) {
        const c = card(it);
        const key = it.kind === "pl" ? it.pl.id : it.kind === "agg" ? `agg:${it.key}` : "low";
        place(key, `card ${c.cls}`, c.html, it.x, it.y, it.w, it.body ? null : it.h, c.data, c.title);
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
      drag = { x: ev.clientX, y: ev.clientY, p: { ...pan } }; moved = false;
    });
    window.addEventListener("pointermove", (ev) => {
      if (!drag) return;
      const dx = ev.clientX - drag.x, dy = ev.clientY - drag.y;
      if (!moved && Math.hypot(dx, dy) < 4) return;
      moved = true; root.classList.add("dragging");
      pan = { x: drag.p.x + dx, y: drag.p.y + dy };
      requestAnimationFrame(() => camera(layout()));
    });
    window.addEventListener("pointerup", () => { drag = null; root.classList.remove("dragging"); setTimeout(() => (moved = false)); });
    stage.addEventListener("wheel", (ev) => {
      if (app.level === 2 || ev.target.closest(".nbody")) return; // let the code scroll
      ev.preventDefault();
      pan = { x: pan.x - ev.deltaX, y: pan.y - ev.deltaY };
      root.classList.add("dragging");
      camera(layout());
      clearTimeout(stage._w); stage._w = setTimeout(() => root.classList.remove("dragging"), 120);
    }, { passive: false });

    update("mount");
    return { update, destroy() { ro.disconnect(); } };
  },
};

export function injectCss(id, css) {
  if (document.getElementById(`css-${id}`)) return;
  const s = document.createElement("style");
  s.id = `css-${id}`;
  s.textContent = css;
  document.head.appendChild(s);
}
