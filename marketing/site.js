const body = document.body;
const experience = document.querySelector("[data-experience]");
const dots = [...document.querySelectorAll(".chapter-dots i")];
const toast = document.querySelector(".copy-toast");
const reduceMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
const phases = ["land", "noise", "spotlight", "map", "focus", "return", "install"];
let toastTimer;

requestAnimationFrame(() => {
  requestAnimationFrame(() => body.classList.add("loaded"));
});

window.setTimeout(() => {
  body.classList.remove("preload", "loaded");
}, reduceMotion ? 0 : 2300);

function smoothstep(from, to, value) {
  const amount = Math.min(1, Math.max(0, (value - from) / (to - from)));
  return amount * amount * (3 - 2 * amount);
}

function bell(value, inFrom, inTo, outFrom, outTo) {
  return smoothstep(inFrom, inTo, value) * (1 - smoothstep(outFrom, outTo, value));
}

function updateExperience() {
  if (!experience || reduceMotion) return;

  const rect = experience.getBoundingClientRect();
  const travel = Math.max(1, experience.offsetHeight - window.innerHeight);
  const progress = Math.min(1, Math.max(0, -rect.top / travel));
  const sideExit = smoothstep(.17, .37, progress);
  const githubExit = smoothstep(.34, .64, progress);
  const primaryFocus = smoothstep(.2, .42, progress);

  let phaseIndex = 0;
  if (progress >= .1) phaseIndex = 1;
  if (progress >= .25) phaseIndex = 2;
  if (progress >= .42) phaseIndex = 3;
  if (progress >= .64) phaseIndex = 4;
  if (progress >= .82) phaseIndex = 5;
  if (progress >= .93) phaseIndex = 6;

  experience.dataset.phase = phases[phaseIndex];
  experience.style.setProperty("--github-opacity", (1 - githubExit).toFixed(3));
  experience.style.setProperty("--side-opacity", (1 - sideExit).toFixed(3));
  experience.style.setProperty("--side-shift", `${(sideExit * 95).toFixed(1)}px`);
  experience.style.setProperty("--side-shift-neg", `${(-sideExit * 95).toFixed(1)}px`);
  experience.style.setProperty("--noise-opacity", (1 - smoothstep(.1, .28, progress)).toFixed(3));
  experience.style.setProperty("--primary-scale", (1 + primaryFocus * .13).toFixed(3));
  experience.style.setProperty("--spotlight-opacity", bell(progress, .22, .3, .38, .48).toFixed(3));
  experience.style.setProperty("--map-opacity", bell(progress, .4, .51, .62, .75).toFixed(3));
  experience.style.setProperty("--bobby-opacity", bell(progress, .62, .76, .83, .91).toFixed(3));
  experience.style.setProperty("--return-opacity", bell(progress, .81, .88, .92, .97).toFixed(3));
  experience.style.setProperty("--install-opacity", smoothstep(.92, .985, progress).toFixed(3));
  experience.style.setProperty("--scroll-cue", (1 - smoothstep(.03, .1, progress)).toFixed(3));
  dots.forEach((dot, index) => dot.classList.toggle("on", index === phaseIndex));
}

if (experience && !reduceMotion) {
  window.addEventListener("scroll", updateExperience, { passive: true });
  window.addEventListener("resize", updateExperience);
  updateExperience();
}

if (!reduceMotion && window.Lenis) {
  const lenis = new window.Lenis({
    autoRaf: true,
    anchors: true,
    stopInertiaOnNavigate: true,
  });
  lenis.on("scroll", updateExperience);
}

for (const button of document.querySelectorAll("[data-copy]")) {
  button.addEventListener("click", async () => {
    try {
      await navigator.clipboard.writeText(button.dataset.copy);
    } catch {
      const input = document.createElement("textarea");
      input.value = button.dataset.copy;
      input.setAttribute("readonly", "");
      input.style.position = "fixed";
      input.style.opacity = "0";
      document.body.appendChild(input);
      input.select();
      document.execCommand("copy");
      input.remove();
    }
    button.textContent = "Copied";
    window.setTimeout(() => { button.textContent = "Copy"; }, 1500);
    toast.classList.add("show");
    window.clearTimeout(toastTimer);
    toastTimer = window.setTimeout(() => toast.classList.remove("show"), 1800);
  });
}
