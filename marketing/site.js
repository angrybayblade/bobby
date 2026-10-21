// The story: scrolling steps through STEPS states of one app. Each piece of it says when it changes:
//   data-out="n"  a GitHub piece, gone from step n on
//   data-in="n"   a Bobby piece, there from step n on (it flashes as it arrives)
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
    .bl { position: absolute; background: var(--bg); transition: opacity .6s cubic-bezier(.2, .7, .2, 1), transform .6s cubic-bezier(.2, .7, .2, 1), filter .6s cubic-bezier(.2, .7, .2, 1); }
    .bl > * { position: relative !important; inset: auto !important; width: 100% !important; height: 100% !important; margin: 0 !important; }
    .bl.overlay, .bl.toast { background: none; }
    .bl.overlay > *, .bl.toast > * { position: absolute !important; inset: 0 !important; }
    .bl[data-in]:not(.shown), .bl[data-at]:not(.shown) { opacity: 0; pointer-events: none; }
    .bl.gone { opacity: 0 !important; transform: translateY(-8px) scale(.985); filter: blur(3px); }
    .bl .later { transition: opacity .6s; }
    .bl .later:not(.now) { opacity: 0; }
    .bl.flash { animation: flash 1.4s cubic-bezier(.2, .7, .2, 1); }
    @keyframes flash { 25% { box-shadow: inset 0 0 0 2px rgba(9, 105, 218, .45); } }
    @media (prefers-reduced-motion: reduce) { .bl, .bl .later { transition: none; } .bl.flash { animation: none; } }`);
  for (const host of document.querySelectorAll("[data-bobby]")) {
    const shadow = host.attachShadow({ mode: "open" });
    shadow.adoptedStyleSheets = [sheet];
    const root = document.createElement("div");
    root.className = "root";
    for (const [k, v] of Object.entries(r.attrs)) root.setAttribute(k, v);
    root.setAttribute("style", r.style);
    for (const bl of [...host.children]) {
      const part = states[bl.dataset.state]?.[bl.dataset.region];
      if (!part) { console.warn("no capture for", bl.dataset.state, bl.dataset.region); bl.remove(); continue; }
      const [x, y, w, h] = part.box;
      bl.classList.add(bl.dataset.region);
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
/** Every piece of the story, in the page and in Bobby's shadow root. */
const pieces = (sel) => [...app.querySelectorAll(sel), ...shadows.flatMap((s) => [...s.querySelectorAll(sel)])];

// ---- the app scaled to fit what's left of the stage
function fit() {
  const w = viewport.clientWidth, h = viewport.clientHeight;
  const scale = Math.max(0.15, Math.min(w / W, h / H, 1));
  frame.style.setProperty("--scale", scale);
  app.style.setProperty("--scale", scale);
}
new ResizeObserver(fit).observe(viewport);

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
function show(n) {
  if (n === step) return;
  const forward = n > step;
  step = n;
  for (let i = 1; i < STEPS; i++) app.classList.toggle(`s${i}`, i <= n);
  for (const el of pieces("[data-out]")) el.classList.toggle("gone", n >= Number(el.dataset.out));
  for (const el of pieces("[data-at]")) el.classList.toggle("shown", n === Number(el.dataset.at));
  for (const bl of pieces(".bl[data-later]")) for (const el of bl.querySelectorAll(".later")) el.classList.toggle("now", n >= Number(bl.dataset.laterIn));
  for (const el of pieces("[data-in]")) {
    const at = Number(el.dataset.in), was = el.classList.contains("shown");
    el.classList.toggle("shown", n >= at);
    if (forward && !was && n === at && !reduceMotion) { // just arrived: flash it
      el.classList.remove("flash"); void el.offsetWidth; el.classList.add("flash");
    }
  }
  caps.forEach((c, i) => c.classList.toggle("on", i === n));
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
