// Outline: a document-like rail (walk order, indentation = depth in the tree, distant cores folded)
// beside a reading pane that shows the PR story, the core's story, or the code page.
import { BANDS, BAND_TEXT, DONE, LOW, esc, inline } from "../core.js";
import { injectCss } from "./flow.js";

const CSS = `
.outline { position: absolute; inset: 0; display: grid; grid-template-columns: minmax(300px, 380px) 1fr; }
.outline .rail { overflow: auto; border-right: 1px solid var(--line-soft); padding: 14px 10px 60px; background: var(--surface); }
.outline .doc { overflow: auto; }
.outline .oc { margin-bottom: 4px; border-radius: 5px; }
.outline .oc.cur { background: var(--bg); }
.outline .ch { width: 100%; display: grid; grid-template-columns: 26px 1fr auto; gap: 6px; align-items: baseline; padding: 8px 10px; border-radius: 4px; text-align: left; }
.outline .ch:hover { background: var(--raised); }
.outline .ch .n { font: 600 12px var(--font-code); color: var(--faint); }
.outline .ch .tt { font-weight: 600; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.outline .ch .pg { font-size: 12px; color: var(--faint); }
.outline .ch .dots { grid-column: 2 / 4; display: flex; gap: 3px; margin-top: 4px; }
.outline .ch .dots i { width: 6px; height: 6px; border-radius: 50%; background: var(--line); }
.outline .ch .dots i.d { background: var(--muted); }
.outline .grp { font-size: 10.5px; letter-spacing: .09em; text-transform: uppercase; color: var(--faint); padding: 8px 12px 3px 38px; }
.outline .row { width: 100%; display: flex; align-items: center; gap: 8px; padding: 5px 10px 5px calc(14px + var(--depth) * 18px); border-radius: 4px; text-align: left; font: 13px/1.35 var(--font-code); position: relative; }
.outline .row:hover { background: var(--raised); }
.outline .row .tt { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; flex: 1; }
.outline .row .via { font: 11px var(--font-ui); color: var(--faint); white-space: nowrap; }
.outline .row.done .tt { color: var(--faint); }
.outline .row.rep { opacity: .5; }
.outline .row.cur { background: var(--signal-soft); box-shadow: inset 3px 0 0 var(--signal); }
.outline .row[style*="--depth: 2"]::before { content: ""; position: absolute; left: 30px; top: -6px; height: 18px; width: 10px; border-left: 1px solid var(--line); border-bottom: 1px solid var(--line); border-bottom-left-radius: 6px; }
.outline .more { padding: 4px 10px 4px 48px; font-size: 12px; color: var(--muted); }
.outline .story { max-width: 760px; margin: 0 auto; padding: 36px 36px 80px; }
.outline .story .eyebrow { font-size: 12px; letter-spacing: .09em; text-transform: uppercase; color: var(--faint); }
.outline .story h1 { font: 650 calc(var(--size) * 1.9)/1.25 var(--font-prose); letter-spacing: -.015em; margin: 8px 0 14px; }
.outline .story .hook { margin: -14px 0 28px; max-width: 65ch; }
.outline .story .lede { font: calc(var(--size) * 1.12)/1.65 var(--font-prose); color: var(--muted); max-width: 65ch; margin: 0 0 28px; }
.outline .story section { border: 1px solid var(--line-soft); border-radius: 6px; padding: 16px 18px; margin-bottom: 10px; cursor: pointer; background: var(--surface); }
.outline .story section.cur { border-color: var(--signal); }
.outline .story section h3 { margin: 0 0 4px; font-size: calc(var(--size) * 1.05); display: flex; gap: 10px; }
.outline .story section h3 small { margin-left: auto; color: var(--faint); font-weight: 400; font-size: 12px; }
.outline .story section p { margin: 0; color: var(--muted); font-family: var(--font-prose); }
.outline .step { display: grid; grid-template-columns: 18px 1fr; gap: 4px 12px; padding: 12px 10px; border-radius: 5px; cursor: pointer; }
.outline .step:hover { background: var(--surface); }
.outline .step.cur { background: var(--signal-soft); }
.outline .step .glyph { margin-top: 6px; }
.outline .step b { font: 600 calc(var(--size) * .95) var(--font-code); }
.outline .step p { grid-column: 2; margin: 0; font: var(--size)/1.6 var(--font-prose); color: var(--muted); max-width: 65ch; }
.outline .step.done b { color: var(--faint); }
.outline .step .nbody { grid-column: 2; margin-top: 10px; cursor: auto; min-width: 0; }
.outline .step .nbody .code { margin-bottom: 10px; }
.outline .story .bandh { font-size: 11px; letter-spacing: .09em; text-transform: uppercase; color: var(--faint); margin: 22px 0 4px 10px; }
`;
const MAX_BAND = 5;

