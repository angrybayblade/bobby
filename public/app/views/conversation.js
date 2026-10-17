// Conversation: the PR as GitHub's Conversation tab tells it. The description, then comments, reviews (with the threads
// they started on code) and pushes in time order, a box to comment, and at the end where it stands: reviews, CI checks
// and whether it can merge. Read live from GitHub (/api/conversation), so it keeps up while you review; a PR only, never
// a local branch. A thread's file:line goes to that code in the walk.
import { api, esc } from "../core.js";
import { ago, ghHtml, md } from "../comments.js";
import { MOD } from "../palette.js";
import { injectCss } from "./flow.js";

const STYLE = `
.conv { position: absolute; inset: 0; overflow: auto; }
.conv .col { max-width: 880px; margin: 0 auto; padding: 28px 16px 120px; }
.conv h1 { font: 650 calc(var(--size) * 1.7)/1.25 var(--font-prose); letter-spacing: -.01em; margin: 0 0 10px; overflow-wrap: anywhere; }
.conv h1 .num { color: var(--faint); font-weight: 400; }
.conv .meta { display: flex; flex-wrap: wrap; align-items: center; gap: 8px; color: var(--muted); font-size: 13px; padding-bottom: 18px; border-bottom: 1px solid var(--line-soft); margin-bottom: 22px; }
.conv .meta b { color: var(--text); }
.conv .meta a { color: var(--muted); }
.conv .state { font: 600 12px var(--font-ui); padding: 3px 10px; border-radius: 12px; color: var(--bg); background: var(--ok); }
.conv .state.draft, .conv .state.closed { background: var(--muted); }
.conv .state.merged { background: var(--signal); }
.conv .cav { width: 20px; height: 20px; border-radius: 50%; flex: none; background: var(--raised); object-fit: cover; vertical-align: middle; }
.conv .big > .cav, .conv .card > .cav { width: 32px; height: 32px; }
.conv .tl { position: relative; }
.conv .tl::before { content: ""; position: absolute; left: 15px; top: 0; bottom: 0; border-left: 2px solid var(--line-soft); }
.conv .item { position: relative; margin: 0 0 16px; }
.conv .card { display: grid; grid-template-columns: 32px 1fr; gap: 12px; }
.conv .box { border: 1px solid var(--line); border-radius: var(--radius, 6px); background: var(--surface); min-width: 0; }
.conv .box > .hd { display: flex; align-items: center; gap: 8px; padding: 8px 14px; border-bottom: 1px solid var(--line-soft); background: var(--raised); font-size: 13px; color: var(--muted); border-radius: var(--radius, 6px) var(--radius, 6px) 0 0; }
.conv .box > .hd b { color: var(--text); }
.conv .box > .hd .grow { flex: 1; }
.conv .box > .hd a { color: var(--faint); text-decoration: none; }
.conv .box > .bd { padding: 12px 14px; font: var(--size)/1.6 var(--font-prose); }
.conv .box > .bd.empty { color: var(--faint); font-style: italic; }
.conv .cbody { max-height: none; margin: 0; }
.conv .event { display: flex; align-items: center; gap: 10px; padding-left: 4px; font-size: 13px; color: var(--muted); min-height: 28px; }
.conv .event b { color: var(--text); }
.conv .event .ico { width: 24px; height: 24px; border-radius: 50%; display: grid; place-items: center; background: var(--raised); border: 1px solid var(--line); flex: none; font-size: 12px; z-index: 1; color: var(--muted); }
.conv .event .ico.ok { background: var(--ok); border-color: var(--ok); color: var(--bg); }
.conv .event .ico.bad { background: var(--risk); border-color: var(--risk); color: var(--bg); }
.conv .event .when { color: var(--faint); }
.conv .review > .body { margin: 8px 0 0 44px; }
.conv .review > .body > * + * { margin-top: 10px; }
.conv .commits { margin: 4px 0 0 44px; display: grid; gap: 2px; }
.conv .commits a { display: flex; gap: 10px; align-items: baseline; color: var(--muted); text-decoration: none; font-size: 13px; padding: 2px 0; min-width: 0; }
.conv .commits a:hover .s { color: var(--text); text-decoration: underline; }
.conv .commits .s { flex: 1; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.conv .commits code { font: 12px var(--font-code); color: var(--faint); }
.conv .thread { border: 1px solid var(--line); border-radius: var(--radius, 6px); background: var(--surface); overflow: hidden; }
.conv .thread > .th { display: flex; align-items: center; gap: 8px; padding: 7px 12px; background: var(--raised); font: 12.5px var(--font-code); color: var(--muted); cursor: pointer; }
.conv .thread > .th .p { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; direction: rtl; text-align: left; }
.conv .thread > .th .grow { flex: 1; }
.conv .thread > .th .tag { font: 500 11px var(--font-ui); padding: 1px 7px; border-radius: 10px; border: 1px solid var(--line); color: var(--faint); white-space: nowrap; }
.conv .thread > .th .go { font: 12px var(--font-ui); color: var(--signal); background: none; border: 0; padding: 0; cursor: pointer; white-space: nowrap; }
.conv .thread > .th .go:hover { text-decoration: underline; }
.conv .thread.shut > :not(.th) { display: none; }
.conv .tc { display: grid; grid-template-columns: 24px 1fr; gap: 10px; padding: 10px 12px; border-top: 1px solid var(--line-soft); }
.conv .tc .cav { width: 24px; height: 24px; }
.conv .tc .who { font-size: 12.5px; color: var(--muted); }
.conv .tc .who b { color: var(--text); }
.conv .tc .who a { color: var(--faint); text-decoration: none; margin-left: 4px; }
.conv .tc .cbody { font: 13.5px/1.55 var(--font-ui); }
.conv .compose { padding: 10px 12px; border-top: 1px solid var(--line-soft); }
.conv .compose textarea { width: 100%; box-sizing: border-box; min-height: 72px; resize: vertical; font: 13.5px/1.5 var(--font-ui); color: var(--text); background: var(--bg); border: 1px solid var(--line); border-radius: 4px; padding: 8px 10px; }
.conv .compose textarea:focus { outline: none; border-color: var(--signal); }
.conv .compose .row { display: flex; align-items: center; gap: 8px; margin-top: 8px; }
.conv .compose .row .grow { flex: 1; }
.conv .compose .err { color: var(--risk); font-size: 12.5px; }
.conv .compose .hint { color: var(--faint); font-size: 12px; }
.conv .replyb { display: block; width: 100%; text-align: left; padding: 8px 12px; border: 0; border-top: 1px solid var(--line-soft); background: none; color: var(--faint); font: 13px var(--font-ui); cursor: text; }
.conv .replyb:hover { color: var(--muted); background: var(--raised); }
.conv .newc .compose { border-top: 0; }
.conv .newc .compose textarea { min-height: 110px; }
.conv h2 { font: 600 12px var(--font-ui); letter-spacing: .09em; text-transform: uppercase; color: var(--faint); margin: 34px 0 10px; }
.conv .status { border: 1px solid var(--line); border-radius: var(--radius, 6px); background: var(--surface); }
.conv .status > section { padding: 12px 16px; }
.conv .status > section + section { border-top: 1px solid var(--line-soft); }
.conv .status .sh { display: flex; align-items: center; gap: 10px; font-weight: 600; }
.conv .status .sh .sub { font-weight: 400; color: var(--muted); font-size: 13px; }
.conv .dot { width: 22px; height: 22px; border-radius: 50%; display: grid; place-items: center; flex: none; font-size: 12px; color: var(--bg); background: var(--muted); }
.conv .dot.ok { background: var(--ok); } .conv .dot.bad { background: var(--risk); } .conv .dot.wait { background: var(--signal); }
.conv .people { display: grid; gap: 6px; margin: 10px 0 0 32px; font-size: 13px; color: var(--muted); }
.conv .people > div { display: flex; align-items: center; gap: 8px; }
.conv .people b { color: var(--text); font-weight: 500; }
.conv .checks { margin: 10px 0 0 32px; display: grid; gap: 1px; }
.conv .chk { display: grid; grid-template-columns: 16px 1fr auto auto; gap: 10px; align-items: baseline; font-size: 13px; padding: 3px 0; }
.conv .chk .n { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.conv .chk .n small { color: var(--faint); }
.conv .chk .d { color: var(--faint); font-size: 12px; white-space: nowrap; }
.conv .chk a { color: var(--signal); font-size: 12px; text-decoration: none; }
.conv .chk .i.success { color: var(--ok); } .conv .chk .i.failure { color: var(--risk); } .conv .chk .i.running, .conv .chk .i.queued { color: var(--signal); } .conv .chk .i { color: var(--faint); }
.conv .checks details { margin-top: 4px; }
.conv .checks summary { cursor: pointer; color: var(--muted); font-size: 13px; padding: 3px 0; }
.conv .note { color: var(--muted); padding: 40px 0; text-align: center; }
.conv .note.err { color: var(--risk); }
`;

