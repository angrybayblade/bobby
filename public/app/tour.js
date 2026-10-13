// Callouts that point at the interface: one after another for a tour, or one on its own. They never block: the app
// underneath keeps its keys and clicks, and the callout follows what it points at as the app re-renders.
import { esc } from "./core.js";
import { MOD } from "./palette.js";
import { keyHtml } from "./keys.js";

const $ = (q) => document.querySelector(q);
const kbd = (...ks) => ks.map((k) => `<kbd>${k}</kbd>`).join(" ");
const PALETTE_KEY = MOD === "⌘" ? kbd("⌘K") : kbd("ctrl", "k");
let app, steps = [], at = -1, onEnd = null, card, ring, firstRun = false;

const k = (id) => keyHtml(app.settings, id); // your key for an action (keys.js), as it is when the step shows
const TOUR = () => [
  { title: "Welcome", body: `I'll take you through this PR one page at a time, in dependency order: the code a change relies on, then the change, then what it affects. Four quick tips, or ${kbd("esc")} to skip.` },
  { at: "#where", title: "Where you are", body: `The PR, the core change you're in, and the page you're on. ${k("zoomIn")} zooms in and ${k("zoomOut")} zooms out: overview, core, page.` },
  { at: "#view", title: "The walk", body: `${k("next")} ${k("prev")} step through it. <i class="glyph core"></i> is a core change, <i class="glyph change"></i> changed code, <i class="glyph context"></i> untouched code around it. ${k("reviewed")} marks a page reviewed and moves on, ${k("flag")} flags it for later, ${k("comment")} comments on a line.` },
  { at: '#top .seg[aria-label="View"]', title: "Four ways to see it", body: `Flow, Outline, Lens and Diff show the same walk. ${k("nextView")} switches, and you keep your place.` },
  { at: "#keys", title: "Keys when you need them", body: `These hints fade once you've used them. ${k("help")} lists every key, ${PALETTE_KEY} searches every command, and ${k("submit")} submits your review.`, next: "Start reviewing" },
];

// What's new, oldest first. Each is offered once, as a chip at the end of the key hints, one per launch; opening it
// marks it seen. A first launch marks them all seen: the tour covers the app as it is.
const NEWS = () => [
  { id: "palette", title: "Command palette", body: `${PALETTE_KEY} searches every command, core, file and page, and runs what you pick.` },
  { id: "tour", title: "A quick tour", body: `Let me show you how the walk, the views and the keys fit together, in four quick tips. You'll find it on ${k("help")} whenever you want it again.`, act: { label: "Take the tour", run: () => start() } },
  { id: "inspect", title: "Inspect a name", body: `${MOD === "⌘" ? kbd("⌘") : kbd("ctrl")}-click a function, class or variable in the code to see where it's declared, its type and its code, in a window over the review. ${MOD === "⌘" ? kbd("⌘") : kbd("ctrl")}-click inside to go deeper, ${kbd("esc")} to come back.` },
];
let news = null;

export const isOpen = () => at >= 0;

/** `fresh`: nothing saved yet, so this is a first launch. The tour is offered once, then left to `?` and the palette. */
export function init(a, { fresh = false } = {}) {
  app = a;
  firstRun = fresh && app.settings.tour !== "seen";
  const seen = app.settings.news ?? [];
  news = firstRun ? null : NEWS().find((n) => !seen.includes(n.id)) ?? null;
  const patch = { ...(app.settings.tour !== "seen" ? { tour: "seen" } : {}), ...(firstRun ? { news: NEWS().map((n) => n.id) } : {}) };
  if (Object.keys(patch).length) app.saveSettings(patch);
  document.addEventListener("click", (ev) => ev.target.closest("[data-tour=news]") && openNews());
  ring = document.body.appendChild(Object.assign(document.createElement("div"), { className: "tour-ring", hidden: true }));
  card = document.body.appendChild(Object.assign(document.createElement("div"), { className: "tour", hidden: true }));
  card.setAttribute("role", "dialog");
  card.addEventListener("click", (ev) => { const b = ev.target.closest("[data-tstep]"); if (b) go(b.dataset.tstep); });
  window.addEventListener("resize", place);
  app.on(() => isOpen() && requestAnimationFrame(place));
}

export const start = (then) => show(TOUR(), { then });
/** Runs the tour on a first launch, then `then`; otherwise just `then`. */
export function welcome(then) {
  if (!firstRun) return then();
  firstRun = false;
  start(then);
}

