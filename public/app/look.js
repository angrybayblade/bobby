// Before the first paint, on every page: your style, theme and motion (main.js and home.js remember them), not the defaults.
// A plain script, not a module, so it runs before anything is drawn; the Content-Security-Policy allows no inline ones.
try {
  const l = JSON.parse(localStorage.getItem("bobby.look") || "null"), r = document.documentElement;
  if (l) {
    r.dataset.palette = ["warm", "silverpoint"].includes(l.palette) ? l.palette : "github";
    r.dataset.theme = l.theme === "system" || !l.theme ? (matchMedia("(prefers-color-scheme: light)").matches ? "light" : "dark") : l.theme;
    r.dataset.motion = l.motion === "system" || !l.motion ? (matchMedia("(prefers-reduced-motion: reduce)").matches ? "off" : "on") : l.motion;
  }
} catch { /* private window */ }
// An avatar that can't load: hidden (data-av), or gone (data-av="remove"). Load errors don't bubble, so they're caught
// on the way down; one that failed before it was put on the page (built apart, then added) is caught as it's added.
const failed = (img) => { if (img.dataset.av === "remove") img.remove(); else img.style.visibility = "hidden"; };
document.addEventListener("error", (ev) => {
  if (ev.target instanceof HTMLImageElement && "av" in ev.target.dataset) failed(ev.target);
}, true);
new MutationObserver((records) => {
  for (const r of records) for (const n of r.addedNodes) {
    if (n.nodeType !== 1) continue;
    for (const img of n.matches("img[data-av]") ? [n] : n.querySelectorAll("img[data-av]")) if (img.complete && !img.naturalWidth) failed(img);
  }
}).observe(document.documentElement, { childList: true, subtree: true });