const avatar = (p) => `<img class="cav" src="/api/avatar?u=${encodeURIComponent(p?.avatar ?? p?.login ?? "")}" alt="" loading="lazy" onerror="this.style.visibility='hidden'">`;
const when = (t) => `<span class="when" title="${esc(t ?? "")}">${esc(ago(t))}</span>`;
const VERB = { APPROVED: "approved these changes", CHANGES_REQUESTED: "requested changes", COMMENTED: "reviewed", DISMISSED: "reviewed (dismissed)" };
const ICON = { APPROVED: ["ok", "✓"], CHANGES_REQUESTED: ["bad", "±"], COMMENTED: ["", "◉"], DISMISSED: ["", "◌"] };
const CHECK = { success: "✓", failure: "✕", running: "●", queued: "○", skipped: "⊘", cancelled: "⊘", neutral: "◌" };
const ORDER = ["failure", "running", "queued", "cancelled", "neutral", "success", "skipped"];
const dur = (c) => {
  const s = c.startedAt && c.completedAt ? (Date.parse(c.completedAt) - Date.parse(c.startedAt)) / 1000 : NaN;
  return Number.isFinite(s) && s >= 0 ? (s < 60 ? `${Math.round(s)}s` : `${Math.floor(s / 60)}m ${Math.round(s % 60)}s`) : "";
};
/** A comment's text as GitHub renders it; Bobby's own Markdown until that's known. */
const text = (x) => `<div class="cbody full gh">${x.html ? ghHtml(x.html) : md(x.body)}</div>`;
const plural = (n, w) => `${n} ${w}${n === 1 ? "" : "s"}`;

