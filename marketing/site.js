// The story: scrolling steps through STEPS states of one app. Each piece of it says when it changes:
//   data-out="n"  a GitHub piece, gone from step n on
//   data-in="n"   a Bobby piece, there from step n on (it settles in as it arrives)
//   data-at="n"   a moment, there only at step n
// and the app carries s1…sN (every step reached) for the layout to move with.
const story = document.querySelector("[data-story]");
const app = document.querySelector("[data-app]");
const frame = document.querySelector(".frame");
const viewport = document.querySelector(".viewport");
const caps = [...document.querySelectorAll("[data-cap]")];
const STEPS = caps.length;
const PER_STEP = 0.7; // of the window's height, scrolled per step
const reduceMotion = matchMedia("(prefers-reduced-motion: reduce)").matches;
const [W, H] = window.BOBBY.size; // the app's design size: the size Bobby was captured at

// ---- Bobby's pieces: regions of the real app, captured state by state (bobby.js). Each .bl names a state and a
// region; it's drawn in a shadow root with the app's own CSS, so the two pages' styles never meet.
const shadows = [];
{
  const { root: r, css, states } = window.BOBBY;
  const sheet = new CSSStyleSheet(); // the app's CSS, shared by every layer of Bobby
  sheet.replaceSync(`${css}
    .root { display: block !important; position: absolute !important; inset: 0; width: ${W}px; height: ${H}px; overflow: hidden !important; background: transparent !important; }
    .root.root.root { --line: #bcc5ce; --line-soft: #d5dce3; }
    .root.root.root .dv { --shadow: 0 1px 2px rgba(31, 35, 40, .05), 0 4px 12px rgba(31, 35, 40, .05); } /* the Diff viewers sit lighter on the page */
    .root.root.root .lens { --shadow: 0 1px 2px rgba(31, 35, 40, .05), 0 6px 18px rgba(31, 35, 40, .06); } /* and so does Lens's card */
    .root.root.root .lens:not(.filled) .focus { border-width: 1px; }
    .root.root.root .dv .fv.w-focus { box-shadow: 0 1px 2px rgba(31, 35, 40, .06), 0 6px 18px rgba(31, 35, 40, .08); } /* a shade darker than the app's, to hold up when scaled down */
    .bl { --ease: cubic-bezier(.4, 0, .2, 1); --move: cubic-bezier(.65, 0, .35, 1); position: absolute; background: var(--bg); transition: opacity .7s var(--ease), transform .8s var(--move); }
    .bl > * { position: relative !important; inset: auto !important; width: 100% !important; height: 100% !important; margin: 0 !important; }
    .bl.is-overlay, .bl.is-toast, .bl.is-inspector { background: none; }
    .bl:is(.is-top, .is-where, .is-files, .is-keys) { z-index: 1; } /* the frame stays over the view, as a zoom spills past it */
    .bl.is-overlay > *, .bl.is-toast > *, .bl.is-inspector > * { position: absolute !important; inset: 0 !important; }
    .bl[data-in]:not(.shown), .bl[data-at]:not(.shown) { opacity: 0; pointer-events: none; transform: translateY(8px) scale(.985); }
    .bl.gone { opacity: 0 !important; transform: scale(.985); }
    .bl.swap, .bl.swap.gone, .bl.swap:not(.shown) { transform: none; } /* one capture taking over from another: no move */
    .bl .later { transition: opacity .6s; }
    .bl .later:not(.now) { opacity: 0; }
    /* what just arrived: a soft lift that settles, no colour */
    .bl.arrive { animation: arrive 1.6s var(--ease); }
    @keyframes arrive { 0% { box-shadow: 0 0 0 rgba(31, 35, 40, 0); } 35% { box-shadow: 0 14px 36px -12px rgba(31, 35, 40, .2); } 100% { box-shadow: 0 0 0 rgba(31, 35, 40, 0); } }
    /* GitHub's files land on the canvas, and it comes up under them */
    .bl[data-zoom] { transition: opacity .8s var(--ease), transform 1.1s var(--move); }
    .bl[data-zoom]:not(.gone) { transition: opacity .3s var(--ease), transform 1.1s var(--move); transform: none; }
    .bl[data-zoom] .world > :not(.fv) { transition: opacity .2s var(--ease); }
    .bl[data-zoom]:not(.shown) .world > :not(.fv) { opacity: 0; }
    .bl[data-zoom].unmorph:not(.shown) { transition: opacity .35s var(--ease) 1.05s; } /* out: once its files are back on GitHub's */
    .bl[data-zoom].shown .world > :not(.fv) { transition: opacity .5s var(--ease) 1s; } /* the edges and lanes, once the files land */
    /* then it zooms into one file, whose focused view grows out of the same spot */
    .bl[data-zoom].gone { transform: var(--zoom-out, scale(2.5)); transition: opacity .6s var(--ease) .35s, transform 1.1s var(--move); }
    .bl[data-zoom] .fv.w-focus { transition: box-shadow .3s var(--ease); }
    .bl[data-zoom].gone .fv.w-focus { box-shadow: none; } /* scaled up, its drop shadow would swell into a halo */
    /* Bobby's tree in step 2: the panel fades in, each row shows as GitHub's row lands on it */
    .bl[data-fly-to], .bl[data-fly-to]:not(.shown), .bl[data-fly-to].gone { transform: none; }
    .bl[data-fly-to].shown:not(.gone) :is(.fdir, .frow, .fhd input) { transition: opacity .3s var(--ease) calc(.8s + var(--i, 0) * 25ms); }
    .bl[data-fly-to]:not(.shown) :is(.fdir, .frow, .fhd input) { opacity: 0; transition: opacity .2s var(--ease); }
    .bl[data-zoom-from] { transition: opacity .55s var(--ease), transform 1.1s var(--move); }
    .bl[data-zoom-from]:not(.shown) { transform: var(--zoom-in, scale(.4)); }
    @media (prefers-reduced-motion: reduce) { .bl, .bl .later { transition: none !important; } .bl.arrive { animation: none; } }`);
  for (const host of document.querySelectorAll("[data-bobby]")) {
    const shadow = host.attachShadow({ mode: "open" });
    shadow.adoptedStyleSheets = [sheet];
    const root = document.createElement("div");
    root.className = "root";
    for (const [k, v] of Object.entries(r.attrs)) root.setAttribute(k, v);
    root.dataset.motion = "on"; // captured still (motion off), but the app's CSS would then stop every transition here
    root.setAttribute("style", r.style);
    for (const bl of [...host.children]) {
      const part = states[bl.dataset.state]?.[bl.dataset.region];
      if (!part) { console.warn("no capture for", bl.dataset.state, bl.dataset.region); bl.remove(); continue; }
      const [x, y, w, h] = part.box;
      bl.classList.add(`is-${bl.dataset.region}`); // not the bare name: the app has classes like .view
      Object.assign(bl.style, { left: `${x}px`, top: `${y}px`, width: `${w}px`, height: `${h}px` });
      bl.innerHTML = part.html;
      if (bl.dataset.later) for (const el of bl.querySelectorAll(bl.dataset.later)) el.classList.add("later");
      root.append(bl);
    }
    shadow.append(root);
    shadows.push(shadow);
  }
  // outerHTML loses scroll positions: put them back
  requestAnimationFrame(() => {
    for (const el of shadows.flatMap((s) => [...s.querySelectorAll("[data-scroll]")])) { const [t, l] = el.dataset.scroll.split(",").map(Number); el.scrollTop = t; el.scrollLeft = l; }
  });
}
// ---- the moves between GitHub's list and Bobby's canvas, measured on the rendered pages (in design pixels)
const scaleNow = () => Number(getComputedStyle(app).getPropertyValue("--scale")) || 1;
const boxIn = (el) => { // el's box in the app's own pixels
  const a = app.getBoundingClientRect(), b = el.getBoundingClientRect(), k = scaleNow();
  return { x: (b.left - a.left) / k, y: (b.top - a.top) / k, w: b.width / k, h: b.height / k };
};
/** The viewer of `path` in a captured Diff layer. */
const viewer = (layer, path) => layer?.querySelector(`.fvh[data-handle="${CSS.escape(path)}"]`)?.closest(".fv, .fvw") ?? layer?.querySelector(`.fvh[data-handle="${CSS.escape(path)}"]`)?.parentElement;
const layerOf = (sel) => shadows.map((sh) => sh.querySelector(sel)).find(Boolean);
/** Runs measure() with els untransformed and still (no transitions), then restores them without animating back. */
function still(els, measure) {
  const saved = els.map((el) => [el.style.transition, el.style.transform]);
  for (const el of els) { el.style.transition = "none"; el.style.transform = "none"; }
  const out = measure();
  els.forEach((el, i) => { el.style.transform = saved[i][1]; });
  void app.offsetWidth; // apply the restored transforms before transitions come back
  els.forEach((el, i) => { el.style.transition = saved[i][0]; });
  return out;
}
/** Step 3: GitHub's files become the canvas. Each file's viewer on the canvas starts where the file sits in GitHub's
 *  list, at its size, and glides to its own place; GitHub's file dissolves into it as it sets off, so there's one of
 *  each the whole way. The starts are measured once (and on resize), never while a step changes. */
