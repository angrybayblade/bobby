// The site's light/dark switch: follows the system until you pick one, then remembers your pick. Each page's <head>
// sets data-theme before it paints (the same rule, inline); this keeps it in step and wires the header's button.
(() => {
  const KEY = "bobby-theme", root = document.documentElement, media = matchMedia("(prefers-color-scheme: dark)");
  const saved = () => { try { return localStorage.getItem(KEY); } catch { return null; } };
  function apply(theme) {
    root.dataset.theme = theme;
    document.querySelector('meta[name="theme-color"]')?.setAttribute("content", theme === "dark" ? "#1a1815" : "#f6f2ea");
    for (const b of document.querySelectorAll("[data-theme-toggle]")) b.setAttribute("aria-label", theme === "dark" ? "Switch to light mode" : "Switch to dark mode");
  }
  apply(saved() ?? (media.matches ? "dark" : "light"));
  media.addEventListener("change", (e) => { if (!saved()) apply(e.matches ? "dark" : "light"); });
  document.addEventListener("click", (e) => {
    if (!e.target.closest("[data-theme-toggle]")) return;
    const next = root.dataset.theme === "dark" ? "light" : "dark";
    try { localStorage.setItem(KEY, next); } catch {}
    apply(next);
  });
})();
