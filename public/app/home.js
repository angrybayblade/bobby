// The home page: paste a PR to review it, or pick one: what you've opened before, what's waiting on your review, your
// own, and everything GitHub lists as involving you. Filters narrow every list; ↑ ↓ and enter drive it.
const $ = (s) => document.querySelector(s);
const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);
const ago = (iso) => {
  const s = (Date.now() - Date.parse(iso)) / 1000;
  return s < 60 ? "just now" : s < 3600 ? `${Math.floor(s / 60)}m ago` : s < 86400 ? `${Math.floor(s / 3600)}h ago` : `${Math.floor(s / 86400)}d ago`;
};
const json = async (url, body) => {
  const r = await fetch(url, body ? { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) } : {});
  const j = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(j.error ?? `${r.status} ${r.statusText}`);
  return j;
};

const home = await json("/api/home").catch((e) => ({ error: e.message, recents: [], settings: {} }));
// the theme you chose for reviews
const s = home.settings ?? {}, root = document.documentElement;
root.dataset.theme = (s.theme ?? "system") === "system" ? (matchMedia("(prefers-color-scheme: light)").matches ? "light" : "dark") : s.theme;
root.dataset.palette = (s.palette ?? "github") === "github" ? "github" : "warm";
root.style.setProperty("--size", `${s.size ?? 15}px`);
try { localStorage.setItem("bobby.look", JSON.stringify({ theme: s.theme ?? "system", palette: s.palette ?? "github" })); } catch { /* private window */ }
$(".ver").textContent = home.version ? `v${home.version}` : "";
if (home.release) $(".release").innerHTML = `<a class="pill signal" href="${esc(home.release.url)}" target="_blank" rel="noopener" title="Update with: ${esc(home.release.how ?? "")}">Update · ${esc(home.release.version)}</a>`;
if (home.error) $(".err").textContent = `Couldn't reach Bobby: ${home.error}`;

