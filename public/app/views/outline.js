// Outline: a document-like rail (the open core as a tree: each page nested under the page it attaches to, distant
// cores folded) beside a reading pane that shows the PR story, the core's story, or the code page.
import { keyHtml } from "../keys.js";
import { BANDS, BAND_TEXT, DONE, LOW, esc, inline } from "../core.js";

const BAND_CHIP = { upUnchanged: "relies on · untouched", upChanged: "relies on · changed", core: "core", downChanged: "affects · changed", downUnchanged: "affects · untouched" };
import { injectCss } from "./flow.js";
import { fileViewer, useViewerCss, viewerAction } from "./diff.js";

const CSS = `
.outline { position: absolute; inset: 0; display: grid; grid-template-columns: minmax(300px, 380px) 1fr; }
.outline .rail { overflow: auto; border-right: 1px solid var(--line-soft); padding: 14px 10px 60px; background: var(--surface); }
.outline .doc { overflow: auto; }
.outline .oc { margin-bottom: 4px; border-radius: 3px; }
.outline .oc.cur { background: var(--bg); }
.outline .ch { width: 100%; display: grid; grid-template-columns: 26px 1fr auto; gap: 6px; align-items: baseline; padding: 8px 10px; border-radius: 2px; text-align: left; }
.outline .ch:hover { background: var(--raised); }
.outline .ch .n { font: 600 12px var(--font-code); color: var(--faint); }
.outline .ch .tt { font-weight: 600; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.outline .ch .pg { font-size: 12px; color: var(--faint); }
.outline .ch .dots { grid-column: 2 / 4; display: flex; gap: 3px; margin-top: 4px; }
.outline .ch .dots i { width: 6px; height: 6px; border-radius: 50%; background: var(--line); }
.outline .ch .dots i.d { background: var(--muted); }
.outline .grp { font-size: 10.5px; letter-spacing: .09em; text-transform: uppercase; color: var(--faint); padding: 8px 12px 3px 38px; }
.outline .row { width: 100%; display: flex; align-items: center; gap: 8px; padding: 5px 10px 5px calc(14px + var(--depth) * 18px); border-radius: 2px; text-align: left; font: 13px/1.35 var(--font-code); position: relative; }
.outline .row:hover { background: var(--raised); }
.outline .row .tt { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; flex: 1; }
.outline .row .via { font: 11px var(--font-ui); color: var(--faint); white-space: nowrap; }
.outline .row.done .tt { color: var(--faint); }
.outline .row.rep { opacity: .5; }
.outline .row.cur { background: var(--signal-soft); box-shadow: inset 3px 0 0 var(--signal); }
.outline .row.sub::before { content: ""; position: absolute; left: calc(var(--depth) * 18px); top: -6px; height: 18px; width: 9px; border-left: 1px solid var(--line); border-bottom: 1px solid var(--line); border-bottom-left-radius: 4px; }
.outline .row .bandc { font: 500 9px var(--font-ui); letter-spacing: .06em; text-transform: uppercase; color: var(--faint); white-space: nowrap; padding: 0 4px; border: 1px solid var(--line-soft); border-radius: 1px; flex: none; }
.outline .more { padding: 3px 10px 3px calc(36px + var(--depth, 0) * 18px); font-size: 12px; color: var(--muted); }
.outline.filled { grid-template-columns: 1fr; }
.outline.filled .rail { display: none; }
.outline .story { padding: 24px 28px 80px; } /* from the left, the pane's full width; prose keeps a reading measure */
.outline .story .eyebrow { font-size: 12px; letter-spacing: .09em; text-transform: uppercase; color: var(--faint); }
.outline .story h1 { font: 650 calc(var(--size) * 1.9)/1.25 var(--font-prose); letter-spacing: -.015em; margin: 8px 0 14px; }
.outline .story .hook { margin: -14px 0 28px; max-width: 65ch; }
.outline .story .lede { font: calc(var(--size) * 1.12)/1.65 var(--font-prose); color: var(--muted); max-width: 65ch; margin: 0 0 28px; }
.outline .story > section { border: 1px solid var(--line-soft); border-radius: 4px; padding: 16px 18px; margin-bottom: 10px; cursor: pointer; background: var(--surface); }
.outline .story > section.cur { border-color: var(--signal); }
.outline .story > section h3 { margin: 0 0 4px; font-size: calc(var(--size) * 1.05); display: flex; gap: 10px; }
.outline .story > section h3 small { margin-left: auto; color: var(--faint); font-weight: 400; font-size: 12px; }
.outline .story > section p { margin: 0; color: var(--muted); font-family: var(--font-prose); }
.outline .step { display: grid; grid-template-columns: 18px 1fr; gap: 2px 10px; padding: 8px 10px; border-radius: 3px; cursor: pointer; }
.outline .step:hover { background: var(--surface); }
.outline .step.cur { cursor: default; } /* no tint: the viewer says where you are */
.outline .step > .glyph { margin-top: 6px; }
.outline .step > b { font: 600 calc(var(--size) * .95) var(--font-code); }
.outline .step > p { grid-column: 2; margin: 0; font: var(--size)/1.6 var(--font-prose); color: var(--muted); max-width: 65ch; }
.outline .step.done > b { color: var(--faint); }
/* The focused step's code: a viewer like Diff's, running the width of the story column. */
.outline .step .fvw { grid-column: 1 / 3; margin-top: 8px; min-width: 0; cursor: auto; border: 1px solid var(--line); border-radius: var(--radius); overflow: hidden; background: var(--surface); }
.outline .step .fvw .fvh { cursor: default; }
.outline .story .bandh { font-size: 11px; letter-spacing: .09em; text-transform: uppercase; color: var(--faint); margin: 22px 0 4px 10px; }
`;
const MAX_KIDS = 6;