let starts = [];
function measureMoves() {
  const list = app.querySelector("[data-morph]"), canvas = layerOf(".bl[data-zoom]");
  if (!list || !canvas) return;
  const files = [...list.querySelectorAll(".file")], was = app.className;
  const views = files.map((f) => viewer(canvas, f.querySelector("header b")?.textContent.trim()));
  for (const v of views) if (v) { v.dataset.home ??= v.style.transform; v.style.transform = v.dataset.home; }
  starts = still([list, canvas, ...files], () => {
    // GitHub's list as it is at the step before the move, whatever step this is
    for (let i = 1; i < STEPS; i++) app.classList.toggle(`s${i}`, i < MORPH);
    const out = files.map((f, i) => {
      const v = views[i], at = /translate\(([-\d.]+)px,\s*([-\d.]+)px\)/.exec(v?.dataset.home ?? "");
      if (!v || !at) return null;
      // the viewer's world: its scale, and where its origin sits in the app
      const b = boxIn(v), k = b.w / v.offsetWidth, ox = b.x - Number(at[1]) * k, oy = b.y - Number(at[2]) * k;
      const a = boxIn(f);
      return { v, f, from: `translate(${(a.x - ox) / k}px, ${(a.y - oy) / k}px) scale(${a.w / b.w})` }; // one scale: no squashed text
    });
    app.className = was;
    return out.filter(Boolean);
  });
  starts.forEach(({ f }, i) => f.style.setProperty("--i", i)); // so each file shows as its own viewer lands
}
/** "in": into the canvas, the viewers start on GitHub's files and glide home. "back": out of it, they glide back onto
 *  the files (and the files fade in under them as they land). "home": simply home. */
