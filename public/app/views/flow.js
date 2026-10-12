// Flow: each core as a left→right tree that starts at the change: core change → 1st-order effects → 2nd order → …,
// every page hanging off the page it's reached from. What the core relies on sits in lanes to the left. Degree-of-
// interest sizing (focus big, its first few neighbours medium, the rest small, long lists folded into "+N"), and a
// camera that glides between overview → core → page.
import { DONE, LOW, esc } from "../core.js";

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
.flow .card, .flow .chead { position: absolute; left: 0; top: 0; transition: transform var(--dur) var(--ease), width var(--dur) var(--ease), height var(--dur) var(--ease), opacity var(--dur); }
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
.flow .chead { font-size: 14px; font-weight: 600; white-space: nowrap; cursor: pointer; display: flex; gap: 10px; align-items: baseline; max-width: 1400px; }
.flow .chead small { font-weight: 400; color: var(--muted); overflow: hidden; text-overflow: ellipsis; }
.flow .chead.other { opacity: .45; }
.flow .card.pr { border-color: var(--muted); padding: 12px 14px; }
.flow .card.pr .t { white-space: normal; font: 600 13.5px/1.35 var(--font-prose); }
.flow .card.pr .t span { display: -webkit-box; -webkit-line-clamp: 2; -webkit-box-orient: vertical; }
.flow .card.grp .t small { color: var(--faint); font-weight: 400; flex: none; }
.flow .card.grp.open { border-color: var(--signal); }
.flow .card.grp.done { opacity: .55; }
.flow .card .t .bandc { font: 500 9.5px var(--font-ui); letter-spacing: .06em; text-transform: uppercase; color: var(--faint); white-space: nowrap; padding: 0 5px; border: 1px solid var(--line-soft); border-radius: 1px; flex: none; }
.flow .card.core .t .bandc { color: var(--text); border-color: var(--muted); }
.flow .pane { overflow: auto; border-top: 1px solid var(--line); background: var(--bg); }
.flow.paged { grid-template-rows: var(--rail, 220px) 1fr; }
.flow.paged .stage { cursor: default; }
.flow .intent { position: absolute; left: 32px; top: 20px; right: 32px; max-width: 80ch; z-index: 3; font: 600 calc(var(--size) * 1.35)/1.35 var(--font-prose); pointer-events: none; transition: opacity var(--dur); }
.flow .intent small { display: block; font: 12px var(--font-ui); letter-spacing: .08em; text-transform: uppercase; color: var(--faint); margin-bottom: 6px; }
`;

const MAX_GROUPS = 15;
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
    let view = { tx: 0, ty: 0, s: 1 }, mine = false, lastL = null, G = null, lastGroups = null;
    const apply = () => { world.style.transform = `translate(${view.tx}px, ${view.ty}px) scale(${view.s})`; };
    let bodyH = 420; // last measured height of the focused card with its code
    const withBody = () => (app.level === 1 && app.get(app.focus) ? app.focus : null);

    function layout() {
      const body = withBody();
      const items = [], heads = [];
      // One graph for the whole PR, keyed by each node's own (non-repeat) placement, so code that several cores share
      // appears once. It reads left to right from the changes: ① every core change, then everything they affect
      // (1st order), what that affects (2nd order), … Each page hangs off a page one order before it; any other
      // links to it are drawn as well. What the changes rely on sits in lanes to the left, beside what it feeds.
      const canon = (pid) => app.canonical(pid);
      const pls = [], byId = new Map(), order = new Map();
      for (const c of app.graph.cores) for (const pl of app.corePlacements(c)) {
        const id = canon(pl.id);
        if (!byId.has(id)) { byId.set(id, app.get(id)?.pl ?? pl); order.set(id, pls.length); pls.push(id); }
      }
      const roots = [...new Set(app.graph.cores.flatMap((c) => app.band(c, "core").map((pl) => canon(pl.id))))].filter((id) => byId.has(id));
      const succ = new Map(), pred = new Map(), link = (m, a, b) => { const l = m.get(a) ?? m.set(a, []).get(a); if (!l.includes(b)) l.push(b); };
      for (const c of app.graph.cores) for (const e of app.edgesOf(c.id)) {
        const a = canon(e.from), b = canon(e.to);
        if (a !== b && byId.has(a) && byId.has(b)) { link(succ, a, b); link(pred, b, a); }
      }
      // Order: shortest distance from any core change along what-it-affects edges.
      const depth = new Map(roots.map((r) => [r, 0])), queue = [...roots];
      while (queue.length) { const a = queue.shift(); for (const b of succ.get(a) ?? []) if (!depth.has(b)) { depth.set(b, depth.get(a) + 1); queue.push(b); } }
      const parentOf = new Map(), kids = new Map(), feeds = new Map();
      for (const id of pls) {
        if (!depth.has(id)) { const t = (succ.get(id) ?? [])[0]; if (t) feeds.set(id, t); continue; } // relied on: a lane
        if (depth.get(id) === 0) continue;
        const p = (pred.get(id) ?? []).filter((q) => depth.get(q) === depth.get(id) - 1).sort((a, b) => order.get(a) - order.get(b))[0];
        if (p) { parentOf.set(id, p); (kids.get(p) ?? kids.set(p, []).get(p)).push(id); }
      }
      for (const list of kids.values()) list.sort((a, b) => order.get(a) - order.get(b));
      const fid = app.focus && byId.has(canon(app.focus)) ? canon(app.focus) : null;
      const near = new Set(fid && app.level > 0 ? [...(pred.get(fid) ?? []).slice(0, MAX_COL), ...(succ.get(fid) ?? []).slice(0, MAX_COL)] : []);
      const sizeOf = (id) => (app.level === 0 ? "far" : id === fid ? "focus" : near.has(id) ? "near" : "far");
      const dims = (id) => (sizeOf(id) === "focus" && body ? [BODY_W, bodyH] : SIZES[sizeOf(id)]);

      // Fold long lists of children into "+N", keeping the path to the focus and its neighbours.
      const onPath = new Set(); for (let q = fid; q && !onPath.has(q); q = parentOf.get(q) ?? feeds.get(q)) onPath.add(q);
      const foldTo = new Map(), aggs = new Map(), shownKids = new Map();
      for (const [p, list] of kids) {
        const key = `k:${p}`;
        let shown = list;
        if (list.length > MAX_COL + 1 && !expanded.has(key)) {
          const keep = (id) => onPath.has(id) || near.has(id);
          const must = list.filter(keep), rest = list.filter((id) => !keep(id));
          const pick = new Set([...must, ...rest.slice(0, Math.max(0, MAX_COL - must.length))]);
          const folded = list.filter((id) => !pick.has(id));
          shown = list.filter((id) => pick.has(id));
          if (folded.length) {
            const agg = `agg:${key}`;
            aggs.set(agg, { key, n: folded.length });
            const hide = (id) => { foldTo.set(id, agg); for (const k of kids.get(id) ?? []) hide(k); };
            folded.forEach(hide);
            shown.push(agg);
          }
        }
        shownKids.set(p, shown);
      }
      const hOf = (id) => (aggs.has(id) ? SIZES.agg[1] : dims(id)[1]);
      const wOf = (id) => (aggs.has(id) ? SIZES.agg[0] : dims(id)[0]);

      // Concern groups. Core changes are grouped by module: the deepest folder level (below what every file shares)
      // that gives at most MAX_GROUPS groups. A change alone in its module joins the group holding most of what it's
      // linked to (connectivity: changes that affect the same code). Everything else belongs to the group its tree
      // branch starts from; what's relied on, to the group of what it feeds. (Claude-made groups can replace this.)
      const fileOf = (id) => { const n = app.nodeOf(id); return n?.kind === "change" ? n.file : n?.location.path ?? ""; };
      const parts = new Map(roots.map((r) => [r, fileOf(r).split("/").slice(0, -1)]));
      let common = 0;
      while (roots.length && [...parts.values()].every((ps) => ps.length > common && ps[common] === parts.get(roots[0])[common])) common++;
      const keyAt = (r, d) => parts.get(r).slice(0, d).join("/") || ".";
      let depthG = common + 1;
      for (let d = common + 1; d <= Math.max(...[...parts.values()].map((ps) => ps.length), common + 1); d++) {
        if (new Set(roots.map((r) => keyAt(r, d))).size > MAX_GROUPS) break;
        depthG = d;
      }
      const moduleOf = new Map(roots.map((r) => [r, keyAt(r, depthG)]));
      // Connectivity, for the loners.
      const uf = new Map(roots.map((r) => [r, r]));
      const find = (x) => { while (uf.get(x) !== x) { uf.set(x, uf.get(uf.get(x))); x = uf.get(x); } return x; };
      const owner = new Map();
      for (const r of roots) {
        const seen = new Set([r]), q = [r];
        while (q.length) {
          const a = q.shift();
          for (const b of succ.get(a) ?? []) {
            if (seen.has(b)) continue; seen.add(b);
            if (uf.has(b)) { uf.set(find(b), find(r)); continue; }
            if (owner.has(b)) uf.set(find(owner.get(b)), find(r)); else owner.set(b, r);
            q.push(b);
          }
        }
      }
      const count = (m) => roots.filter((r) => moduleOf.get(r) === m).length;
      for (const r of roots) {
        if (count(moduleOf.get(r)) > 1) continue;
        const peers = roots.filter((q) => q !== r && find(q) === find(r));
        if (!peers.length) continue;
        const tally = new Map(); for (const q of peers) tally.set(moduleOf.get(q), (tally.get(moduleOf.get(q)) ?? 0) + 1);
        moduleOf.set(r, [...tally].sort((a, b) => b[1] - a[1])[0][0]);
      }
      const rootOf = (id, hops = 0) => (moduleOf.has(id) ? id : parentOf.has(id) && hops < 64 ? rootOf(parentOf.get(id), hops + 1) : feeds.has(id) && hops < 64 ? rootOf(feeds.get(id), hops + 1) : null);
      const groupOf = (id) => { const r = rootOf(id); return r ? moduleOf.get(r) : null; };
      const groups = new Map();
      for (const r of roots.slice().sort((a, b) => order.get(a) - order.get(b))) { const g = moduleOf.get(r); (groups.get(g) ?? groups.set(g, { id: g, roots: [], ids: [] }).get(g)).roots.push(r); }
      for (const id of pls) { const g = groupOf(id); if (g) groups.get(g).ids.push(id); }
      const gids = [...groups.keys()].sort((a, b) => groups.get(b).roots.length - groups.get(a).roots.length || order.get(groups.get(a).roots[0]) - order.get(groups.get(b).roots[0]));
      const openG = app.level > 0 && fid ? groupOf(fid) : null;

      // One tree, left to right: the PR → its concern groups → (the open group's) core changes → 1st order → …
      const PR = "pr", GK = (g) => `grp:${g}`;
      const SZ = { pr: [300, 96], grp: [270, 64] };
      const isG = (id) => id.startsWith("grp:");
      const kidsOf = (id) => (id === PR ? gids.map(GK) : isG(id) ? (id.slice(4) === openG ? groups.get(openG).roots : []) : shownKids.get(id) ?? []);
      const hO = (id) => (id === PR ? SZ.pr[1] : isG(id) ? SZ.grp[1] : hOf(id)), wO = (id) => (id === PR ? SZ.pr[0] : isG(id) ? SZ.grp[0] : wOf(id));
      const colKids = (col) => (col === "pr" ? "g" : col === "g" ? 0 : col + 1);
      const top = 20;
      const at = new Map(), colOf = new Map(), colBottom = new Map();
      let cursor = top;
      const lay = (id, col) => {
        colOf.set(id, col);
        const ch = kidsOf(id), h = hO(id);
        let cy;
        if (!ch.length) cy = Math.max(cursor, colBottom.get(col) ?? top);
        else { const mids = ch.map((k) => lay(k, colKids(col))); cy = Math.max((mids[0] + mids[mids.length - 1]) / 2 - h / 2, colBottom.get(col) ?? top); }
        at.set(id, cy);
        colBottom.set(col, cy + h + GAP_Y * (isG(id) ? 2 : 1));
        cursor = Math.max(cursor, cy + h + GAP_Y * (isG(id) ? 2 : 1));
        return cy + h / 2;
      };
      lay(PR, "pr");
      // What the open group relies on: lanes just before its core changes, beside what each card feeds.
      for (const lane of [-1, -2]) {
        if (!openG) break;
        const list = pls.filter((id) => !depth.has(id) && groupOf(id) === openG && (app.nodeOf(id)?.kind === "change") === (lane === -1))
          .sort((a, b) => (at.get(feeds.get(a)) ?? 1e9) - (at.get(feeds.get(b)) ?? 1e9) || order.get(a) - order.get(b));
        let bottom = top;
        for (const id of list) {
          const t = feeds.get(id), want = at.has(t) ? at.get(t) + hO(t) / 2 - hO(id) / 2 : bottom;
          const cy = Math.max(want, bottom);
          at.set(id, cy); colOf.set(id, lane); bottom = cy + hO(id) + GAP_Y;
        }
      }
      // Free-flowing: no columns. Each card sits a gutter right of its own parent; what's relied on sits a gutter left
      // of what it feeds, and an open concern leaves room for those lanes before its core changes.
      const laneW = (lane) => Math.max(0, ...[...colOf].filter(([, c]) => c === lane).map(([id]) => wO(id)));
      const laneSpan = [-1, -2].reduce((n, l) => n + (laneW(l) ? laneW(l) + GUTTER : 0), 0);
      const xs = new Map();
      const setX = (id, x) => { xs.set(id, x); for (const k of kidsOf(id)) setX(k, x + wO(id) + GUTTER + (isG(id) ? laneSpan : 0)); };
      setX(PR, 0);
      for (const lane of [-1, -2]) for (const [id, c] of colOf) if (c === lane) { const t = feeds.get(id); xs.set(id, (xs.get(t) ?? laneSpan) - GUTTER - wO(id)); }
      let y = top, width = 0;
      for (const [id, d] of colOf) {
        const w = wO(id), h = hO(id), x = xs.get(id) ?? 0, cy = at.get(id);
        width = Math.max(width, x + w);
        y = Math.max(y, cy + h);
        if (id === PR) { items.push({ kind: "pr", w, h, x, y: cy }); continue; }
        if (isG(id)) { const g = groups.get(id.slice(4)); items.push({ kind: "grp", g, open: g.id === openG, w, h, x, y: cy }); continue; }
        if (aggs.has(id)) { const a = aggs.get(id); items.push({ kind: "agg", key: a.key, n: a.n, size: "agg", w, h, x, y: cy, current: true }); continue; }
        const size = sizeOf(id);
        items.push({ kind: "pl", pl: byId.get(id), size, body: size === "focus" && !!body, w, h, x, y: cy, current: true, col: d, root: depth.get(id) === 0 });
      }
      y += CORE_GAP;
      G = { parentOf, feeds, kids: shownKids, pred, succ, foldTo, openG }; lastGroups = groups;
      if (app.graph.lowSignal.length) {
        const sel = app.focus === LOW;
        items.push({ kind: "low", size: sel ? "near" : "far", w: 260, h: 38, x: 0, y, current: sel });
        y += 38 + CORE_GAP;
      }
      // Edges between visible cards (folded endpoints route to the "+N" card).
      const pos = new Map(items.filter((i) => i.kind === "pl").map((i) => [i.pl.id, i]));
      const aggOf = (id) => { const a = G.foldTo.get(id); return a && items.find((i) => i.kind === "agg" && `agg:${i.key}` === a); };
      const edges = [], seen = new Set();
      for (const [a0, bs] of G.succ) for (const b0 of bs) {
        const a = pos.get(a0) ?? aggOf(a0), b = pos.get(b0) ?? aggOf(b0);
        if (!a || !b || a === b) continue;
        const k = `${a.x},${a.y}>${b.x},${b.y}`; if (seen.has(k)) continue; seen.add(k);
        const hot = app.level > 0 && (a0 === fid || b0 === fid);
        const tree = G.parentOf.get(b0) === a0 || G.feeds.get(a0) === b0;
        if (!tree && !hot) continue; // links beyond the tree only show for the focus, dashed: shared code would tangle the rest
        edges.push({ a, b, hot, dim: false, rep: !tree });
      }
      const prIt = items.find((i) => i.kind === "pr");
      for (const gi of items.filter((i) => i.kind === "grp")) {
        edges.push({ a: prIt, b: gi, hot: false, dim: !gi.open && app.level > 0, rep: false });
        if (gi.open) for (const r of gi.g.roots) { const b = pos.get(r); if (b) edges.push({ a: gi, b, hot: false, dim: false, rep: false }); }
      }
      return { items, heads, edges, height: y, width: Math.max(width, 400) };
    }

    function card(it) {
      if (it.kind === "pr") {
        const { done, total } = app.progress();
        return { cls: "pr", html: `<div class="t"><span>${esc(app.graph.intent)}</span></div><div class="m">${done}/${total} reviewed · ${app.graph.cores.length} core changes</div>`, data: { pr: "1" }, title: app.graph.intent };
      }
      if (it.kind === "grp") {
        const g = it.g, lead = byIdAll(g.roots[0]), pages = app.index.walk.filter((p) => g.ids.includes(app.canonical(p))), done = pages.filter((p) => app.isReviewed(p)).length;
        const name = g.id.split("/").slice(-2).join("/");
        return { cls: `grp ${it.open ? "open" : ""} ${done === pages.length && pages.length ? "done" : ""}`, html: `<div class="t"><i class="glyph core"></i><span>${esc(name)}</span><small>${g.roots.length} change${g.roots.length > 1 ? "s" : ""}</small></div><div class="m">${esc(lead?.title ?? "")}${g.roots.length > 1 ? ` +${g.roots.length - 1}` : ""} · ${done}/${pages.length} reviewed</div>`, data: { group: g.id }, title: g.roots.map((r) => byIdAll(r)?.title).join(" · ") };
      }
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
      const chip = size === "focus" || size === "near" ? `<span class="bandc">${it.root ? `core ${app.get(pl.id).ci + 1}` : BAND_CHIP[pl.band]}</span>` : "";
      const html = `<div class="t"><i class="glyph ${glyph}"></i><span>${esc(pl.title)}</span>${status}${chip}</div>`
        + (size === "focus" || size === "near" ? `<div class="w">${esc(pl.why)}</div>${it.body ? "" : `<div class="m">${esc(meta)}</div>`}` : "")
        + (it.body ? `<div class="nbody"></div>` : "");
      const cls = [it.body ? "withbody" : "", node.kind, pl.band === "core" ? "core" : "", size === "focus" ? "focus" : "", done ? "done" : "", pl.repeatOf ? "rep" : "", !current && app.level > 0 ? "other" : "", current && size === "far" && app.level === 1 ? "aside" : ""].join(" ");
      return { cls, html, data: { go: pl.id }, title: `${BAND_CHIP[pl.band]} · ${pl.why}` };
    }

    const byIdAll = (id) => app.get(id)?.pl;
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
      const focusItem = L.items.find((i) => i.kind === "pl" && i.pl.id === app.canonical(app.focus)) ?? L.items.find((i) => i.kind === "low" && app.focus === LOW);
      const loc = app.get(app.focus);
      const top = 0;
      if (app.level === 0 || !loc || !focusItem) box = { x: -20, y: -10, w: L.width, h: L.height };
      else {
        // Core or page level: frame the focus and its neighbours in the graph.
        const f = app.canonical(app.focus);
        const ids = new Set([f, ...(G.pred.get(f) ?? []), ...(G.succ.get(f) ?? [])]);
        const its = L.items.filter((i) => i.kind === "pl" && ids.has(i.pl.id));
        const xs = its.flatMap((i) => [i.x, i.x + i.w]), ys = its.flatMap((i) => [i.y, i.y + i.h]);
        box = { x: Math.min(...xs) - 20, y: Math.min(...ys) - 16, w: Math.max(...xs) - Math.min(...xs) + 40, h: Math.max(...ys) - Math.min(...ys) + 32 };
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
        const cur = focusItem && { y: focusItem.y, h: focusItem.h };
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

      intentEl.hidden = true; // the PR card at the root carries the intent

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
        const key = it.kind === "pl" ? it.pl.id : it.kind === "agg" ? `agg:${it.key}` : it.kind === "grp" ? `grp:${it.g.id}` : it.kind;
        const pin = filled?.h && it.body; // the filled card keeps its size through updates
        place(key, `card ${c.cls}${pin ? " pinned" : ""}`, c.html, it.x, it.y, it.w, pin ? filled.h : it.body ? null : it.h, c.data, c.title);
      }
      for (const [k, n] of els) if (!n._seen) { n.remove(); els.delete(k); }
    }

    // ---- interaction
    world.addEventListener("click", (ev) => {
      if (moved || ev.target.closest(".nbody")) return;
      const t = ev.target.closest("[data-go],[data-expand],[data-core],[data-group],[data-pr]");
      if (!t) return;
      if (t.dataset.expand) { expanded.add(t.dataset.expand); return update("expand"); }
      if (t.dataset.pr) return app.setLevel(0);
      if (t.dataset.group) { // into the group: its first unreviewed core change
        const g = lastGroups?.get(t.dataset.group); const to = g && (g.roots.find((r) => !app.isReviewed(r)) ?? g.roots[0]);
        return to && app.setFocus(to, { level: 1 });
      }
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

    // ---- arrows follow the flow: → one order deeper (the first page reached from this one), ← back toward the core
    // change (and from it, to what it relies on), ↑/↓ the page above or below in the same column.
    function move(dc, dr) {
      const t = G, f = app.canonical(app.focus);
      const its = (lastL?.items ?? []).filter((i) => i.kind === "pl");
      const at = its.find((i) => i.pl.id === f);
      if (!t || !at) return;
      const shown = (id) => its.some((i) => i.pl.id === id);
      let to;
      if (dr) {
        const col = its.filter((i) => i.col === at.col).sort((a, b) => a.y - b.y);
        to = col[col.indexOf(at) + dr]?.pl.id;
      } else if (dc > 0) to = t.feeds.get(f) ?? (t.kids.get(f) ?? []).find(shown) ?? (t.succ.get(f) ?? []).find(shown);
      else to = t.parentOf.get(f) ?? (t.pred.get(f) ?? []).find(shown);
      if (to && shown(to)) app.setFocus(to);
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
