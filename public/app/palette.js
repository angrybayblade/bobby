// Command palette (⌘K / Ctrl+K): one search box over commands, cores, files and pages. It runs in #overlay, so
// the rest of the app treats it like any other modal.
import { BAND_TEXT, DONE, LOW, esc } from "./core.js";

const $ = (q) => document.querySelector(q);
export const MOD = /Mac|iPhone|iPad/.test(navigator.platform) ? "⌘" : "Ctrl";
const MAX = 80; // rows drawn at once; the rest is a few more letters away

let app, items = [], rows = [], active = 0;
const recent = []; // item ids, most recent first, for this tab

export const isOpen = () => !$("#overlay").hidden && !!$("#overlay > .palette");
export function close() { $("#overlay").hidden = true; }

/**
 * Opens the palette. Each command is { id, title, sub?, keys?: string[], run }; cores, files and pages are added
 * from the graph, so it searches whatever the walk currently shows.
 */
export function open(a, commands) {
  app = a;
  items = [...commands.map((c) => ({ group: "command", ...c })), ...cores(), ...files(), ...pages()];
  const o = $("#overlay");
  o.innerHTML = `<div class="modal palette" role="dialog" aria-modal="true" aria-label="Command palette">
    <input type="text" placeholder="Search commands, cores, files, pages…" aria-label="Search" aria-controls="plist" autocomplete="off" spellcheck="false">
    <div class="plist" id="plist" role="listbox"></div>
    <div class="pfoot"><span><kbd>↑</kbd> <kbd>↓</kbd> choose</span><span><kbd>enter</kbd> run</span><span><kbd>esc</kbd> close</span></div>
  </div>`;
  o.hidden = false;
  const input = o.querySelector("input"), list = o.querySelector(".plist");
  input.addEventListener("input", () => { active = 0; draw(input.value); });
  input.addEventListener("keydown", (ev) => {
    const d = ev.key === "ArrowDown" || (ev.ctrlKey && ev.key === "n") ? 1 : ev.key === "ArrowUp" || (ev.ctrlKey && ev.key === "p") ? -1 : 0;
    if (d) { ev.preventDefault(); return select(active + d); }
    if (ev.key === "Enter") { ev.preventDefault(); return run(rows[active]); }
    if (ev.key === "Escape") { ev.preventDefault(); close(); }
  });
  list.addEventListener("mousemove", (ev) => { const r = ev.target.closest("[data-pi]"); if (r && Number(r.dataset.pi) !== active) select(Number(r.dataset.pi)); });
  list.addEventListener("click", (ev) => { const r = ev.target.closest("[data-pi]"); if (r) run(rows[Number(r.dataset.pi)]); });
  active = 0;
  draw("");
  input.focus();
}

function run(it) {
  if (!it) return;
  recent.splice(0, recent.length, it.id, ...recent.filter((x) => x !== it.id).slice(0, 7));
  close();
  it.run();
}

function select(i) {
  if (!rows.length) return;
  active = (i + rows.length) % rows.length;
  for (const r of document.querySelectorAll("#plist [data-pi]")) r.setAttribute("aria-selected", String(Number(r.dataset.pi) === active));
  document.querySelector(`#plist [data-pi="${active}"]`)?.scrollIntoView({ block: "nearest" });
}

// ---------------------------------------------------------------- what it searches
const pathOf = (pid) => { const n = app.nodeOf(pid); return n && (n.kind === "change" ? n.file : n.location.path); };
const firstOpen = (pids) => pids.find((p) => !app.isReviewed(p)) ?? pids[0];
const status = (pid) => (app.isFlagged(pid) ? "⚑ " : "") + (app.isReviewed(pid) ? "✓" : "");

function cores() {
  return app.graph.cores.flatMap((c, ci) => {
    const pids = app.index.walk.filter((p) => app.get(p)?.ci === ci);
    if (!pids.length) return [];
    const done = pids.filter((p) => app.isReviewed(p)).length;
    return [{ id: `core:${c.id}`, group: "core", glyph: "core", title: `Core ${ci + 1} · ${c.title}`, sub: `${done}/${pids.length} reviewed`, run: () => app.setFocus(firstOpen(pids), { level: 1 }) }];
  });
}

function files() {
  const by = new Map();
  for (const pid of app.index.walk) {
    const loc = app.get(pid);
    if (!loc || loc.pl.repeatOf) continue;
    const path = pathOf(pid);
    (by.get(path) ?? by.set(path, []).get(path)).push(pid);
  }
  return [...by].sort((a, b) => a[0].localeCompare(b[0])).map(([path, pids]) => {
    const cut = path.lastIndexOf("/");
    return { id: `file:${path}`, group: "file", title: path.slice(cut + 1), sub: path.slice(0, cut + 1), tag: app.isFileRead(path) ? "✓" : "", run: () => app.setFocus(firstOpen(pids), { level: Math.max(1, app.level) }) };
  });
}