function morph(mode) {
  starts.forEach(({ v, from }, i) => {
    v.style.transformOrigin = "0 0";
    if (mode === "home") { v.style.transition = "none"; v.style.transform = v.dataset.home; return; }
    if (mode === "in") { v.style.transition = "none"; v.style.transform = from; void v.offsetWidth; }
    v.style.transition = `transform 1s var(--move) ${i * 35}ms`;
    v.style.transform = mode === "in" ? v.dataset.home : from;
  });
}
/** Step 2: each row of GitHub's file tree flies onto the row of the same name in Bobby's, matched by name. */
function measureFly() {
  const tree = app.querySelector("[data-fly]"), to = layerOf(".bl[data-fly-to]");
  if (!tree || !to) return;
  const targets = new Map();
  for (const el of to.querySelectorAll(".fdir > span:last-child, .ffile .nm")) targets.set(el.textContent.trim(), el);
  const rows = [...tree.querySelectorAll(".t, .filter")], was = app.className;
  const size = (el) => parseFloat(getComputedStyle(el).fontSize);
  still([tree, to, ...rows], () => {
    for (let i = 1; i < STEPS; i++) app.classList.toggle(`s${i}`, i < Number(tree.dataset.out));
    let i = 0;
    for (const row of rows) {
      const nm = row.querySelector(".nm") ?? row, t = row.matches(".filter") ? to.querySelector(".fhd input") : targets.get(nm.textContent.trim());
      row.style.removeProperty("--fly");
      if (!t) continue;
      // scale by the type sizes, and carry the name's start onto the target's (the row turns about its top left)
      const o = boxIn(row), a = boxIn(nm), b = boxIn(t), k = row.matches(".filter") ? b.h / o.h : size(t) / size(nm);
      const dx = b.x - o.x - k * (a.x - o.x), dy = b.y + b.h / 2 - o.y - k * (a.y + a.h / 2 - o.y);
      row.style.setProperty("--fly", `translate(${dx}px, ${dy}px) scale(${k})`);
      row.style.setProperty("--i", i); (t.closest(".fdir, .frow") ?? t).style.setProperty("--i", i); i++;
    }
    app.className = was;
  });
}
/** Step 4: the canvas zooms into one file, and that file's focused view grows out of the same spot. */
function zoom() {
  const canvas = layerOf(".bl[data-zoom]"), focus = layerOf(".bl[data-zoom-from]");
  if (!canvas || !focus) return;
  const path = canvas.dataset.zoom;
  still([canvas, focus], () => {
    const small = viewer(canvas, path), big = viewer(focus, path);
    if (!small || !big) return;
    const a = boxIn(small), b = boxIn(big), c = boxIn(canvas), f = boxIn(focus), k = b.w / a.w;
    // the canvas scales by k about the point that takes the small viewer onto the big one
    const px = (b.x - k * a.x) / (1 - k), py = (b.y - k * a.y) / (1 - k);
    canvas.style.transformOrigin = `${px - c.x}px ${py - c.y}px`;
    canvas.style.setProperty("--zoom-out", `scale(${k})`);
    // and the focused view starts as the small viewer: scaled by 1/k about the same point
    focus.style.transformOrigin = `${px - f.x}px ${py - f.y}px`;
    focus.style.setProperty("--zoom-in", `scale(${1 / k})`);
  });
}

