// Which of the PR's commits this review covers. In the where-bar, as XXXX...XXXX: the first and last commit, oldest
// first. A click lists the PR's commits to choose from: one, or every one between two, opened as a review of its own.
import { api, esc } from "./core.js";
import { ago } from "./comments.js";
import { argFor, crumbText, pick, rangeText, short, spanOf } from "./commitrange.js";

let app, dialog, close, toast, render;
let commits = []; // the whole PR's, oldest first (/api/commits); whichever part of it this review covers
let loadedFor = null;
let sel = null; // while the dialog is open: { lo, hi, anchor }, anchor being the commit a next click makes a range with

export function initCommits(a, ui) {
  app = a;
  ({ dialog, close, toast, render } = ui);
  load();
  app.on((why) => why === "graph" && load()); // a refresh moves the head
  // up and down through the list, as the rows are many
  document.addEventListener("keydown", (ev) => {
    if ((ev.key !== "ArrowDown" && ev.key !== "ArrowUp") || !ev.target.matches?.("[data-cmt]")) return;
    ev.preventDefault();
    document.querySelector(`[data-cmt="${Number(ev.target.dataset.cmt) + (ev.key === "ArrowDown" ? 1 : -1)}"]`)?.focus();
  });
}
async function load() {
  const pr = app.graph.pr, key = `${pr.baseSha}..${pr.headSha}`;
  if (pr.provider === "local" || loadedFor === key) return;
  loadedFor = key;
  const r = await api("/api/commits").catch(() => null);
  commits = r?.commits ?? [];
  render();
}

/** For the where-bar, between the PR and what's in it. */
export function commitCrumb() {
  const pr = app?.graph.pr;
  if (!pr || pr.provider === "local") return "";
  const text = crumbText(commits, pr);
  if (!text) return "";
  const s = spanOf(commits, pr), n = s ? s[1] - s[0] + 1 : 0;
  const what = !pr.commit ? `All ${n} commit${n > 1 ? "s" : ""} of this PR` : n ? `${n} of this PR's ${commits.length} commits` : "Part of this PR";
  return `<button class="crange" data-act="commits" data-tip="Commits" data-tip-more="${esc(what)}. Click to choose which to review." aria-label="Commits ${esc(text)}. Choose which to review">${esc(text)}</button>`;
}

export function openCommits() {
  if (!commits.length) return toast(`<span>Couldn't read this PR's commits.</span>`, 6000);
  const s = spanOf(commits, app.graph.pr) ?? [0, commits.length - 1];
  sel = { lo: s[0], hi: s[1], anchor: null };
  const rows = commits.map((c, i) => `<li><button class="cmt" data-cmt="${i}"><i class="tick"></i><code title="${esc(c.sha)}">${esc(short(c.sha))}</code><span class="csub">${esc(c.subject)}</span>${c.merge ? `<span class="sflag" title="A merge: reviewing it includes what it brought in">merge</span>` : ""}<small>${esc(c.author)} · ${esc(ago(c.at))}</small></button></li>`).join("");
  dialog(`<div class="commits-dlg"><h2>Commits</h2>
    <p class="shint">Click a commit to review it alone. Click another to review everything between the two.</p>
    <ol class="cmts">${rows}</ol>
    <div class="row"><button class="btn primary" data-cmts-open></button><button class="btn" data-cmts-all>All ${commits.length}</button><button class="btn" data-act="close">Cancel</button></div></div>`, "commits");
  paint();
  const first = document.querySelector(`[data-cmt="${s[0]}"]`);
  first?.focus();
  first?.scrollIntoView({ block: "nearest" });
}
/** The selection, into the open dialog; rows stay in place, so focus and scroll do too. */
function paint() {
  for (const b of document.querySelectorAll("[data-cmt]")) {
    const i = Number(b.dataset.cmt), on = i >= sel.lo && i <= sel.hi;
    b.classList.toggle("on", on);
    b.setAttribute("aria-pressed", on);
  }
  const btn = document.querySelector("[data-cmts-open]");
  const here = spanOf(commits, app.graph.pr);
  const same = here?.[0] === sel.lo && here?.[1] === sel.hi;
  btn.textContent = `Review ${rangeText(commits[sel.lo].sha, commits[sel.hi].sha)}`;
  btn.disabled = same;
  btn.title = same ? "This is what you're reviewing" : "";
}
async function openRange(arg, text) {
  close();
  toast(`<span>Opening ${esc(text)}…</span>`);
  try {
    const r = await fetch("/api/open", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ arg }) }).then((x) => x.json());
    if (!r.id) throw new Error(r.error ?? "Bobby couldn't open it");
    location.href = `/r/${r.id}`;
  } catch (e) { toast(`<span>Couldn't open them: ${esc(e.message)}</span>`, 8000); }
}

/** The crumb's and the dialog's clicks; true when it took the event. */
export function commitsClick(ev) {
  const t = ev.target.closest("[data-cmt],[data-cmts-open],[data-cmts-all],[data-act='commits']");
  if (!t) return false;
  const url = app.graph.pr.url;
  if (t.dataset.act === "commits") openCommits();
  else if (t.dataset.cmt != null) { sel = pick(sel, Number(t.dataset.cmt), ev.shiftKey); paint(); }
  else if (t.hasAttribute("data-cmts-all")) openRange(url, `all ${commits.length} commits`);
  else openRange(argFor(commits, sel.lo, sel.hi, url), rangeText(commits[sel.lo].sha, commits[sel.hi].sha));
  return true;
}
