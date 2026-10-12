// Flow: each core as a left→right tree that starts at the change: core change → 1st-order effects → 2nd order → …,
// every page hanging off the page it's reached from. What the core relies on sits in lanes to the left. Degree-of-
// interest sizing (focus big, its first few neighbours medium, the rest small, long lists folded into "+N"), and a
// camera that glides between overview → core → page.
import { DONE, LOW, esc } from "../core.js";
import { useViewerCss } from "./diff.js";

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
.flow .card.focus { border: 2px solid var(--line); background: var(--surface); box-shadow: var(--shadow); padding: 12px 16px; z-index: 2; } /* weight, not colour: like a Diff viewer */
.flow .card.focus .t { font-size: 15px; font-weight: 600; }
.flow .card.focus .w { font-size: 14px; color: var(--text); -webkit-line-clamp: 4; }
.flow .card.withbody { cursor: default; z-index: 3; transition: transform var(--dur) var(--ease), opacity var(--dur); } /* no width/height easing: it is measured */
.flow .card.withbody .t { cursor: zoom-in; }
.flow .card.withbody .w { display: block; }
/* The focused card's code is a viewer like the Diff canvas's: file header, sticky section heads, compact code. */
.flow .card .fvw { margin: 8px -12px -8px; display: flex; flex-direction: column; min-height: 0; border-top: 1px solid var(--line-soft); cursor: auto; }
.flow .card.focus .fvw { margin: 10px -16px -12px; }
.flow .card .fvw .fvh { cursor: default; }
.flow .card .nbody { max-height: var(--viewer-h, 560px); overflow: auto; overscroll-behavior: contain; }
.flow .card.done { opacity: .5; }
.flow .card.done.focus { opacity: 1; }
.flow .card.rep { opacity: .45; border-style: dotted; }
.flow .card.other { opacity: .32; }
.flow .card.aside { opacity: .55; } /* in the current core, not the focus or its neighbours */
.flow .card.pinned { z-index: 6; border-radius: 0; border-width: 0; box-shadow: none; padding: 10px 14px; } /* f: fills the canvas */
.flow .card.pinned > * { zoom: var(--fill, 1); }
.flow .card.pinned .fvw { flex: 1; min-height: 0; }
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
// The focused card when it shows its code (core level only): as wide as a Diff viewer of its file.
const bodyW = (app, pid) => { const n = app.nodeOf(pid), path = n?.kind === "change" ? n.file : n?.location.path; return app.layoutOf(path) === "split" ? 1280 : 840; };
const BAND_CHIP = { upUnchanged: "relies on · untouched", upChanged: "relies on · changed", core: "core", downChanged: "affects · changed", downUnchanged: "affects · untouched" };

