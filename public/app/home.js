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
  if (!r.ok) throw Object.assign(new Error(j.error ?? `${r.status} ${r.statusText}`), { data: j });
  return j;
};

const home = await json("/api/home").catch((e) => ({ error: e.message, recents: [], settings: {} }));
// the theme you chose for reviews
const s = home.settings ?? {}, root = document.documentElement;
root.dataset.theme = (s.theme ?? "system") === "system" ? (matchMedia("(prefers-color-scheme: light)").matches ? "light" : "dark") : s.theme;
root.dataset.palette = ["warm", "silverpoint"].includes(s.palette) ? s.palette : "github";
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
  catch (e) {
    el?.classList.remove("busy");
    if (e.data?.setup === "gh" && body.arg) return setupGh({ force: true, then: body.arg }); // set gh up, then open it
    $(".err").textContent = e.message;
  }
}
// Enter in the box: a pasted PR opens; a search opens the first match.
$("form.tools").addEventListener("submit", (ev) => {
  ev.preventDefault();
  const link = asLink(box().value);
  if (link) return open({ arg: link }, ev.target);
  if (rows()[0]) return openRow(rows()[sel >= 0 ? sel : 0]);
  $(".err").textContent = box().value.trim() ? "Nothing matches. To review a PR, paste its link (…/pull/123, or a commit of it) or type owner/repo#123." : "";
});
const box = () => $("[name=q]");

// ---- the lists
let recents = home.recents ?? [], lists = { review: [], mine: [], all: [] }, loadingLists = true, listError = "";
// the box searches unless it holds a PR to open
const filters = () => ({ repo: $("[name=repo]").value, author: $("[name=author]").value, q: asLink(box().value) ? "" : box().value.trim() });
/** The repo and author pickers: what's in your lists, keeping what's chosen. */
function fillPickers() {
  const all = [...recents, ...lists.review, ...lists.mine, ...lists.all];
  const fill = (name, first, values) => {
    const el = $(`[name=${name}]`), was = el.value;
    const opts = [...new Set([...values, ...(was ? [was] : [])])].filter(Boolean).sort((a, b) => a.localeCompare(b));
    el.innerHTML = first + opts.map((v) => `<option value="${esc(v)}"${v === was ? " selected" : ""}>${esc(v)}</option>`).join("");
    el.classList.toggle("on", !!el.value);
  };
  fill("repo", `<option value="">All repos</option>`, all.filter((x) => x.kind !== "local").map((x) => `${x.owner}/${x.repo}`));
  const me = home.me?.login;
  fill("author", `<option value="">Anyone</option>${me ? `<option value="${esc(me)}">Me</option>` : ""}`, all.map((x) => x.author).filter((a) => a && a !== me));
}
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
  const id = `${x.owner}/${x.repo}/${x.number}`;
  return `<a class="row" href="/r/${esc(id)}" data-pr="${esc(x.url)}" data-id="${esc(id)}">
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
  fillPickers();
}
async function loadLists(fresh = false) {
  const f = filters(), q = new URLSearchParams(Object.entries(f).filter(([, v]) => v));
  if (fresh) q.set("fresh", "1");
  loadingLists = true; $(".reload").classList.add("spin"); render();
  const got = await json(`/api/home/prs?${q}`).catch((e) => ({ error: e.message }));
  if (JSON.stringify(filters()) !== JSON.stringify(f)) return; // the filters changed meanwhile: a newer ask is on its way
  loadingLists = false; listError = got.error ?? ""; $(".reload").classList.remove("spin");
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
  if (!row || ev.metaKey || ev.ctrlKey || ev.shiftKey || ev.button) return; // a new tab: the link is the review's address
  ev.preventDefault();
  openRow(row);
});

// ---- a row's menu: open it here or in a new tab, see it on GitHub, copy its link
/** The review's address in Bobby, and the PR's on GitHub (none for a local branch). */
function linksOf(row) {
  if (row.dataset.recent == null) return { here: row.getAttribute("href"), github: row.dataset.pr };
  const r = recents[Number(row.dataset.recent)];
  return { here: `/r/${r.id}`, github: r.kind === "local" ? null : r.url ?? null };
}
const menu = $(".menu");
function showMenu(row, x, y) {
  const { here, github } = linksOf(row);
  const item = (act, label, key = "") => `<button type="button" role="menuitem" data-act="${act}">${label}${key ? `<kbd>${key}</kbd>` : ""}</button>`;
  menu.innerHTML = item("open", "Open review", "enter") + item("tab", "Open in new tab", `${/Mac/.test(navigator.platform) ? "⌘" : "ctrl"} click`)
    + (github ? `<hr>${item("github", "Open on GitHub", "o")}${item("copy", "Copy GitHub link")}` : "") + item("copy-here", "Copy review link");
  menu.hidden = false;
  menu.row = row; menu.links = { here: new URL(here, location.href).href, github };
  // at the pointer (or under the row, from the keyboard), kept on screen
  const m = menu.getBoundingClientRect();
  menu.style.left = `${Math.max(4, Math.min(x, innerWidth - m.width - 4))}px`;
  menu.style.top = `${y + m.height > innerHeight - 4 ? Math.max(4, y - m.height) : y}px`;
  menu.querySelector("button").focus();
}
function hideMenu() {
  if (menu.hidden) return;
  if (menu.contains(document.activeElement)) menu.row?.focus({ preventScroll: true }); // keys go back to the list
  menu.hidden = true;
}
async function copy(text) {
  try { return await navigator.clipboard.writeText(text); }
  catch { /* no clipboard API here (or no permission): the old way */ }
  const t = Object.assign(document.createElement("textarea"), { value: text });
  document.body.append(t); t.select();
  const ok = document.execCommand("copy");
  t.remove();
  if (!ok) $(".err").textContent = `Couldn't copy: ${text}`;
}
menu.addEventListener("click", (ev) => {
  const act = ev.target.closest("button")?.dataset.act;
  if (!act) return;
  const { row, links } = menu;
  hideMenu();
  if (act === "open") openRow(row);
  else if (act === "tab") window.open(links.here, "_blank", "noopener");
  else if (act === "github") window.open(links.github, "_blank", "noopener");
  else if (act === "copy") copy(links.github);
  else if (act === "copy-here") copy(links.here);
});
menu.addEventListener("keydown", (ev) => {
  const items = [...menu.querySelectorAll("button")], i = items.indexOf(document.activeElement);
  if (ev.key === "Escape" || ev.key === "Tab") { ev.preventDefault(); hideMenu(); }
  else if (ev.key === "ArrowDown" || ev.key === "ArrowUp") { ev.preventDefault(); items[(i + (ev.key === "ArrowDown" ? 1 : -1) + items.length) % items.length].focus(); }
  else return;
  ev.stopPropagation();
});
$(".lists").addEventListener("contextmenu", (ev) => {
  const row = ev.target.closest(".row");
  if (!row) return;
  ev.preventDefault();
  select(rows().indexOf(row));
  showMenu(row, ev.clientX, ev.clientY);
});
addEventListener("pointerdown", (ev) => { if (!menu.contains(ev.target)) hideMenu(); });
addEventListener("scroll", () => hideMenu(), true);
addEventListener("resize", () => hideMenu());
addEventListener("blur", () => hideMenu());

