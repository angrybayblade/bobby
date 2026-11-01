// The PR's stack (stack.ts): the PRs it sits on and the ones built on it. In the where-bar, its place in the stack with
// the PRs below and above a click away; in a dialog, every layer with its state and how far you got in its review, and,
// unless GitHub defines the stack, a list to define it yourself: PRs by number or link, in order. Kept in Bobby only.
import { api, esc } from "./core.js";

let app, dialog, close, toast, render;
let editing = null; // the numbers being edited, top first, while the dialog is in its editing state

export function initStack(a, ui) {
  app = a;
  ({ dialog, close, toast, render } = ui);
  app.stack = null;
  if (app.graph.pr.provider !== "local") load();
}
async function load(fresh = false) {
  const r = await api(`/api/stack${fresh ? "?fresh" : ""}`).catch(() => null);
  if (!r) return;
  app.stack = r.stack;
  render();
}

/** Its place in the stack, for the where-bar: ‹ the PR below, the stack's dialog, the PR above ›. */
export function stackCrumb() {
  const s = app?.stack;
  if (!s) return "";
  const below = s.layers[s.at - 1], above = s.layers[s.at + 1];
  const go = (l, glyph, where) => l
    ? `<button class="stk-go" data-stack-go="${l.number}" data-tip="${where}: #${l.number}" data-tip-more="${esc(l.title)}" aria-label="${where}: #${l.number}">${glyph}</button>`
    : `<button class="stk-go" disabled aria-hidden="true">${glyph}</button>`;
  return `<span class="stk">${go(below, "‹", "The PR below")}<button data-act="stack" data-tip="Stack" data-tip-more="${esc(`${s.layers.length} PRs on ${s.trunk}, ${SOURCE[s.source]}`)}">Stack ${s.at + 1}/${s.layers.length}</button>${go(above, "›", "The PR above")}</span>`;
}
const SOURCE = { github: "GitHub's stack", yours: "defined by you", branches: "followed through branches" };

/** Opens the review of the PR at this number, in this repo. */
export async function goTo(n) {
  const l = app.stack?.layers.find((x) => x.number === n);
  const url = l?.url ?? `https://github.com/${app.graph.pr.owner}/${app.graph.pr.repo}/pull/${n}`;
  if (n === app.graph.pr.number) return close();
  toast(`<span>Opening #${n}…</span>`);
  try {
    const r = await fetch("/api/open", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ arg: url }) }).then((x) => x.json());
    if (!r.id) throw new Error(r.error ?? "Bobby couldn't open it");
    location.href = `/r/${r.id}`;
  } catch (e) { toast(`<span>Couldn't open #${n}: ${esc(e.message)}</span>`, 8000); }
}

// ---------------------------------------------------------------- the dialog
export function openStack() {
  editing = null;
  draw();
  load(true).then(() => { if (!editing && isShown()) draw(); });
}
const isShown = () => !document.getElementById("overlay").hidden && !!document.querySelector("#overlay .stack-dlg");

function draw() {
  const s = app.stack, me = app.graph.pr.number;
  if (editing) return drawEdit();
  const row = (l) => {
    const p = l.progress, here = l.number === me;
    const state = l.state === "MERGED" ? ["merged", "Merged"] : l.state === "CLOSED" ? ["closed", "Closed"] : l.draft ? ["draft", "Draft"] : ["open", "Open"];
    const how = here ? "you're here" : p ? `${p.done}/${p.total} reviewed${l.drafts ? ` · ${l.drafts} draft${l.drafts > 1 ? "s" : ""}` : ""}` : "not opened in Bobby";
    return `<li class="${here ? "here" : ""}"><span class="sdot ${state[0]}" title="${state[1]}"></span>
      <span class="stitle"><b>#${l.number}</b> ${esc(l.title)}<small>${esc(l.author)} · <code>${esc(l.head)}</code> · ${how}</small></span>
      ${here ? "" : `<button class="btn" data-stack-go="${l.number}">Open</button>`}</li>`;
  };
  const body = s
    ? `<ol class="slist">${[...s.layers].reverse().map(row).join("")}<li class="trunk"><span class="sdot"></span><code>${esc(s.trunk)}</code></li></ol>`
    : `<p>#${me} isn't in a stack: GitHub has none for it, and no open PR's branch leads to or from it. If it belongs with other PRs, define its stack: Bobby then shows each PR beside its neighbours.</p>`;
  const how = !s ? "" : s.source === "github" ? "From GitHub's stack. Change it on GitHub, or with <code>gh stack</code>."
    : s.source === "yours" ? "Defined by you, in Bobby only: GitHub doesn't see it." : "Followed through branches: each PR's base is the branch of the one below.";
  dialog(`<div class="stack-dlg"><h2>Stack</h2>${body}${how ? `<p class="shint">${how}</p>` : ""}
    <div class="row">${s?.source === "github" ? "" : `<button class="btn" data-act="stack-edit">${s ? "Edit stack" : "Define a stack"}</button>`}
      ${s?.source === "yours" ? `<button class="btn" data-act="stack-clear">Remove</button>` : ""}<button class="btn primary" data-act="close" style="margin-left:auto">Done</button></div></div>`, "stack");
}

