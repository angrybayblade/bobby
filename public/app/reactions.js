// Reactions on GitHub comments, as on github.com: the ones a comment has, with how many (yours highlighted; a click
// takes yours back or adds it), and a button for the eight GitHub has. Each is sent at once; the comment's reactions
// come back and replace what's shown.
import { api, esc } from "./core.js";

export const KINDS = [["THUMBS_UP", "👍", "+1"], ["THUMBS_DOWN", "👎", "-1"], ["LAUGH", "😄", "Laugh"], ["HOORAY", "🎉", "Hooray"], ["CONFUSED", "😕", "Confused"], ["HEART", "❤️", "Heart"], ["ROCKET", "🚀", "Rocket"], ["EYES", "👀", "Eyes"]];
const FACE = `<svg viewBox="0 0 16 16" width="14" height="14" aria-hidden="true"><path fill="currentColor" d="M8 0a8 8 0 1 1 0 16A8 8 0 0 1 8 0ZM1.5 8a6.5 6.5 0 1 0 13 0 6.5 6.5 0 0 0-13 0Zm3.82 1.636a.75.75 0 0 1 1.038.175l.007.009c.103.118.22.222.35.31.264.178.683.37 1.285.37.602 0 1.02-.192 1.285-.371.13-.088.247-.192.35-.31l.007-.008a.75.75 0 0 1 1.222.87l-.022-.015c.02.013.021.015.021.015v.001l-.001.002-.002.003-.005.007-.014.019a2.066 2.066 0 0 1-.184.213c-.16.166-.338.316-.53.445-.63.418-1.37.638-2.127.629-.946 0-1.652-.308-2.126-.63a3.331 3.331 0 0 1-.715-.657l-.014-.02-.005-.006-.002-.003v-.002h-.001l.613-.432-.614.43a.75.75 0 0 1 .183-1.044ZM12 7a1 1 0 1 1-2 0 1 1 0 0 1 2 0ZM5 8a1 1 0 1 1 0-2 1 1 0 0 1 0 2Z"/></svg>`;

/** A comment's reactions as HTML: its chips, then the button that opens the picker. node: what it's on (GraphQL id). */
export function reactionsHtml(node, list = []) {
  if (!node) return "";
  const has = new Map(list.map((r) => [r.content, r]));
  const chips = KINDS.filter(([k]) => has.get(k)?.count).map(([k, emoji, name]) => {
    const r = has.get(k);
    return `<button class="crx${r.mine ? " on" : ""}" data-react="${esc(node)}" data-content="${k}" data-on="${r.mine ? 0 : 1}" title="${esc(name)}${r.mine ? " · you reacted; click to take it back" : ""}">${emoji}<span>${r.count}</span></button>`;
  }).join("");
  const pick = KINDS.map(([k, emoji, name]) => `<button class="crp${has.get(k)?.mine ? " on" : ""}" data-react="${esc(node)}" data-content="${k}" data-on="${has.get(k)?.mine ? 0 : 1}" title="${esc(name)}">${emoji}</button>`).join("");
  return `<div class="creacts">${chips}<span class="crwrap"><button class="crpick" data-rpick aria-label="Add a reaction" title="Add a reaction">${FACE}</button><span class="crmenu" role="menu">${pick}</span></span></div>`;
}

/** Handles a click in a reactions row; true if it was one. done(node, reactions) puts the answer where it's kept. */
export function reactionClick(ev, done) {
  const pick = ev.target.closest("[data-rpick]");
  if (pick) {
    const wrap = pick.parentElement, opening = !wrap.classList.contains("open");
    document.querySelectorAll(".crwrap.open").forEach((w) => w.classList.remove("open"));
    wrap.classList.toggle("open", opening);
    return true;
  }
  const b = ev.target.closest("[data-react]");
  if (!b) return false;
  b.closest(".crwrap")?.classList.remove("open");
  b.disabled = true;
  api("/api/react", { subject: b.dataset.react, content: b.dataset.content, on: b.dataset.on === "1" })
    .then((r) => { if (!r.ok) throw new Error(r.error); done(b.dataset.react, r.reactions); })
    .catch((e) => { b.disabled = false; window.bobby?.toast?.(`<span>Couldn't react: ${esc(e.message)}</span>`, 6000); });
  return true;
}
// a click anywhere else closes an open picker
document.addEventListener("click", (ev) => { if (!ev.target.closest(".crwrap")) document.querySelectorAll(".crwrap.open").forEach((w) => w.classList.remove("open")); });