function pages() {
  return app.index.walk.flatMap((pid, i) => {
    if (pid === DONE) return [];
    const go = () => app.setFocus(pid, { level: Math.max(1, app.level) });
    if (pid === LOW) return [{ id: `page:${pid}`, group: "page", title: "Low-signal changes", sub: `${app.graph.lowSignal.length} hunks`, run: go }];
    const loc = app.get(pid);
    if (!loc || loc.pl.repeatOf) return [];
    const glyph = loc.pl.band === "core" ? "core" : app.nodeOf(pid).kind;
    return [{ id: `page:${pid}`, group: "page", glyph, title: loc.pl.title, sub: `${i + 1} · core ${loc.ci + 1} · ${BAND_TEXT[loc.pl.band].toLowerCase()} · ${pathOf(pid)}`, tag: status(pid), run: go }];
  });
}

// ---------------------------------------------------------------- matching
/**
 * How well one query word matches text: a substring beats a scattered match, and starting at a word boundary or
 * right after the previous hit counts extra. Returns { s, hits } (hit indices into text), or null for no match.
 */
const BOUNDARY = /[\s/._\-:·()]/;
function match(word, text) {
  const t = text.toLowerCase(), at = t.indexOf(word);
  if (at >= 0) return { s: 100 + word.length * 4 - Math.min(at, 40) + (at === 0 || BOUNDARY.test(t[at - 1]) ? 40 : 0), hits: [...word].map((_, k) => at + k) };
  const hits = [];
  let s = 0;
  for (let k = 0, j = 0; k < t.length && j < word.length; k++) {
    if (t[k] !== word[j]) continue;
    s += 1 + (hits.at(-1) === k - 1 ? 4 : 0) + (k === 0 || BOUNDARY.test(t[k - 1]) ? 6 : 0);
    hits.push(k); j++;
  }
  return hits.length === word.length ? { s, hits } : null;
}
/** Every word must match the title or the subtitle; the title counts more. */
function score(words, it) {
  let s = 0;
  const th = new Set(), sh = new Set();
  for (const w of words) {
    const a = match(w, it.title), b = it.sub ? match(w, it.sub) : null;
    if (!a && !b) return null;
    if (a && (!b || a.s >= b.s * 0.6)) { s += a.s; a.hits.forEach((h) => th.add(h)); }
    else { s += b.s * 0.6; b.hits.forEach((h) => sh.add(h)); }
  }
  return { s: s + GROUP_WEIGHT[it.group], th, sh };
}
const GROUP_WEIGHT = { command: 12, core: 8, file: 4, page: 0 };

const marked = (text, hits) => text.split("").map((ch, i) => (hits?.has(i) ? `<mark>${esc(ch)}</mark>` : esc(ch))).join("");

function draw(q) {
  const words = q.trim().toLowerCase().split(/\s+/).filter(Boolean);
  if (!words.length) {
    // Nothing typed: what you ran last, then every command and core. Files and pages wait for a query.
    const byId = new Map(items.map((it) => [it.id, it]));
    const last = recent.map((id) => byId.get(id)).filter(Boolean);
    rows = [...last, ...items.filter((it) => (it.group === "command" || it.group === "core") && !last.includes(it))].map((it) => ({ ...it, m: null }));
  } else {
    rows = items.map((it, i) => ({ ...it, i, m: score(words, it) })).filter((it) => it.m).sort((a, b) => b.m.s - a.m.s || a.i - b.i);
  }
  const total = rows.length;
  rows = rows.slice(0, MAX);
  active = Math.min(active, Math.max(0, rows.length - 1));
  const list = document.getElementById("plist");
  list.innerHTML = rows.length ? rows.map((it, i) => `<button class="pi" data-pi="${i}" role="option" aria-selected="${i === active}">
      <i class="${it.glyph ? `glyph ${it.glyph}` : "nog"}"></i><span class="t">${marked(it.title, it.m?.th)}</span><span class="s">${it.sub ? marked(it.sub, it.m?.sh) : ""}</span>
      ${it.tag ? `<span class="st">${esc(it.tag)}</span>` : ""}${it.keys ? `<span class="k">${it.keys.map((k) => `<kbd>${esc(k)}</kbd>`).join(" ")}</span>` : `<span class="g">${it.group}</span>`}</button>`).join("")
    + (total > MAX ? `<div class="none">${total - MAX} more. Keep typing to narrow it down</div>` : "")
    : `<div class="none">Nothing matches “${esc(q.trim())}”</div>`;
  list.querySelector(`[data-pi="${active}"]`)?.scrollIntoView({ block: "nearest" });
}
