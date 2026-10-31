// Tooltips for anything with data-tip: what it is in bold (data-tip), a line on what it does or its state
// (data-tip-more) and its key (data-tip-key). Shown below it on hover or keyboard focus, after a short wait, or at
// once while you move from one to the next; gone on a click, a key or a scroll. One element serves the whole page.
import { esc } from "./core.js";

let el = null, at = null, timer = 0, lastHide = 0;

function show(target) {
  at = target;
  el ??= document.body.appendChild(Object.assign(document.createElement("div"), { className: "tip", role: "tooltip" }));
  const more = target.dataset.tipMore, key = target.dataset.tipKey;
  el.innerHTML = `<b>${esc(target.dataset.tip)}</b>${key ? `<kbd>${esc(key)}</kbd>` : ""}${more ? `<span>${esc(more)}</span>` : ""}`;
  el.classList.add("on");
  const r = target.getBoundingClientRect(), w = el.offsetWidth, h = el.offsetHeight;
  const left = Math.max(8, Math.min(innerWidth - w - 8, r.left + r.width / 2 - w / 2));
  const below = r.bottom + 8 + h < innerHeight;
  el.style.left = `${left}px`;
  el.style.top = `${below ? r.bottom + 8 : r.top - 8 - h}px`;
}
function hide() {
  clearTimeout(timer);
  if (at) lastHide = Date.now();
  at = null;
  el?.classList.remove("on");
}
function enter(ev) {
  const t = ev.target.closest?.("[data-tip]");
  if (!t || t === at) return;
  clearTimeout(timer);
  if (at || Date.now() - lastHide < 400) return show(t); // moving along a row of them: no wait
  timer = setTimeout(() => t.isConnected && show(t), 350);
}
function leave(ev) {
  const t = ev.target.closest?.("[data-tip]");
  if (t && !t.contains(ev.relatedTarget)) hide();
}

document.addEventListener("pointerover", enter);
document.addEventListener("pointerout", leave);
document.addEventListener("focusin", (ev) => { if (ev.target.matches?.(":focus-visible")) enter(ev); });
document.addEventListener("focusout", leave);
for (const e of ["pointerdown", "keydown", "scroll", "blur"]) addEventListener(e, hide, true);