export default {
  id: "outline",
  name: "Outline",
  hint: "Document outline + reading pane",
  mount(el, app) {
    injectCss("outline", CSS);
    el.innerHTML = `<div class="outline"><nav class="rail" aria-label="Change tree"></nav><div class="doc"></div></div>`;
    const rail = el.querySelector(".rail"), doc = el.querySelector(".doc");
    const expanded = new Set();
    let lastDoc = null;

    // Depth = 2 when a node attaches to another non-core node (e.g. an untouched helper used by a changed test).
    const depthOf = (c, pl) => {
      if (pl.band === "core") return 0;
      const es = app.edgesOf(c.id);
      const link = pl.band.startsWith("up") ? es.find((e) => e.from === pl.id) : es.find((e) => e.to === pl.id);
      const other = link && app.get(pl.band.startsWith("up") ? link.to : link.from)?.pl;
      return other && other.band !== "core" ? 2 : 1;
    };
    const viaOf = (c, pl) => {
      const es = app.edgesOf(c.id);
      const link = pl.band.startsWith("up") ? es.find((e) => e.from === pl.id) : es.find((e) => e.to === pl.id);
      return link?.label ?? "";
    };

    function renderRail() {
      const focusCore = app.get(app.focus)?.core;
      rail.innerHTML = app.graph.cores.map((c, ci) => {
        const items = app.index.walk.filter((p) => app.get(p)?.core === c);
        const done = items.filter((p) => app.isReviewed(p)).length;
        const open = c === focusCore && app.level > 0;
        const head = `<button class="ch" data-core="${c.id}"><span class="n">${String(ci + 1).padStart(2, "0")}</span><span class="tt">${esc(c.title)}</span><span class="pg">${done}/${items.length}</span>
          ${open ? "" : `<span class="dots">${items.map((p) => `<i class="${app.isReviewed(p) ? "d" : ""}"></i>`).join("")}</span>`}</button>`;
        if (!open) return `<div class="oc">${head}</div>`;
        const groups = [["relies on", ["upUnchanged", "upChanged"]], ["core", ["core"]], ["affects", ["downChanged", "downUnchanged"]]];
        const body = groups.map(([label, bands]) => {
          const list = bands.flatMap((b) => c.bands[b]);
          if (!list.length) return "";
          const key = `${c.id}:${label}`;
          let shown = list;
          if (list.length > MAX_BAND + 1 && !expanded.has(key) && !list.slice(MAX_BAND).some((pl) => pl.id === app.focus)) shown = list.slice(0, MAX_BAND);
          const rows = shown.map((pl) => {
            const node = app.nodeOf(pl.id);
            const d = depthOf(c, pl), via = d === 2 ? viaOf(c, pl) : "";
            const glyph = pl.band === "core" ? "core" : node.kind;
            return `<button class="row ${pl.id === app.focus ? "cur" : ""} ${app.isReviewed(pl.id) ? "done" : ""} ${pl.repeatOf ? "rep" : ""}" style="--depth: ${d}" data-go="${pl.id}" title="${esc(pl.why)}">
              <i class="glyph ${glyph}"></i><span class="tt">${esc(pl.title)}</span>${via ? `<span class="via">${esc(via)}</span>` : ""}
              ${pl.risk === "high" ? `<i class="riskdot"></i>` : ""}${app.isFlagged(pl.id) ? `<span class="status flag">⚑</span>` : ""}${app.isReviewed(pl.id) ? `<span class="status">✓</span>` : ""}${pl.repeatOf ? `<span class="status">↺</span>` : ""}</button>`;
          }).join("");
          const more = shown.length < list.length ? `<button class="more" data-expand="${key}">+${list.length - shown.length} more</button>` : "";
          return `<div class="grp">${label}</div>${rows}${more}`;
        }).join("");
        return `<div class="oc cur">${head}${body}</div>`;
      }).join("") + (app.graph.lowSignal.length
        ? `<div class="oc"><button class="row ${app.focus === LOW ? "cur" : ""} ${app.isReviewed(LOW) ? "done" : ""}" style="--depth: 0" data-go="${LOW}"><i class="glyph context"></i><span class="tt">Low-signal changes</span>${app.isReviewed(LOW) ? `<span class="status">✓</span>` : ""}</button></div>` : "");
      rail.querySelector(".row.cur")?.scrollIntoView({ block: "nearest" });
    }

    function overviewDoc() {
      const fc = app.get(app.focus)?.core;
      const { done, total, mins } = app.progress();
      return `<div class="story"><div class="eyebrow">What this PR does</div><h1>${esc(app.graph.intent)}</h1>
        <p class="lede">${app.graph.cores.length} core change${app.graph.cores.length > 1 ? "s" : ""} · ${done}/${total} reviewed${mins ? ` · about ${mins} min left` : ""}. Press <kbd>enter</kbd> to open the highlighted one.</p>
        ${app.graph.cores.map((c, ci) => {
          const items = app.index.walk.filter((p) => app.get(p)?.core === c);
          return `<section class="${c === fc ? "cur" : ""}" data-core="${c.id}"><h3>${ci + 1} · ${esc(c.title)}<small>${items.filter((p) => app.isReviewed(p)).length}/${items.length}</small></h3><p>${esc(c.summary)}</p></section>`;
        }).join("")}</div>`;
    }

    function coreDoc() {
      const loc = app.get(app.focus);
      if (!loc) return overviewDoc();
      const c = loc.core;
      return `<div class="story"><div class="eyebrow">Core ${loc.ci + 1} of ${app.graph.cores.length}</div><h1>${esc(c.title)}</h1><p class="lede">${esc(c.summary)}</p>${c.hook ? `<p class="hook">${inline(c.hook)}</p>` : ""}
        ${BANDS.filter((b) => c.bands[b].length).map((b) => `<div class="bandh">${BAND_TEXT[b]}</div>` + c.bands[b].map((pl) => {
          const node = app.nodeOf(pl.id);
          return `<div class="step ${pl.id === app.focus ? "cur" : ""} ${app.isReviewed(pl.id) ? "done" : ""}" data-open="${pl.id}"><i class="glyph ${b === "core" ? "core" : node.kind}"></i><b>${esc(pl.title)}${app.isReviewed(pl.id) ? " ✓" : ""}${pl.repeatOf ? " ↺" : ""}</b><p>${esc(pl.why)}</p>${pl.id === app.focus ? `<div class="nbody"></div>` : ""}</div>`;
        }).join("")).join("")}</div>`;
    }

    function update(reason) {
      renderRail();
      const key = `${app.level}:${app.level === 2 ? app.focus : app.get(app.focus)?.core.id ?? app.focus}`;
      if (app.level === 2) {
        app.renderPage(doc, app.focus);
        if (key !== lastDoc) doc.scrollTop = 0;
      } else {
        app.pageEl = null;
        const top = doc.scrollTop;
        doc.innerHTML = app.level === 0 || app.focus === DONE || app.focus === LOW ? overviewDoc() : coreDoc();
        const body = doc.querySelector(".step.cur .nbody"); // only the focused step shows its comments + code
        if (body) app.renderNode(body, app.focus);
        if (key !== lastDoc) doc.scrollTop = 0;
        if (reason === "marks" || reason === "comments") doc.scrollTop = top;
        else doc.querySelector(".step.cur")?.scrollIntoView({ block: "start", behavior: "smooth" });
      }
      lastDoc = key;
    }

    el.addEventListener("click", (ev) => {
      const t = ev.target.closest("[data-go],[data-core],[data-expand],[data-open]");
      if (!t || ev.target.closest(".node")) return;
      const ds = t.dataset;
      if (ds.expand) { expanded.add(ds.expand); return update("expand"); }
      if (ds.core) { const first = app.index.walk.find((p) => app.get(p)?.core.id === ds.core && !app.isReviewed(p)) ?? app.index.walk.find((p) => app.get(p)?.core.id === ds.core); return app.setFocus(first, { level: 1 }); }
      if (ds.open) return app.setFocus(ds.open, { level: 2 });
      app.setFocus(ds.go, { level: Math.max(1, app.level) });
    });

    update("mount");
    return { update, destroy() {} };
  },
};