/** Every piece of the story, in the page and in Bobby's shadow root. */
const pieces = (sel) => [...app.querySelectorAll(sel), ...shadows.flatMap((s) => [...s.querySelectorAll(sel)])];

// ---- the app scaled to fit what's left of the stage
function fit() {
  const w = viewport.clientWidth, h = viewport.clientHeight;
  const scale = Math.max(0.15, Math.min(w / W, h / H, 1));
  frame.style.setProperty("--scale", scale);
  app.style.setProperty("--scale", scale);
}
new ResizeObserver(() => {
  fit();
  requestAnimationFrame(() => { // measured on the page as drawn at this size; applied without animating
    measureMoves(); morph("home"); zoom(); measureFly(); // the zoom is measured with the viewers home
  });
}).observe(viewport);

// ---- the scroller: one stretch per step
const dotsEl = document.querySelector(".steps .dots");
dotsEl.innerHTML = caps.map((_, i) => `<button type="button" data-goto="${i}" aria-label="Step ${i + 1}"></button>`).join("");
const dots = [...dotsEl.children];
const travel = () => story.offsetHeight - innerHeight;
/** Where step i sits: the middle of its stretch. */
const stepTop = (i) => story.offsetTop + Math.round((travel() * (i + 0.5)) / STEPS);
function layout() {
  story.style.height = `${(STEPS * PER_STEP + 1) * innerHeight}px`;
}

// ---- the state at a step
let step = -1;
const MORPH = Number(document.querySelector("[data-morph]")?.dataset.out ?? Infinity) - 1; // the step GitHub's files fly to the canvas
/** Is a piece on screen at step n? */
const visibleAt = (el, n) => el.dataset.at != null ? n === Number(el.dataset.at)
  : n >= Number(el.dataset.in ?? 0) && !(el.dataset.out != null && n >= Number(el.dataset.out));
/** Where one capture of a region takes over from another (the bar, the view…), cross-fade without a dip or a ghost:
 *  the upper layer fades while the lower one switches at once, underneath it. Only a region's first arrival moves. */
function swaps(n) {
  const groups = new Map();
  for (const bl of pieces(".bl")) {
    if (bl.dataset.zoom != null || bl.dataset.zoomFrom != null) continue; // the zoom has its own moves
    bl.style.transition = ""; bl.classList.remove("swap");
    const key = `${shadows.indexOf(bl.getRootNode())}:${bl.dataset.region}`;
    groups.set(key, [...(groups.get(key) ?? []), bl]);
  }
  for (const layers of groups.values()) {
    const coming = layers.filter((bl) => visibleAt(bl, n) && !visibleAt(bl, step));
    const going = layers.filter((bl) => !visibleAt(bl, n) && visibleAt(bl, step));
    if (!coming.length || !going.length) continue;
    for (const bl of [...coming, ...going]) { bl.classList.add("swap"); bl.style.transition = "opacity .45s cubic-bezier(.4, 0, .2, 1), transform 0s"; } // a quick dissolve: two screens blended read as noise
    for (const c of coming) for (const g of going) {
      const cAbove = c.compareDocumentPosition(g) & Node.DOCUMENT_POSITION_PRECEDING;
      if (cAbove) g.style.transition = "opacity 0s linear .45s, transform 0s"; // covered first, then gone
      else c.style.transition = "opacity 0s, transform 0s"; // already there when the one above fades
    }
  }
}