/** The chip for what's new, for the end of the key hints; empty once it's been seen. */
export const newsChip = () => (news ? `<button class="newchip" data-tour="news" title="What's new">New · ${esc(news.title)}</button>` : "");
function openNews() {
  const n = news && NEWS().find((x) => x.id === news.id); // with your keys as they are now
  if (!n) return;
  show([{ at: ".newchip", ...n }], { then: () => { news = null; app.saveSettings({ news: [...(app.settings.news ?? []), n.id] }); } });
}

/**
 * Shows steps in order. Each is { at?: selector, title, body: html, next?: label, act?: { label, run } }; with no
 * `at` the callout is centred. Steps pointing at something not on screen are skipped. `then` runs when it ends.
 */
export function show(list, { then } = {}) {
  end();
  $("#toast").hidden = true; // it sits where callouts at the foot go
  steps = list; onEnd = then ?? null;
  go("next");
}

export function end() {
  if (!isOpen()) return;
  at = -1; card.hidden = ring.hidden = true;
  const then = onEnd;
  onEnd = null;
  then?.();
}

/** Enter / → next, ← back, esc ends. Returns whether the key was the callout's. */
export function key(k) {
  if (!isOpen()) return false;
  const many = steps.length > 1;
  const to = { Enter: steps[at].act ? "act" : "next", Escape: "end", ...(many ? { ArrowRight: "next", ArrowLeft: "back" } : {}) }[k];
  if (!to) return false;
  go(to);
  return true;
}

const visible = (sel) => { const r = $(sel)?.getBoundingClientRect(); return !!r && r.width > 0 && r.height > 0; };
const shown = (s) => !s.at || visible(s.at);

function go(to) {
  if (to === "end") return end();
  if (to === "act") { const run = steps[at].act.run; end(); return run(); }
  const d = to === "back" ? -1 : 1;
  let i = at + d;
  while (i >= 0 && i < steps.length && !shown(steps[i])) i += d;
  if (i < 0) return;
  if (i >= steps.length) return end();
  const opening = at < 0;
  at = i;
  draw();
  if (opening) { card.classList.add("still"); ring.classList.add("still"); }
  place();
  if (opening) requestAnimationFrame(() => { card.classList.remove("still"); ring.classList.remove("still"); });
}

function draw() {
  const s = steps[at], live = steps.filter(shown), n = live.length, k = live.indexOf(s), last = k === n - 1;
  card.setAttribute("aria-label", s.title);
  const primary = s.act ? `<button class="btn" data-tstep="end">Not now</button><button class="btn primary" data-tstep="act">${esc(s.act.label)}</button>`
    : `<button class="btn primary" data-tstep="next">${esc(s.next ?? (n > 1 && !last ? "Next" : "Got it"))}</button>`;
  card.innerHTML = `${n > 1 ? `<div class="tn"><span>${k + 1} of ${n}</span><span><kbd>enter</kbd> ${last ? "done" : "next"}</span></div>` : ""}
    <h3>${esc(s.title)}</h3><p>${s.body}</p>
    <div class="row">${n > 1 && !last ? `<button class="skip" data-tstep="end" title="esc">Skip tour</button>` : ""}${k > 0 ? `<button class="btn" data-tstep="back">Back</button>` : ""}${primary}</div>`;
  card.hidden = ring.hidden = false;
  card.querySelector(".btn.primary")?.focus({ preventScroll: true });
}

const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));
function place() {
  if (!isOpen()) return;
  const el = steps[at].at && $(steps[at].at);
  const vw = innerWidth, vh = innerHeight, cw = card.offsetWidth, ch = card.offsetHeight, m = 12, gap = 12, pad = 4;
  const px = (o) => Object.fromEntries(Object.entries(o).map(([k, v]) => [k, `${v}px`]));
  ring.classList.toggle("none", !el);
  if (!el) {
    Object.assign(ring.style, px({ left: vw / 2, top: vh / 2, width: 0, height: 0 }));
    return Object.assign(card.style, px({ left: (vw - cw) / 2, top: (vh - ch) / 2 }));
  }
  const r = el.getBoundingClientRect();
  Object.assign(ring.style, px({ left: r.left - pad, top: r.top - pad, width: r.width + pad * 2, height: r.height + pad * 2 }));
  const top = r.height > vh / 2 ? r.bottom - ch - gap * 2 // a big area: inside its foot, clear of the focus in its middle
    : r.bottom + gap + ch <= vh - m ? r.bottom + gap : r.top - gap - ch;
  const left = r.width > vw / 2 ? (vw - cw) / 2 : r.left + (r.width - cw) / 2;
  Object.assign(card.style, px({ left: clamp(left, m, vw - cw - m), top: clamp(top, m, vh - ch - m) }));
}