// ---- opening a review: by what you paste, or a row
/** A PR link (or one of its commits'), or owner/repo#123, as a link; null if it's neither. */
function asLink(text) {
  const t = text.trim();
  if (/^https?:\/\/github\.com\/[^/]+\/[^/]+\/pull\/\d+/i.test(t)) return t.replace(/[?#].*$/, "");
  const m = t.match(/^([\w.-]+)\/([\w.-]+)#(\d+)$/);
  return m ? `https://github.com/${m[1]}/${m[2]}/pull/${m[3]}` : null;
}
async function open(body, el) {
  $(".err").textContent = "";
  el?.classList.add("busy");
  try { location.href = `/r/${(await json("/api/open", body)).id}`; }
  catch (e) { $(".err").textContent = e.message; el?.classList.remove("busy"); }
}
$("form.go").addEventListener("submit", (ev) => {
  ev.preventDefault();
  const link = asLink(ev.target.pr.value);
  if (!link) return void ($(".err").textContent = "That isn't a pull request link: paste one from GitHub (…/pull/123, or a commit of it), or type owner/repo#123.");
  open({ arg: link }, ev.target);
});

// ---- the lists
let recents = home.recents ?? [], lists = { review: [], mine: [], all: [] }, loadingLists = true, listError = "";
const filters = () => ({ repo: $("[name=repo]").value.trim(), author: $("[name=author]").value.trim().replace(/^@/, ""), q: $("[name=q]").value.trim() });
const matches = (r, f) => (!f.repo || `${r.owner}/${r.repo}`.toLowerCase().includes(f.repo.toLowerCase()))
  && (!f.author || (r.author ?? "").toLowerCase() === f.author.toLowerCase())
  && (!f.q || `${r.title} ${r.commit?.subject ?? ""} ${r.branch ?? ""}`.toLowerCase().includes(f.q.toLowerCase()));
const recentById = () => new Map(recents.map((r) => [r.id, r]));

function recentRow(r, i) {
  const what = r.kind === "local" ? `<span class="sha">⎇ ${esc(r.branch)}</span>${esc(r.baseRef ? `vs ${r.baseRef}` : "")}`
    : `<b>#${r.number}</b> ${r.commit ? `<span class="sha">@ ${esc(r.commit.sha.slice(0, 7))}</span>` : ""}${esc(r.title)}`;
  const p = r.progress, pct = p?.total ? Math.round((p.done / p.total) * 100) : 0;
  return `<a class="row" href="/r/${esc(r.id)}" data-recent="${i}">
    <span class="t">${what}${r.open ? `<span class="tag live" title="Open in this Bobby">open</span>` : ""}</span>
    <span class="side">${p ? `<span title="${p.done} of ${p.total} pages reviewed"><span class="bar"><i style="width:${pct}%"></i></span>${p.done}/${p.total}</span>` : ""}${r.drafts ? `<span>${r.drafts} draft${r.drafts > 1 ? "s" : ""}</span>` : ""}<span title="Last opened">${ago(r.openedAt)}</span></span>
    <span class="where">${esc(r.kind === "local" ? `local · ${r.repo}` : `${r.owner}/${r.repo}`)}${r.author && r.kind !== "local" ? ` · ${esc(r.author)}` : ""}</span>
  </a>`;
}
function prRow(x, mine) {
  const seen = mine.get(`${x.owner}/${x.repo}/${x.number}`), p = seen?.progress;
  return `<a class="row" href="${esc(x.url)}" data-pr="${esc(x.url)}" data-id="${esc(`${x.owner}/${x.repo}/${x.number}`)}">
    <span class="t"><b>#${x.number}</b> ${esc(x.title)}${x.draft ? `<span class="tag draft">draft</span>` : ""}${seen?.open ? `<span class="tag live">open</span>` : ""}</span>
    <span class="side">${p ? `<span title="Your progress: ${p.done} of ${p.total} pages reviewed">${p.done}/${p.total}</span>` : ""}${x.comments ? `<span title="Comments">◂ ${x.comments}</span>` : ""}<span title="Updated">${ago(x.updatedAt)}</span></span>
    <span class="where">${esc(`${x.owner}/${x.repo}`)} · <img class="av" src="/api/avatar?u=${encodeURIComponent(x.author)}" alt="" loading="lazy" onerror="this.remove()">${esc(x.author)}</span>
  </a>`;
}
function render() {
  const f = filters(), mine = recentById();
  const rs = recents.map((r, i) => [r, i]).filter(([r]) => matches(r, f));
  const section = (title, body, n) => `<section><h2>${title}${n != null ? `<span class="n">${n}</span>` : ""}</h2>${body}</section>`;
  const gh = (title, items, empty) => section(title, loadingLists ? `<div class="none">Asking GitHub…</div>` : listError ? `<div class="none">Couldn't list PRs: ${esc(listError)}</div>` : items.length ? items.map((x) => prRow(x, mine)).join("") : `<div class="none">${empty}</div>`, loadingLists || listError ? null : items.length);
  $(".lists").innerHTML = [
    section("Recents", rs.length ? rs.map(([r, i]) => recentRow(r, i)).join("") : `<div class="none">${recents.length ? "None match the filters." : "Reviews you open show here, with how far you got."}</div>`, rs.length || null),
    gh("Review requested", lists.review, "Nothing waiting on your review."),
    gh("My PRs", lists.mine, "No open PRs of yours."),
    gh("All", lists.all, "No open PRs involve you."),
  ].join("");
  select(Math.min(sel, rows().length - 1));
}
async function loadLists(fresh = false) {
  const f = filters(), q = new URLSearchParams(Object.entries(f).filter(([, v]) => v));
  if (fresh) q.set("fresh", "1");
  loadingLists = true; render();
  const got = await json(`/api/home/prs?${q}`).catch((e) => ({ error: e.message }));
  if (JSON.stringify(filters()) !== JSON.stringify(f)) return; // the filters changed meanwhile: a newer ask is on its way
  loadingLists = false; listError = got.error ?? "";
  lists = { review: got.review ?? [], mine: got.mine ?? [], all: got.all ?? [] };
  render();
}

// ---- moving and opening
let sel = -1;
const rows = () => [...document.querySelectorAll(".lists .row")];
function select(i) {
  rows().forEach((r, k) => r.classList.toggle("sel", k === i));
  sel = i;
  rows()[i]?.scrollIntoView({ block: "nearest" });
}
function openRow(row) {
  if (row.dataset.recent != null) {
    const r = recents[Number(row.dataset.recent)];
    if (r.open) return void (location.href = `/r/${r.id}`);
    return open(r.kind === "local" ? { repo: r.repoDir, base: r.baseRef } : { arg: r.arg, repo: r.repoDir }, row);
  }
  const seen = recentById().get(row.dataset.id);
  if (seen?.open) return void (location.href = `/r/${seen.id}`); // already open in this Bobby: no need to ask GitHub again
  open({ arg: row.dataset.pr }, row);
}
$(".lists").addEventListener("click", (ev) => {
  const row = ev.target.closest(".row");
  if (!row || ev.metaKey || ev.ctrlKey || ev.shiftKey || ev.button) return; // a new tab: as the link says
  ev.preventDefault();
  openRow(row);
});
document.addEventListener("keydown", (ev) => {
  const typing = ev.target.matches("input");
  if (ev.key === "/" && !typing) { ev.preventDefault(); return $("[name=pr]").focus(); }
  if (ev.key === "Escape" && typing) return ev.target.blur();
  if (typing && ev.target.name === "pr") return;
  if (ev.key === "ArrowDown" || (!typing && ev.key === "j")) { ev.preventDefault(); if (typing) ev.target.blur(); select(Math.min(sel + 1, rows().length - 1)); }
  else if (ev.key === "ArrowUp" || (!typing && ev.key === "k")) { ev.preventDefault(); select(Math.max(sel - 1, 0)); }
  else if (ev.key === "Enter" && !typing && rows()[sel]) { ev.preventDefault(); openRow(rows()[sel]); }
});
let filterTimer = 0;
for (const name of ["repo", "author", "q"]) $(`[name=${name}]`).addEventListener("input", () => { render(); clearTimeout(filterTimer); filterTimer = setTimeout(loadLists, 400); });
$(".reload").addEventListener("click", () => loadLists(true));
// recents change as you review in other tabs; GitHub's lists every few minutes
addEventListener("focus", async () => { const h = await json("/api/home").catch(() => null); if (h) { recents = h.recents; render(); } });
setInterval(() => loadLists(), 180_000);

render();
loadLists();