export default {
  id: "outline",
  name: "Outline",
  hint: "Document outline + reading pane",
  mount(el, app) {
    injectCss("outline", CSS); useViewerCss();
    el.innerHTML = `<div class="outline"><nav class="rail" aria-label="Change tree"></nav><div class="doc"></div></div>`;
    const rail = el.querySelector(".rail"), doc = el.querySelector(".doc");
    const expanded = new Set();
    let lastDoc = null, filled = false;

    // The open core as a tree. Every page attaches to exactly one other page in its core (what it feeds, if it's
    // something relied on; what feeds it, if it's affected), so nesting each under that one reads as a tree rooted at
    // the core change: core → what it affects → what that affects, and core ← what it relies on ← what that relies on.
    function treeOf(c) {
      const es = app.edgesOf(c.id), pls = app.corePlacements(c), order = new Map(pls.map((pl, i) => [pl.id, i]));
      const parent = new Map(), kids = new Map();
      for (const pl of pls) {
        if (pl.band === "core") continue;
        const up = pl.band.startsWith("up"), e = up ? es.find((x) => x.from === pl.id) : es.find((x) => x.to === pl.id);
        const p = e && (up ? e.to : e.from);
        if (p && p !== pl.id && order.has(p)) parent.set(pl.id, { p, via: e.label ?? "" });
      }
      const rows = [], seen = new Set();
      for (const [id, { p }] of parent) (kids.get(p) ?? kids.set(p, []).get(p)).push(id);
      for (const list of kids.values()) list.sort((a, b) => order.get(a) - order.get(b));
      const visit = (id, depth) => {
        if (seen.has(id)) return; seen.add(id);
        rows.push({ id, depth, via: parent.get(id)?.via ?? "" });
        for (const k of kids.get(id) ?? []) visit(k, depth + 1);
      };
      for (const pl of pls) if (!parent.has(pl.id) || !order.has(parent.get(pl.id).p)) visit(pl.id, 0);
      for (const pl of pls) visit(pl.id, 0); // anything left on a cycle
      return { rows, parent, kids };
    }

    function renderRail() {
      const focusCore = app.get(app.focus)?.core;
      rail.innerHTML = app.graph.cores.map((c, ci) => {
        if (!app.coreShown(c)) return "";
        const items = app.index.walk.filter((p) => app.get(p)?.core === c);
        const done = items.filter((p) => app.isReviewed(p)).length;
        const open = c === focusCore && app.level > 0;
        const head = `<button class="ch" data-core="${c.id}"><span class="n">${String(ci + 1).padStart(2, "0")}</span><span class="tt">${esc(c.title)}</span><span class="pg">${done}/${items.length}</span>
          ${open ? "" : `<span class="dots">${items.map((p) => `<i class="${app.isReviewed(p) ? "d" : ""}"></i>`).join("")}</span>`}</button>`;
        if (!open) return `<div class="oc">${head}</div>`;
        const { rows, parent, kids } = treeOf(c);
        // Fold long lists of children into "+N more", each direction on its own (what a page relies on, what it
        // affects), unless the focus is among them.
        const hidden = new Set(), more = new Map();
        const groups = [...kids].flatMap(([p, list]) => ["up", "down"].map((d) => [`${p}:${d}`, list.filter((id) => app.get(id).pl.band.startsWith("up") === (d === "up"))]));
        for (const [p, list] of groups) {
          const key = `${c.id}:${p}`;
          if (list.length <= MAX_KIDS + 1 || expanded.has(key)) continue;
          const rest = list.slice(MAX_KIDS);
          const under = (id) => { for (let q = app.focus; q; q = parent.get(q)?.p) if (q === id) return true; return false; };
          if (rest.some(under)) continue;
          const drop = (id) => { hidden.add(id); for (const k of kids.get(id) ?? []) drop(k); };
          rest.forEach(drop);
          more.set(rest[rest.length - 1], { key, n: rest.length });
        }
        let body = "", lastBand = null, lastVia = null;
        for (const r of rows) {
          const m = [...more].find(([last]) => last === r.id);
          if (hidden.has(r.id)) { if (m) body += `<button class="more" style="--depth: ${r.depth}" data-expand="${m[1].key}">+${m[1].n} more</button>`; continue; }
          const pl = app.get(r.id).pl, node = app.nodeOf(r.id), glyph = pl.band === "core" ? "core" : node.kind;
          body += `<button class="row ${r.depth ? "sub" : ""} ${r.id === app.focus ? "cur" : ""} ${app.isReviewed(r.id) ? "done" : ""} ${pl.repeatOf ? "rep" : ""}" style="--depth: ${r.depth}" data-go="${r.id}" title="${esc(BAND_CHIP[pl.band])} · ${esc(pl.why)}">
            <i class="glyph ${glyph}"></i><span class="tt">${esc(pl.title)}</span>${r.via && r.via !== lastVia ? `<span class="via">${esc(r.via)}</span>` : ""}${pl.band !== lastBand ? `<span class="bandc">${BAND_CHIP[pl.band]}</span>` : ""}
            ${pl.risk === "high" ? `<i class="riskdot"></i>` : ""}${app.isFlagged(r.id) ? `<span class="status flag">⚑</span>` : ""}${app.isReviewed(r.id) ? `<span class="status">✓</span>` : ""}${pl.repeatOf ? `<span class="status">↺</span>` : ""}</button>`;
          lastBand = pl.band; lastVia = r.via; // band and relation show where they change, not on every row
        }
        return `<div class="oc cur">${head}${body}</div>`;
      }).join("") + (app.graph.lowSignal.length
        ? `<div class="oc"><button class="row ${app.focus === LOW ? "cur" : ""} ${app.isReviewed(LOW) ? "done" : ""}" style="--depth: 0" data-go="${LOW}"><i class="glyph context"></i><span class="tt">Low-signal changes</span>${app.isReviewed(LOW) ? `<span class="status">✓</span>` : ""}</button></div>` : "");
      rail.querySelector(".row.cur")?.scrollIntoView({ block: "nearest" });
    }

    function overviewDoc() {
      const fc = app.get(app.focus)?.core;
      const { done, total, mins } = app.progress();
      return `<div class="story"><div class="eyebrow">What this PR does</div><h1>${esc(app.graph.intent)}</h1>
        <p class="lede">${app.graph.cores.length} core change${app.graph.cores.length > 1 ? "s" : ""} · ${done}/${total} reviewed${mins ? ` · about ${mins} min left` : ""}. Press ${keyHtml(app.settings, "zoomIn")} to open the highlighted one.</p>
        ${app.graph.cores.map((c, ci) => {
          if (!app.coreShown(c)) return "";
          const items = app.index.walk.filter((p) => app.get(p)?.core === c);
          return `<section class="${c === fc ? "cur" : ""}" data-core="${c.id}"><h3>${ci + 1} · ${esc(c.title)}<small>${items.filter((p) => app.isReviewed(p)).length}/${items.length}</small></h3><p>${esc(c.summary)}</p></section>`;
        }).join("")}</div>`;
    }

    function coreDoc() {
      const loc = app.get(app.focus);
      if (!loc) return overviewDoc();
      const c = loc.core;
      return `<div class="story"><div class="eyebrow">Core ${loc.ci + 1} of ${app.graph.cores.length}</div><h1>${esc(c.title)}</h1><p class="lede">${esc(c.summary)}</p>${c.hook ? `<p class="hook">${inline(c.hook)}</p>` : ""}
        ${BANDS.filter((b) => app.band(c, b).length).map((b) => `<div class="bandh">${BAND_TEXT[b]}</div>` + app.band(c, b).map((pl) => {
          const node = app.nodeOf(pl.id);
          return `<div class="step ${pl.id === app.focus ? "cur" : ""} ${app.isReviewed(pl.id) ? "done" : ""}" data-open="${pl.id}"><i class="glyph ${b === "core" ? "core" : node.kind}"></i><b>${esc(pl.title)}${app.isReviewed(pl.id) ? " ✓" : ""}${pl.repeatOf ? " ↺" : ""}</b><p>${esc(pl.why)}</p>${pl.id === app.focus ? fileViewer(app, pl.id) : ""}</div>`;
        }).join("")).join("")}</div>`;
    }

    function update(reason) {
      el.firstElementChild.classList.toggle("filled", filled);
      renderRail();
      const key = `${app.level}:${app.level === 2 ? app.focus : app.get(app.focus)?.core.id ?? app.focus}`;
      if (app.level === 2) {
        app.renderPage(doc, app.focus);
        if (key !== lastDoc) app.keepScroll(doc); // back to a page: where you'd scrolled to
      } else {
        app.pageEl = null;
        if (lastDoc?.startsWith("2:")) doc._scrollKey = null; // leaving a page: the story's scroll isn't that page's
        const top = doc.scrollTop;
        doc.innerHTML = app.level === 0 || app.focus === DONE || app.focus === LOW ? overviewDoc() : coreDoc();
        const body = doc.querySelector(".step.cur .nbody"); // only the focused step shows its comments + code
        if (body) { app.renderFile(body, [app.focus]); app.pageEl = body; }
        if (key !== lastDoc) doc.scrollTop = 0;
        // to the current step only when you moved; anything else (a mark, a comment, a status or setting) keeps your place
        if (key !== lastDoc || reason === "focus" || reason === "level" || reason === "graph") doc.querySelector(".step.cur")?.scrollIntoView({ block: "start", behavior: "smooth" });
        else doc.scrollTop = top;
      }
      lastDoc = key;
    }

    el.addEventListener("click", (ev) => {
      if (viewerAction(app, ev)) return;
      if (ev.target.closest(".fvw")) return; // code, comments and Viewed boxes handle themselves
      const t = ev.target.closest("[data-go],[data-core],[data-expand],[data-open]");
      if (!t || ev.target.closest(".node")) return;
      const ds = t.dataset;
      if (ds.expand) { expanded.add(ds.expand); return update("expand"); }
      if (ds.core) { const first = app.index.walk.find((p) => app.get(p)?.core.id === ds.core && !app.isReviewed(p)) ?? app.index.walk.find((p) => app.get(p)?.core.id === ds.core); return app.setFocus(first, { level: 1 }); }
      if (ds.open) return app.setFocus(ds.open, { level: 2 });
      app.setFocus(ds.go, { level: Math.max(1, app.level) });
    });

    // ---- arrows follow the tree: ↑/↓ the previous/next row, → the first page nested under this one, ← its parent
    function move(dc, dr) {
      const loc = app.get(app.focus);
      if (!loc) return;
      const { parent, kids } = treeOf(loc.core);
      if (dr) {
        const ids = [...rail.querySelectorAll(".row[data-go]")].map((b) => b.dataset.go);
        const to = ids[ids.indexOf(app.focus) + dr];
        return to && app.setFocus(to, { level: Math.max(1, app.level) });
      }
      const to = dc > 0 ? kids.get(app.focus)?.[0] : parent.get(app.focus)?.p;
      if (to) app.setFocus(to, { level: Math.max(1, app.level) });
    }
    const fill = () => { filled = !filled; update("fill"); };
    const keys = { // by action (keys.js): whichever keys you've bound to them
      left: () => move(-1, 0), right: () => move(1, 0), up: () => move(0, -1), down: () => move(0, 1),
      focus: () => fill(), // the reading pane takes the whole width
      fullScreen: () => app.setLevel(app.level === 2 ? 1 : 2),
      zoomOut: () => (filled ? fill() : app.setLevel(app.level - 1)),
    };

    update("mount");
    return { update, keys, destroy() {} };
  },
};