function drawEdit() {
  const me = app.graph.pr.number;
  const known = new Map((app.stack?.layers ?? []).map((l) => [l.number, l.title]));
  const rows = editing.map((n, i) => `<li${n === me ? ` class="here"` : ""}><span class="stitle"><b>#${n}</b> ${esc(known.get(n) ?? (n === me ? app.graph.pr.title : ""))}${n === me ? "<small>this PR</small>" : ""}</span>
    <span class="sbtns"><button class="iconbtn" data-stack-move="${i}" data-dir="-1" aria-label="Move up"${i === 0 ? " disabled" : ""}>↑</button><button class="iconbtn" data-stack-move="${i}" data-dir="1" aria-label="Move down"${i === editing.length - 1 ? " disabled" : ""}>↓</button>${n === me ? "" : `<button class="iconbtn" data-stack-drop="${i}" aria-label="Take out">✕</button>`}</span></li>`).join("");
  dialog(`<div class="stack-dlg editing"><h2>${app.stack ? "Edit stack" : "Define a stack"}</h2>
    <p class="shint">Top first, the PR nearest ${esc(app.stack?.trunk ?? app.graph.pr.baseRef ?? "the base")} last. Kept in Bobby only: GitHub doesn't see it.</p>
    <ol class="slist">${rows}</ol>
    <form class="sadd" data-stack-add><input id="stack-add" placeholder="Add a PR: its number or link" autocomplete="off" spellcheck="false"><span class="sadd-at"><label><input type="radio" name="stack-at" value="top" checked> on top</label><label><input type="radio" name="stack-at" value="bottom"> below</label></span><button class="btn">Add</button></form>
    <p class="why" id="stack-why" hidden></p>
    <div class="row"><button class="btn primary" data-act="stack-save">Save</button><button class="btn" data-act="stack-cancel">Cancel</button></div></div>`, "stack");
  document.getElementById("stack-add")?.focus();
}

function why(msg) {
  const el = document.getElementById("stack-why");
  if (el) { el.textContent = msg; el.hidden = !msg; }
}
/** A PR in this repo, from its number, #number or link; null for anything else. */
function prNumber(text) {
  const t = text.trim(), pr = app.graph.pr;
  if (/^#?\d+$/.test(t)) return Number(t.replace("#", ""));
  const m = t.match(/github\.com\/([^/]+)\/([^/]+)\/pull\/(\d+)/i);
  if (!m) return null;
  return m[1].toLowerCase() === pr.owner.toLowerCase() && m[2].toLowerCase() === pr.repo.toLowerCase() ? Number(m[3]) : NaN;
}

async function save(numbers) {
  try {
    const r = await api("/api/stack", { numbers });
    app.stack = r.stack;
    render();
    editing = null;
    draw();
  } catch (e) { why(e.message); }
}

/** The dialog's clicks and its form; true when it took the event. */
export function stackClick(ev) {
  const t = ev.target.closest("[data-stack-go],[data-stack-move],[data-stack-drop],[data-act^='stack']");
  if (!t) return false;
  const ds = t.dataset;
  if (ds.stackGo) goTo(Number(ds.stackGo));
  else if (ds.stackMove) {
    const i = Number(ds.stackMove), j = i + Number(ds.dir);
    [editing[i], editing[j]] = [editing[j], editing[i]];
    drawEdit();
  } else if (ds.stackDrop) { editing.splice(Number(ds.stackDrop), 1); drawEdit(); }
  else if (ds.act === "stack") openStack();
  else if (ds.act === "stack-edit") { editing = app.stack ? app.stack.layers.map((l) => l.number).reverse() : [app.graph.pr.number]; drawEdit(); }
  else if (ds.act === "stack-cancel") { editing = null; draw(); }
  else if (ds.act === "stack-save") save([...editing].reverse());
  else if (ds.act === "stack-clear") save([]);
  else return false;
  return true;
}
document.addEventListener("submit", (ev) => {
  if (!ev.target.matches?.("[data-stack-add]")) return;
  ev.preventDefault();
  const input = document.getElementById("stack-add"), n = prNumber(input.value);
  if (n === null) return why("A PR's number (1234 or #1234) or its GitHub link");
  if (Number.isNaN(n)) return why(`Only PRs in ${app.graph.pr.owner}/${app.graph.pr.repo}: a stack lives in one repo`);
  if (editing.includes(n)) return why(`#${n} is in the stack already`);
  const top = ev.target.querySelector("input[name=stack-at]:checked")?.value !== "bottom";
  if (top) editing.unshift(n); else editing.push(n);
  drawEdit();
});