export default {
  id: "conversation",
  name: "Conversation",
  hint: "The PR's description, comments, reviews and checks, as on GitHub",
  available: (graph) => graph.pr.provider !== "local",
  mount(el, app) {
    injectCss("conversation", STYLE);
    const root = el.appendChild(Object.assign(document.createElement("div"), { className: "conv" }));
    let data = null, error = "", dead = false, pending = false;
    const shut = new Map(); // thread id → collapsed, as you left it (resolved and outdated ones start collapsed)
    const replying = new Set(); // thread ids with an open reply box
    const drafts = new Map(), errors = new Map(); // composer key → text, and why posting it failed

    const isShut = (t) => shut.get(t.id) ?? (t.resolved || t.outdated);
    const composer = (key, label, placeholder) => `<div class="compose" data-ck="${esc(key)}">
      <textarea placeholder="${esc(placeholder)}" data-ckey="${esc(key)}">${esc(drafts.get(key) ?? "")}</textarea>
      <div class="row">${errors.get(key) ? `<span class="err">${esc(errors.get(key))}</span>` : `<span class="hint">Markdown · ${MOD === "⌘" ? "⌘" : "ctrl"}+enter posts</span>`}<span class="grow"></span>
        ${key.startsWith("r:") ? `<button class="btn" data-cancel="${esc(key)}">Cancel</button>` : ""}<button class="btn primary" data-post="${esc(key)}">${label}</button></div></div>`;

    function threadHtml(t) {
      const where = `${t.path}${t.line ? `:${t.startLine && t.startLine !== t.line ? `${t.startLine}–` : ""}${t.line}` : ""}`;
      const canGo = !!app.pidAt(t.path, t.line ?? 0);
      const head = `<div class="th" data-tog="${esc(t.id)}" title="${isShut(t) ? "Show" : "Hide"} this thread"><span class="p">${esc(where)}</span>
        ${t.resolved ? `<span class="tag">Resolved</span>` : ""}${t.outdated ? `<span class="tag">Outdated</span>` : ""}<span class="grow"></span>
        ${isShut(t) ? `<span class="tag">${plural(t.comments.length, "comment")}</span>` : ""}
        ${canGo ? `<button class="go" data-go="${esc(t.id)}" title="Open this code in the walk">View code →</button>` : ""}</div>`;
      const items = t.comments.map((c) => `<div class="tc">${avatar(c.author)}<div><div class="who"><b>${esc(c.author.login)}</b> ${when(c.createdAt)}<a href="${esc(c.url)}" target="_blank" rel="noopener" title="Open on GitHub">↗</a></div>
        ${text(c)}</div></div>`).join("");
      const key = `r:${t.comments[0]?.id}`;
      const reply = !t.comments[0] ? "" : replying.has(t.id) ? composer(key, "Reply", "Reply…") : `<button class="replyb" data-reply="${esc(t.id)}">Reply…</button>`;
      return `<div class="thread${isShut(t) ? " shut" : ""}" data-thread="${esc(t.id)}">${head}${items}${reply}</div>`;
    }

    function timelineHtml() {
      const byReview = new Map();
      for (const t of data.threads) if (t.reviewId) (byReview.get(t.reviewId) ?? byReview.set(t.reviewId, []).get(t.reviewId)).push(t);
      const shown = new Set(), out = [];
      const items = [...data.timeline].sort((a, b) => Date.parse(a.createdAt) - Date.parse(b.createdAt));
      for (let k = 0; k < items.length; k++) {
        const it = items[k];
        if (it.kind === "commit") { // a run of commits: one push
          const run = [it];
          while (items[k + 1]?.kind === "commit") run.push(items[++k]);
          const who = [...new Set(run.map((c) => c.author.login))].join(", ");
          out.push(`<div class="item"><div class="event"><span class="ico">⎔</span><span><b>${esc(who)}</b> added ${plural(run.length, "commit")}</span>${when(run.at(-1).createdAt)}</div>
            <div class="commits">${run.map((c) => `<a href="${esc(c.url)}" target="_blank" rel="noopener" title="${esc(c.subject)}"><span class="s">${esc(c.subject)}</span><code>${esc(c.sha.slice(0, 7))}</code></a>`).join("")}</div></div>`);
        } else if (it.kind === "comment") {
          out.push(`<div class="item card" data-item>${avatar(it.author)}<div class="box"><div class="hd"><b>${esc(it.author.login)}</b> commented ${when(it.createdAt)}<span class="grow"></span><a href="${esc(it.url)}" target="_blank" rel="noopener" title="Open on GitHub">↗</a></div>
            <div class="bd">${text(it)}</div></div></div>`);
        } else {
          const threads = byReview.get(it.id) ?? [];
          threads.forEach((t) => shown.add(t.id));
          // A reply in an existing thread is a review of its own, with no text: the reply already shows in its thread.
          if (it.state === "COMMENTED" && !it.body.trim() && !threads.length) continue;
          const [cls, ico] = ICON[it.state] ?? ["", "◉"];
          out.push(`<div class="item review" data-item><div class="event"><span class="ico ${cls}">${ico}</span>${avatar(it.author)}<span><b>${esc(it.author.login)}</b> ${VERB[it.state] ?? "reviewed"}</span>${when(it.createdAt)}<a href="${esc(it.url)}" target="_blank" rel="noopener" title="Open on GitHub">↗</a></div>
            ${it.body.trim() || threads.length ? `<div class="body">${it.body.trim() ? `<div class="box"><div class="bd">${text(it)}</div></div>` : ""}${threads.map(threadHtml).join("")}</div>` : ""}</div>`);
        }
      }
      const rest = data.threads.filter((t) => !shown.has(t.id)); // in a review not in the timeline: your pending one
      if (rest.length) out.push(`<div class="item review" data-item><div class="event"><span class="ico">◌</span><span>In a review still pending on GitHub</span></div><div class="body">${rest.map(threadHtml).join("")}</div></div>`);
      return out.join("");
    }

    function statusHtml() {
      const v = data.verdicts, req = data.requested;
      const approved = v.filter((x) => x.state === "APPROVED"), changes = v.filter((x) => x.state === "CHANGES_REQUESTED");
      const [rcls, rico, rtitle] = changes.length ? ["bad", "±", "Changes requested"] : data.decision === "APPROVED" || (approved.length && data.decision !== "REVIEW_REQUIRED") ? ["ok", "✓", "Approved"]
        : data.decision === "REVIEW_REQUIRED" ? ["wait", "●", "Review required"] : ["", "◌", "No reviews yet"];
      const sub = [approved.length && `${plural(approved.length, "approval")}`, changes.length && `${changes.length} requesting changes`, req.length && `${req.length} waiting`].filter(Boolean).join(" · ");
      const people = [...v.map((x) => `<div>${avatar(x.author)}<b>${esc(x.author.login)}</b> ${x.state === "APPROVED" ? "approved" : x.state === "CHANGES_REQUESTED" ? "requested changes" : "reviewed"}</div>`),
        ...req.map((p) => `<div>${p.avatar ? avatar(p) : `<span class="cav"></span>`}<b>${esc(p.login)}</b> awaiting review</div>`)].join("");
      const reviews = `<section><div class="sh"><span class="dot ${rcls}">${rico}</span>${rtitle}<span class="sub">${esc(sub)}</span></div>${people ? `<div class="people">${people}</div>` : ""}</section>`;

      const by = Object.groupBy ? Object.groupBy(data.checks, (c) => c.status) : data.checks.reduce((m, c) => ((m[c.status] ??= []).push(c), m), {});
      const n = (s) => by[s]?.length ?? 0;
      const [ccls, cico, ctitle] = !data.checks.length ? ["", "◌", "No checks"] : n("failure") ? ["bad", "✕", "Some checks failed"] : n("running") || n("queued") ? ["wait", "●", "Checks running"] : ["ok", "✓", "All checks passed"];
      const csub = ORDER.filter(n).map((s) => `${n(s)} ${s === "failure" ? "failing" : s === "success" ? "successful" : s}`).join(" · ");
      const row = (c) => `<div class="chk"><span class="i ${c.status}">${CHECK[c.status]}</span><span class="n" title="${esc(c.description ?? "")}">${c.workflow ? `<small>${esc(c.workflow)} / </small>` : ""}${esc(c.name)}</span><span class="d">${esc(dur(c))}</span>${c.url ? `<a href="${esc(c.url)}" target="_blank" rel="noopener">Details</a>` : "<span></span>"}</div>`;
      const loud = ORDER.slice(0, 4).flatMap((s) => by[s] ?? []), quiet = ORDER.slice(4).flatMap((s) => by[s] ?? []);
      const checks = `<section><div class="sh"><span class="dot ${ccls}">${cico}</span>${ctitle}<span class="sub">${esc(csub)}</span></div>
        ${data.checks.length ? `<div class="checks">${loud.map(row).join("")}${quiet.length ? `<details${loud.length ? "" : " open"}><summary>${plural(quiet.length, "other check")}</summary>${quiet.map(row).join("")}</details>` : ""}</div>` : ""}</section>`;

      const [mcls, mico, mtitle, msub] = data.state === "MERGED" ? ["ok", "✓", "Merged", ""] : data.state === "CLOSED" ? ["", "✕", "Closed", ""]
        : data.mergeable === "CONFLICTING" ? ["bad", "!", "This branch has conflicts", "Resolve them on GitHub or locally"]
        : data.draft ? ["", "◌", "Draft", "Mark it ready for review on GitHub to merge"]
        : data.mergeable === "MERGEABLE" ? ["ok", "✓", "No conflicts with the base branch", ""] : ["wait", "●", "Checking whether it can merge", ""];
      const merge = `<section><div class="sh"><span class="dot ${mcls}">${mico}</span>${mtitle}<span class="sub">${esc(msub)}</span></div></section>`;
      return `<h2>Status</h2><div class="status">${reviews}${checks}${merge}</div>`;
    }

    function render() {
      if (dead) return;
      // Typing is never interrupted: a refresh waits until you leave the box.
      if (root.contains(document.activeElement) && document.activeElement.tagName === "TEXTAREA") { pending = true; return; }
      pending = false;
      const pr = app.graph.pr, top = root.scrollTop;
      const state = !data ? "" : data.state === "MERGED" ? `<span class="state merged">Merged</span>` : data.state === "CLOSED" ? `<span class="state closed">Closed</span>` : data.draft ? `<span class="state draft">Draft</span>` : `<span class="state">Open</span>`;
      const author = data?.author ?? { login: pr.author };
      const head = `<h1>${esc(pr.title)} <span class="num">#${pr.number}</span></h1>
        <div class="meta">${state}${avatar(author)}<b>${esc(author.login)}</b>${data ? ` wants to merge <code>${esc(data.head)}</code> into <code>${esc(data.base)}</code> · opened ${when(data.createdAt)}` : ""}<span style="flex:1"></span><a href="${esc(pr.url)}" target="_blank" rel="noopener">Open on GitHub ↗</a></div>`;
      const body = data?.body ?? pr.body ?? "";
      const desc = `<div class="item card" data-item>${avatar(author)}<div class="box"><div class="hd"><b>${esc(author.login)}</b> ${data ? `opened this ${when(data.createdAt)}` : "opened this"}</div>
        <div class="bd${body.trim() ? "" : " empty"}">${body.trim() ? text(data?.html ? data : { body }) : "No description provided."}</div></div></div>`;
      const rest = data ? `${timelineHtml()}
          <div class="item card newc" data-item>${avatar(app.me ?? {})}<div class="box"><div class="hd"><b>Add a comment</b><span class="grow"></span><button class="btn" data-act="submit" title="Your drafts on lines, with approve or request changes">Review changes…</button></div>${composer("new", "Comment", "Leave a comment on this PR")}</div></div>
        </div>${statusHtml()}`
        : `</div><div class="note${error ? " err" : ""}">${error ? `Couldn't read the conversation: ${esc(error)}` : "Reading the conversation from GitHub…"}</div>`;
      root.innerHTML = `<div class="col">${head}<div class="tl">${desc}${rest}</div>`;
      root.scrollTop = top;
    }

    async function load(fresh = false) {
      try { data = await api(`/api/conversation${fresh ? "?fresh" : ""}`); error = ""; }
      catch (e) { if (!data) error = e.message; }
      render();
    }

    async function post(key) {
      const box = root.querySelector(`[data-ckey="${CSS.escape(key)}"]`), body = box?.value.trim();
      if (!body) return box?.focus();
      const btn = root.querySelector(`[data-post="${CSS.escape(key)}"]`);
      if (btn) { btn.disabled = true; btn.textContent = "Posting…"; }
      const r = await api(key === "new" ? "/api/conversation/comment" : "/api/conversation/reply", key === "new" ? { body } : { body, to: key.slice(2) }).catch((e) => ({ ok: false, error: e.message }));
      box.blur();
      if (!r.ok) { errors.set(key, r.error); drafts.set(key, box.value); return render(); }
      errors.delete(key); drafts.delete(key);
      for (const t of data.threads) if (`r:${t.comments[0]?.id}` === key) replying.delete(t.id);
      await load(true);
    }

    root.addEventListener("input", (ev) => { const k = ev.target.dataset?.ckey; if (k) drafts.set(k, ev.target.value); });
    root.addEventListener("focusout", () => setTimeout(() => pending && render(), 0));
    root.addEventListener("keydown", (ev) => {
      const k = ev.target.dataset?.ckey;
      if (k && ev.key === "Enter" && (ev.metaKey || ev.ctrlKey)) { ev.preventDefault(); post(k); }
      else if (k && ev.key === "Escape" && k.startsWith("r:") && !ev.target.value.trim()) { ev.stopPropagation(); cancel(k); }
    });
    const cancel = (key) => { drafts.delete(key); errors.delete(key); for (const t of data.threads) if (`r:${t.comments[0]?.id}` === key) replying.delete(t.id); document.activeElement?.blur(); render(); };
    root.addEventListener("click", (ev) => {
      const t = ev.target.closest("[data-go],[data-tog],[data-reply],[data-post],[data-cancel]");
      if (!t) return;
      const ds = t.dataset, thread = (id) => data.threads.find((x) => x.id === id);
      if (ds.go) {
        ev.stopPropagation();
        const th = thread(ds.go), pid = th && app.pidAt(th.path, th.line ?? 0);
        if (!pid) return;
        app.switchView(app.prevView && app.prevView !== "conversation" ? app.prevView : "flow");
        app.setFocus(pid, { level: 2 });
      } else if (ds.tog) { const th = thread(ds.tog); shut.set(ds.tog, !isShut(th)); render(); }
      else if (ds.reply) { replying.add(ds.reply); render(); root.querySelector(`[data-thread="${CSS.escape(ds.reply)}"] textarea`)?.focus(); }
      else if (ds.post) post(ds.post);
      else if (ds.cancel) cancel(ds.cancel);
    });

    // j / k: from item to item (the description, each comment and review, the comment box)
    const step = (dir) => {
      const items = [...root.querySelectorAll("[data-item]")], top = root.getBoundingClientRect().top + 8;
      const at = items.findIndex((x) => x.getBoundingClientRect().top > top + 1);
      const cur = at < 0 ? items.length : at;
      const to = items[Math.max(0, Math.min(items.length - 1, dir > 0 ? cur : cur - 2))];
      if (to) root.scrollTo({ top: root.scrollTop + to.getBoundingClientRect().top - top, behavior: "smooth" });
    };

    render();
    load();
    const timer = setInterval(() => document.visibilityState === "visible" && load(), 30_000);
    return {
      update(why) { if (why === "settings" || why === "comments") render(); },
      destroy() { dead = true; clearInterval(timer); root.remove(); },
      keys: { next: () => step(1), prev: () => step(-1), down: () => step(1), up: () => step(-1) },
    };
  },
};
