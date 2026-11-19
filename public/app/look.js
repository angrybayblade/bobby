// Before the first paint, on every page: your style, theme and motion (main.js and home.js remember them), or before
// you've chosen any (a first launch, its setup page included), the defaults: GitHub's colours, light or dark as the system
// is. Bobby's warm palette is one you pick. A plain script, not a module, so it runs before anything is drawn; the
// Content-Security-Policy allows no inline ones.
{
  let l = {};
  try { l = JSON.parse(localStorage.getItem("bobby.look") || "null") ?? {}; } catch { /* private window */ }
  const r = document.documentElement;
  r.dataset.palette = ["warm", "silverpoint"].includes(l.palette) ? l.palette : "github";
  r.dataset.theme = l.theme === "system" || !l.theme ? (matchMedia("(prefers-color-scheme: light)").matches ? "light" : "dark") : l.theme;
  r.dataset.motion = l.motion === "system" || !l.motion ? (matchMedia("(prefers-reduced-motion: reduce)").matches ? "off" : "on") : l.motion;
  /** The web fonts a look uses, asked of Google Fonts only then, and without holding the page up for the answer: a
   *  stylesheet in the page's head stops everything behind it until it's back (200 ms, or far longer offline), and
   *  GitHub's style in the system's font, the default, uses none. Called again when your settings change. */
  window.bobbyFonts = (look) => {
    const own = ["warm", "silverpoint"].includes(look.palette), font = look.font;
    const families = [
      font === "hyper" && "Atkinson+Hyperlegible:wght@400;700",
      (own || font === "hyper") && "Inter:wght@400;500;600;700",
      (own || font === "mono") && "JetBrains+Mono:wght@400;600",
      font === "serif" && "Literata:opsz,wght@7..72,400;7..72,600",
    ].filter(Boolean);
    for (const f of families) {
      const href = `https://fonts.googleapis.com/css2?family=${f}&display=swap`;
      if (document.head.querySelector(`link[href="${href}"]`)) continue;
      document.head.append(Object.assign(document.createElement("link"), { rel: "stylesheet", href }));
    }
  };
  window.bobbyFonts(l);
}
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
