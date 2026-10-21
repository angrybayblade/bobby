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

// ---- the app scaled to fit what's left of the stage
function fit() {
  const w = viewport.clientWidth, h = viewport.clientHeight;
  const scale = Math.max(0.2, Math.min(w / 1040, h / 660, 1.25));
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
  for (const el of app.querySelectorAll("[data-out]")) el.classList.toggle("gone", n >= Number(el.dataset.out));
  for (const el of app.querySelectorAll("[data-at]")) el.classList.toggle("shown", n === Number(el.dataset.at));
  for (const el of app.querySelectorAll("[data-in]")) {
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