document.addEventListener("keydown", (ev) => {
  if (menu.contains(ev.target)) return; // the menu's own keys
  const typing = ev.target.matches("input");
  const row = rows()[sel];
  if (row && !typing && (ev.key === "ContextMenu" || (ev.key === "F10" && ev.shiftKey))) {
    ev.preventDefault();
    const r = row.getBoundingClientRect();
    return showMenu(row, r.left + 24, r.bottom);
  }
  if (row && !typing && ev.key === "o" && !ev.metaKey && !ev.ctrlKey && !ev.altKey) {
    const { github } = linksOf(row);
    if (github) { ev.preventDefault(); window.open(github, "_blank", "noopener"); }
    return;
  }
  if (ev.key === "/" && !typing) { ev.preventDefault(); return box().focus(); }
  if (ev.key === "Escape" && typing) return ev.target.blur();
  if (ev.key === "ArrowDown" || (!typing && ev.key === "j")) { ev.preventDefault(); if (typing) ev.target.blur(); select(Math.min(sel + 1, rows().length - 1)); }
  else if (ev.key === "ArrowUp" || (!typing && ev.key === "k")) { ev.preventDefault(); select(Math.max(sel - 1, 0)); }
  else if (ev.key === "Enter" && !typing && rows()[sel]) { ev.preventDefault(); openRow(rows()[sel]); }
});
let filterTimer = 0, asked = "";
const refilter = () => {
  $(".err").textContent = "";
  $(".tools .go").hidden = !asLink(box().value);
  render();
  const key = JSON.stringify(filters());
  if (key === asked) return; // pasting a link changes nothing GitHub is asked
  asked = key; clearTimeout(filterTimer); filterTimer = setTimeout(loadLists, 400);
};
box().addEventListener("input", refilter);
for (const name of ["repo", "author"]) $(`[name=${name}]`).addEventListener("change", refilter);
$(".reload").addEventListener("click", () => loadLists(true));
// recents change as you review in other tabs; GitHub's lists every few minutes
addEventListener("focus", async () => { const h = await json("/api/home").catch(() => null); if (h) { recents = h.recents; render(); } });
setInterval(() => loadLists(), 180_000);

render();
asked = JSON.stringify(filters());
loadLists();

// GitHub's CLI, then Claude Code: each offered the first time it isn't set up, GitHub's first (Bobby needs it for PRs);
// the header keeps a way back to each while it isn't. A PR asked for before gh was set up (?open=) opens once it is.
const setup = Promise.all([import("/app/gh-setup.js"), import("/app/claude-setup.js")]);
async function setupGh(o) {
  const { offerGh } = (await setup)[0];
  await offerGh({ ...o, onReady: () => { $("button.gh").hidden = true; loadLists(true); json("/api/home").then((h) => { recents = h.recents; render(); }, () => {}); } });
}
setup.then(async ([{ offerGh }, { offerClaude }]) => {
  const [gh, claude] = await Promise.all(["/api/gh", "/api/claude"].map((u) => fetch(u).then((r) => r.json()).catch(() => null)));
  const ghPill = $("button.gh"), pill = $("button.claude");
  if (gh && !(gh.installed && gh.loggedIn)) { ghPill.hidden = false; ghPill.textContent = gh.installed ? "Sign in to GitHub" : "Set up GitHub"; }
  if (claude && !(claude.installed && claude.loggedIn)) { pill.hidden = false; pill.textContent = claude.installed ? "Sign in to Claude" : "Set up Claude"; }
  ghPill.addEventListener("click", () => setupGh({ force: true }));
  pill.addEventListener("click", () => offerClaude({ force: true }));
  const asked = new URLSearchParams(location.search).get("open"); // just now, from the terminal: ask whatever
  if (asked) history.replaceState(null, "", "/");
  await setupGh({ force: !!asked, then: asked ?? home.waiting });
  offerClaude();
});