export default {
  id: "flow",
  name: "Flow",
  hint: "Node-link canvas: relies on ← core → affects",
  mount(el, app) {
    injectCss("flow", CSS); useViewerCss();
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
      // The tree is the review graph's own: each core change is a root, and every page hangs off the one page its
      // core's edges attach it to (what it's reached from; what's relied on, beside what it feeds). Code that several
      // changes reach appears under each of them: the original once, the rest as small ↺ repeats. Laid out in
      // pre-order: the level runs left to right, a parent shares its first child's row, and each further child starts
      // on the next free row, so reading down a level follows the tree depth-first. Zoomed out, cores are grouped into
      // concerns (by module), and only the open concern's trees are drawn.
      const fid = app.get(app.focus) ? app.canonical(app.focus) : null;
      const floc = fid && app.get(fid);
      const cores = app.graph.cores.filter((c) => app.coreShown(c));
      const isUp = (pl) => pl.band.startsWith("up");

      // ---- concerns: cores by module (the deepest folder level, below what every file shares, giving at most
      // MAX_GROUPS groups); a core alone in its module joins the module it shares the most code with.
      const coreFile = (c) => { const pl = app.band(c, "core")[0] ?? app.corePlacements(c)[0]; const n = pl && app.nodeOf(pl.id); return n ? (n.kind === "change" ? n.file : n.location.path) : ""; };
      const parts = new Map(cores.map((c) => [c, coreFile(c).split("/").slice(0, -1)]));
      let common = 0;
      while (cores.length && [...parts.values()].every((ps) => ps.length > common && ps[common] === parts.get(cores[0])[common])) common++;
      const keyAt = (c, d) => parts.get(c).slice(0, d).join("/") || ".";
      let depthG = common + 1;
      for (let d = common + 1; d <= Math.max(common + 1, ...[...parts.values()].map((ps) => ps.length)); d++) {
        if (new Set(cores.map((c) => keyAt(c, d))).size > MAX_GROUPS) break;
        depthG = d;
      }
      const moduleOf = new Map(cores.map((c) => [c, keyAt(c, depthG)]));
      const linked = new Map(cores.map((c) => [c, new Map()]));
      for (const c of cores) for (const pl of app.corePlacements(c)) {
        const o = pl.repeatOf && app.get(pl.repeatOf)?.core;
        if (o && o !== c && linked.has(o)) { linked.get(c).set(o, (linked.get(c).get(o) ?? 0) + 1); linked.get(o).set(c, (linked.get(o).get(c) ?? 0) + 1); }
      }
      for (const c of cores) {
        if (cores.filter((q) => moduleOf.get(q) === moduleOf.get(c)).length > 1 || !linked.get(c).size) continue;
        const tally = new Map(); for (const [o, n] of linked.get(c)) tally.set(moduleOf.get(o), (tally.get(moduleOf.get(o)) ?? 0) + n);
        moduleOf.set(c, [...tally].sort((a, b) => b[1] - a[1])[0][0]);
      }
      const groups = new Map();
      for (const c of cores) {
        const g = groups.get(moduleOf.get(c)) ?? groups.set(moduleOf.get(c), { id: moduleOf.get(c), cores: [], roots: [], ids: [] }).get(moduleOf.get(c));
        g.cores.push(c); g.roots.push(...app.band(c, "core").map((pl) => pl.id)); g.ids.push(...app.corePlacements(c).map((pl) => app.canonical(pl.id)));
      }
      const gids = [...groups.keys()].sort((a, b) => groups.get(b).cores.length - groups.get(a).cores.length || app.graph.cores.indexOf(groups.get(a).cores[0]) - app.graph.cores.indexOf(groups.get(b).cores[0]));
      const openG = app.level > 0 && floc ? moduleOf.get(floc.core) : null;

      // ---- sizes: the focus big (with its code at the core level), its first few neighbours medium, the rest small.
      const nb = fid ? app.neighbours(fid) : { up: [], down: [] };
      const near = new Set([...nb.up.slice(0, MAX_COL).map((e) => e.from), ...nb.down.slice(0, MAX_COL).map((e) => e.to)]);
      const sizeOf = (pl) => (pl.repeatOf || app.level === 0 ? "far" : pl.id === fid ? "focus" : near.has(pl.id) ? "near" : "far");
      const dims = (pl) => (sizeOf(pl) === "focus" && body ? [bodyW(app, pl.id), bodyH] : SIZES[sizeOf(pl)]);

      // ---- the cells: rows of cards; each card knows its row, x, size and level.
      const rows = [], cells = [], edgesIds = [];
      const tree = { parent: new Map(), kids: new Map(), feeds: new Map(), foldTo: new Map() };
      const fit = (r, h) => (rows[r] = Math.max(rows[r] ?? 0, h));
      const cell = (c) => { cells.push(c); fit(c.row, c.h); return c; };
      let row = 0;
      const PRW = 300, PRH = 96, GW = 270, GH = 64;
      cell({ key: "pr", kind: "pr", row: 0, x: 0, w: PRW, h: PRH });
      const gx = PRW + GUTTER;
      for (const gid of gids) {
        const g = groups.get(gid);
        cell({ key: `grp:${gid}`, kind: "grp", g, open: gid === openG, row, x: gx, w: GW, h: GH });
        edgesIds.push(["pr", `grp:${gid}`]);
        if (gid !== openG) { row++; continue; }
        // The open concern: what its cores rely on in lanes, then each core change's tree.
        const ups = g.cores.flatMap((c) => app.corePlacements(c).filter(isUp));
        const laneW = (band) => Math.max(0, ...ups.filter((pl) => pl.band === band).map((pl) => dims(pl)[0]));
        const x2 = gx + GW + GUTTER, w2 = laneW("upUnchanged"), x1 = x2 + (w2 ? w2 + GUTTER : 0), w1 = laneW("upChanged"), rootX = x1 + (w1 ? w1 + GUTTER : 0);
        for (const c of g.cores) {
          const pls = app.corePlacements(c), byId = new Map(pls.map((pl) => [pl.id, pl])), order = new Map(pls.map((pl, i) => [pl.id, i]));
          const es = app.edgesOf(c.id), roots = app.band(c, "core").map((pl) => pl.id);
          const kids = new Map();
          for (const pl of pls) {
            if (pl.band === "core") continue;
            if (isUp(pl)) { const e = es.find((x) => x.from === pl.id && byId.has(x.to)); tree.feeds.set(pl.id, e?.to ?? roots[0]); continue; }
            const e = es.find((x) => x.to === pl.id && byId.has(x.from) && !isUp(byId.get(x.from)) && x.from !== pl.id);
            const p = e?.from ?? roots[0]; // cut off from its parent (hidden by a switch): under the core change
            if (!p) continue;
            tree.parent.set(pl.id, p); (kids.get(p) ?? kids.set(p, []).get(p)).push(pl.id);
          }
          for (const list of kids.values()) list.sort((a, b) => order.get(a) - order.get(b));
          // Fold long lists of children into "+N", keeping the path to the focus and its neighbours.
          const onPath = new Set(); for (let q = fid; q && byId.has(q) && !onPath.has(q); q = tree.parent.get(q)) onPath.add(q);
          const shownKids = (p) => {
            const list = kids.get(p) ?? [], key = `k:${c.id}:${p}`;
            if (list.length <= MAX_COL + 1 || expanded.has(key)) return list;
            const keep = (id) => onPath.has(id) || near.has(id);
            const must = list.filter(keep), rest = list.filter((id) => !keep(id));
            const pick = new Set([...must, ...rest.slice(0, Math.max(0, MAX_COL - must.length))]);
            const folded = list.filter((id) => !pick.has(id));
            for (const id of folded) tree.foldTo.set(id, `agg:${key}`);
            return [...list.filter((id) => pick.has(id)), { agg: key, n: folded.length }];
          };
          const seen = new Set();
          const place = (id, x, r, depth) => { // returns the last row its subtree used
            if (typeof id === "object") { cell({ key: `agg:${id.agg}`, kind: "agg", aggKey: id.agg, n: id.n, row: r, x, w: SIZES.agg[0], h: SIZES.agg[1], depth }); return r; }
            seen.add(id);
            const pl = byId.get(id), [w, h] = dims(pl);
            cell({ key: id, kind: "pl", pl, row: r, x, w, h, depth, root: depth === 0 });
            const ks = shownKids(id).filter((k) => typeof k === "object" || !seen.has(k));
            tree.kids.set(id, ks.filter((k) => typeof k !== "object"));
            let last = r;
            ks.forEach((k, i) => {
              const kr = i === 0 ? r : last + 1;
              edgesIds.push([id, typeof k === "object" ? `agg:${k.agg}` : k]);
              last = Math.max(last, place(k, x + w + GUTTER, kr, depth + 1));
            });
            return last;
          };
          const top0 = row;
          let last = row - 1;
          for (const r of roots) { last = place(r, rootX, last + 1, 0); edgesIds.push([`grp:${gid}`, r]); }
          // Lanes: each relied-on card on the row of what it feeds, or the next free row in its lane.
          const rowOf = (id) => cells.find((x) => x.key === id)?.row;
          for (const [band, lx, depth] of [["upChanged", x1, -1], ["upUnchanged", x2, -2]]) {
            let free = top0;
            for (const pl of pls.filter((q) => q.band === band)) {
              const r = Math.max(rowOf(tree.feeds.get(pl.id)) ?? free, free), [w, h] = dims(pl);
              cell({ key: pl.id, kind: "pl", pl, row: r, x: lx + (band === "upChanged" ? w1 - w : w2 - w), w, h, depth });
              edgesIds.push([pl.id, tree.feeds.get(pl.id)]);
              free = r + 1; last = Math.max(last, r);
            }
          }
          row = last + 2; // a spare row between core changes
        }
      }
      // Rows to y, top-aligned.
      const top = 20, rowY = []; let acc = top;
      for (let r = 0; r < rows.length; r++) { rowY[r] = acc; acc += (rows[r] ?? 0) + (rows[r] ? GAP_Y : GAP_Y * 2); }
      let y = acc + CORE_GAP, width = 0;
      for (const c of cells) {
        const it = { ...c, y: rowY[c.row] };
        width = Math.max(width, c.x + c.w);
        if (c.kind === "pl") Object.assign(it, { size: sizeOf(c.pl), body: c.pl.id === fid && sizeOf(c.pl) === "focus" && !!body, current: true });
        if (c.kind === "agg") Object.assign(it, { key: c.aggKey, size: "agg", current: true });
        items.push(it);
      }
      const succ = new Map(), pred = new Map();
      for (const [a, b] of edgesIds) { (succ.get(a) ?? succ.set(a, []).get(a)).push(b); (pred.get(b) ?? pred.set(b, []).get(b)).push(a); }
      G = { parent: tree.parent, kids: tree.kids, feeds: tree.feeds, foldTo: tree.foldTo, succ, pred, openG }; lastGroups = groups;
      if (app.graph.lowSignal.length) {
        const sel = app.focus === LOW;
        items.push({ kind: "low", size: sel ? "near" : "far", w: 260, h: 38, x: 0, y, current: sel });
        y += 38 + CORE_GAP;
      }
      // Edges: the tree's own, plus the PR to its concerns and the open concern to its core changes.
      const byKey = new Map(items.map((i) => [i.kind === "pl" ? i.pl.id : i.kind === "agg" ? `agg:${i.key}` : i.kind === "grp" ? `grp:${i.g.id}` : i.kind, i]));
      const edges = [];
      for (const [a0, b0] of edgesIds) {
        const a = byKey.get(a0), b = byKey.get(b0);
        if (!a || !b || a === b) continue;
        const hot = app.level > 0 && (a0 === fid || b0 === fid);
        edges.push({ a, b, hot, dim: a.kind === "pr" && b.kind === "grp" && !b.open && app.level > 0, rep: b.kind === "pl" && !!b.pl.repeatOf });
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
        return { cls: `grp ${it.open ? "open" : ""} ${done === pages.length && pages.length ? "done" : ""}`, html: `<div class="t"><i class="glyph core"></i><span>${esc(name)}</span><small>${g.cores.length} change${g.cores.length > 1 ? "s" : ""}</small></div><div class="m">${esc(lead?.title ?? "")}${g.cores.length > 1 ? ` +${g.cores.length - 1}` : ""} · ${done}/${pages.length} reviewed</div>`, data: { group: g.id }, title: g.roots.map((r) => byIdAll(r)?.title).join(" · ") };
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
      const chip = !it.body && (size === "focus" || size === "near") ? `<span class="bandc">${it.root ? `core ${app.get(pl.id).ci + 1}` : BAND_CHIP[pl.band]}</span>` : "";
      const html = `<div class="t"><i class="glyph ${glyph}"></i><span>${esc(pl.title)}</span>${status}${chip}</div>`
        + (size === "focus" || size === "near" ? `<div class="w">${esc(pl.why)}</div>${it.body ? "" : `<div class="m">${esc(meta)}</div>`}` : "")
        + (it.body ? viewer(pl) : "");
      const cls = [it.body ? "withbody" : "", node.kind, pl.band === "core" ? "core" : "", size === "focus" ? "focus" : "", done ? "done" : "", pl.repeatOf ? "rep" : "", !current && app.level > 0 ? "other" : "", current && size === "far" && app.level === 1 ? "aside" : ""].join(" ");
      return { cls, html, data: { go: pl.id }, title: `${BAND_CHIP[pl.band]} · ${pl.why}` };
    }

    const byIdAll = (id) => app.get(id)?.pl;
    // The Diff viewer's header for the focused page's file: path, band, +/−, ✓ viewed, inline/split, note, full screen.
    function viewer(pl) {
      const n = app.nodeOf(pl.id), path = n.kind === "change" ? n.file : n.location.path, dir = path.includes("/") ? path.slice(0, path.lastIndexOf("/") + 1) : "";
      const { a, d } = app.stat(pl.id), split = app.layoutOf(path) === "split", done = app.isReviewed(pl.id);
      const stat = n.kind === "change" ? `<span style="color:var(--ok)">+${a}</span> <span style="color:var(--risk)">−${d}</span>` : "untouched";
      return `<div class="fvw ${done ? "viewed" : ""}"><div class="fvh"><i class="glyph ${n.kind}"></i><span class="p">${esc(dir)}<b>${esc(path.split("/").pop())}</b></span><span class="band ${pl.band}">${BAND_CHIP[pl.band]}</span><span class="st">${stat}</span>`
        + `<button class="max vwf" data-pviewed="1" aria-label="Mark viewed" data-tip="Mark viewed · local only" data-tip-on="Unmark viewed">✓</button>`
        + `<button class="max lay" data-flayout="${esc(path)}" aria-label="Inline or split" data-tip="${split ? "Show this file inline" : "Show this file split"} · d for every file">${split ? "▤" : "◫"}</button>`
        + `<button class="max" data-pnote="${esc(path)}" aria-label="Note on this file" data-tip="Private note on this file · only you see it">✎</button>`
        + `<button class="max" data-pmax="1" aria-label="Full screen" data-tip="Full screen · g">⤢</button></div><div class="fvb nbody"></div></div>`;
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
      if (app.level === 1 && focusItem?.body) { // like Diff: the card with its code fills the stage, at the scale that fits its width
        s = Math.min((sw - PAD * 2) / focusItem.w, (sh - PAD * 2) / focusItem.h);
        tx = sw / 2 - (focusItem.x + focusItem.w / 2) * s; ty = sh / 2 - (focusItem.y + focusItem.h / 2) * s;
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
    // The focused card's viewer is at most as tall as the stage allows once the card is scaled to fit its width.
    function sizeViewer() {
      const sw = stage.clientWidth || 1440, sh = stage.clientHeight || 900, w = bodyW(app, app.focus), s = (sw - PAD * 2) / w;
      root.style.setProperty("--viewer-h", `${Math.max(200, Math.round((sh - PAD * 2) / s - 150))}px`);
    }
    new ResizeObserver(() => { const was = root.style.getPropertyValue("--viewer-h"); sizeViewer(); if (root.style.getPropertyValue("--viewer-h") !== was && app.level === 1) update("measure"); }).observe(stage);
    function update(reason) {
      sizeViewer();
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
        if (reason !== "measure") { const nb = n.querySelector(".nbody"); app.renderFile(nb, [app.focus]); app.pageEl = nb; }
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
      const hb = ev.target.closest("[data-pviewed],[data-pnote],[data-pmax]");
      if (hb) {
        if (hb.dataset.pviewed) return app.mark(app.focus, app.isReviewed(app.focus) ? null : "reviewed");
        if (hb.dataset.pnote) return app.noteOnFile(els.get(app.canonical(app.focus))?.querySelector(".nbody"), hb.dataset.pnote);
        return app.setLevel(2);
      }
      if (moved || ev.target.closest(".fvw")) return;
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
      if (app.level === 2 || ev.target.closest(".fvw")) return; // code in a card stays selectable
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
      const f = app.canonical(app.focus);
      const its = (lastL?.items ?? []).filter((i) => i.kind === "pl");
      const at = its.find((i) => i.pl.id === f);
      if (!G || !at) return;
      const shown = (id) => its.some((i) => i.pl.id === id);
      let to;
      if (dr) { // the previous / next page at the same level, in pre-order (top to bottom)
        const lvl = its.filter((i) => i.depth === at.depth).sort((a, b) => a.y - b.y || a.x - b.x);
        to = lvl[lvl.indexOf(at) + dr]?.pl.id;
      } else if (dc > 0) to = G.feeds.get(f) ?? (G.kids.get(f) ?? []).find(shown);
      else to = G.parent.get(f) ?? [...G.feeds].find(([, t]) => t === f)?.[0];
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