function show(n) {
  if (n === step) return;
  const forward = n > step;
  if (step >= 0 && !reduceMotion) swaps(n);
  // back out of the canvas onto GitHub's list: the canvas stays until its files have landed
  const unmorph = !forward && step === MORPH && n === MORPH - 1 && !reduceMotion;
  app.classList.toggle("unmorph", unmorph);
  layerOf(".bl[data-zoom]")?.classList.toggle("unmorph", unmorph);
  step = n;
  for (let i = 1; i < STEPS; i++) app.classList.toggle(`s${i}`, i <= n);
  for (const el of pieces("[data-out]")) el.classList.toggle("gone", n >= Number(el.dataset.out));
  for (const el of pieces("[data-at]")) el.classList.toggle("shown", n === Number(el.dataset.at));
  for (const bl of pieces(".bl[data-later]")) for (const el of bl.querySelectorAll(".later")) el.classList.toggle("now", n >= Number(bl.dataset.laterIn));
  for (const el of pieces("[data-in]")) {
    const at = Number(el.dataset.in), was = el.classList.contains("shown");
    el.classList.toggle("shown", n >= at);
    if (forward && !was && n === at && !reduceMotion && !el.classList.contains("swap") && el.dataset.zoom == null && el.dataset.zoomFrom == null && el.dataset.flyTo == null) { // new here: let it settle in
      el.classList.remove("arrive"); void el.offsetWidth; el.classList.add("arrive");
    }
  }
  if (forward && n === MORPH && !reduceMotion) morph("in");
  else if (unmorph) morph("back");
  else if (n >= MORPH) morph("home");
  caps.forEach((c, i) => c.classList.toggle("on", i === n));
  document.dispatchEvent(new CustomEvent("story:step", { detail: n }));
  dots.forEach((d, i) => { d.classList.toggle("on", i === n); d.classList.toggle("done", i < n); });
}
function onScroll() {
  const p = Math.min(1, Math.max(0, (scrollY - story.offsetTop) / Math.max(1, travel())));
  show(Math.min(STEPS - 1, Math.floor(p * STEPS)));
}

function go(n) {
  const i = Math.max(0, Math.min(STEPS - 1, n));
  scrollTo({ top: stepTop(i), behavior: reduceMotion ? "auto" : "smooth" });
}
document.addEventListener("click", (ev) => {
  const t = ev.target.closest("[data-goto]");
  if (!t) return;
  ev.preventDefault();
  const g = t.dataset.goto;
  go(g === "next" ? step + 1 : g === "prev" ? step - 1 : Number(g));
});
// j / k, as in Bobby (and the arrows)
document.addEventListener("keydown", (ev) => {
  if (ev.metaKey || ev.ctrlKey || ev.altKey || ev.target.closest("input, textarea")) return;
  const inStory = scrollY < story.offsetTop + travel() + 10;
  if (!inStory) return;
  if (ev.key === "j" || ev.key === "ArrowDown") { ev.preventDefault(); go(step + 1); }
  else if (ev.key === "k" || ev.key === "ArrowUp") { ev.preventDefault(); go(step - 1); }
});

addEventListener("scroll", onScroll, { passive: true });
addEventListener("resize", () => { layout(); onScroll(); });
layout();
fit();
onScroll();
if (location.hash === "#install") go(STEPS - 1);

// ---- copy the install command
const toast = document.querySelector(".toast");
let toastTimer;
for (const button of document.querySelectorAll("[data-copy]")) {
  button.addEventListener("click", async () => {
    const text = button.dataset.copy;
    try { await navigator.clipboard.writeText(text); }
    catch {
      const t = Object.assign(document.createElement("textarea"), { value: text });
      t.style.cssText = "position:fixed;opacity:0";
      document.body.append(t); t.select(); document.execCommand("copy"); t.remove();
    }
    button.textContent = "Copied";
    setTimeout(() => { button.textContent = "Copy"; }, 1500);
    toast.classList.add("show");
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => toast.classList.remove("show"), 1800);
  });
}
