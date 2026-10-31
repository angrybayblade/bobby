// Agent-assisted review (a first cut, on Claude Code; agent.ts). Nothing happens until you ask: the top bar's pill
// opens a prompt (what Claude should focus on, if anything), then shows what Claude is doing, then says it's done
// ("3 findings"); a click on that goes through them one at a time (agent-walk.js). They also sit on their lines as
// suggestions. Each one becomes a draft of yours (Add to review) or goes away (Dismiss); nothing is posted until you
// submit, as with your own drafts.
import { ICONS } from "./chrome.js";
import { api, esc } from "./core.js";
import { offerClaude } from "./claude-setup.js";
import { MOD } from "./palette.js";
import { openWalk } from "./agent-walk.js";
import { keepPlace } from "./comments.js";

let seen = null; // the status last drawn from
/** From each status poll: redraws the pill (and the prompt, if open) when it changed, and fetches the findings when a
 *  review lands. True while one runs (poll quickly). */
export async function agentPoll(app, s) {
  const st = s.agent ?? { running: false, open: 0 };
  app.agent = st;
  const sig = JSON.stringify([st.running, st.steps, st.error, st.at, st.open]);
  if (sig === seen) return st.running;
  seen = sig;
  if (st.at !== app.agentReview?.at || (!st.at && app.agentReview)) await loadFindings(app);
  app.emit("view");
  if (ask) drawAsk();
  return st.running;
}
async function loadFindings(app) {
  const r = await api("/api/agent").catch(() => null);
  app.agentReview = r?.review ?? null;
  keepPlace(app);
}

/** Adds a finding to your drafts, dismisses it, or brings a dismissed one back. */
export async function findingAct(app, id, act, body, undo = true) {
  const r = await api("/api/agent/finding", { id, act, ...(body != null ? { body } : {}) }).catch((e) => ({ ok: false, error: e.message }));
  if (!r.ok) return app.toast?.(`<span>Couldn't do that: ${esc(r.error)}</span>`, 8000);
  app.agentReview = r.review;
  if (r.comment) app.state.comments.push(r.comment);
  app.agent = { ...app.agent, open: r.review.findings.filter((f) => f.status === "open").length };
  if (act === "dismiss" && undo) app.offerUndo?.("Finding dismissed", () => findingAct(app, id, "restore"));
  keepPlace(app);
  app.emit("view");
}

/** The pill's click: the findings if there are any left, else the prompt (or, while it runs, its progress). */
export function agentPillClick(app) {
  if (!app.agent?.running && app.agent?.open && openWalk(app, null, () => openAsk(app))) return;
  openAsk(app);
}
/** Goes through the open findings, one at a time. False when there are none. */
export const nextFinding = (app) => openWalk(app, null, () => openAsk(app));

/** The top bar's pill: Review with Claude; Claude at work; then, as the notice that it's done, its findings. */
export function agentPill(app) {
  const a = app.agent;
  if (!a) return "";
  const failed = !a.running && a.error && a.error !== "Stopped" && errorSeen !== a.error;
  // at rest, an icon; while it works or has something to say, a pill that says so
  const tipped = (name, more) => `data-tip="${esc(name)}" data-tip-more="${esc(more)}"`;
  if (!a.running && !failed && !a.open) {
    const nothing = app.agentReview && !app.agentReview.findings.length;
    return `<button class="iconbtn agpill" data-act="agent" aria-label="Review with Claude" ${tipped("Review with Claude", nothing ? "Claude's last review found nothing to raise. Click to ask again, about something in particular"
      : "Ask Claude to review the PR, about what you choose; it suggests comments for you to add or dismiss")}>${ICONS.claude}</button>`;
  }
  const [cls, text, name, more] = a.running ? ["pulse", "Reviewing…", "Claude is reviewing", `${a.step ?? ""}. Click to see what it's doing, or stop it`]
    : failed ? ["", "Claude's review failed", "Claude's review failed", a.error]
    : ["signal", `${a.open} finding${a.open > 1 ? "s" : ""}`, "Claude's findings", "Go through them, one at a time"];
  return `<button class="pill agpill ${cls}" data-act="agent" ${tipped(name, more)}>✦ ${esc(text)}</button>`;
}
let errorSeen = null;

// ---- the prompt: what to focus on, then (while it runs) what Claude is doing
const IDEAS = [
  ["Bugs and edge cases", "Look hard for bugs and missed edge cases in the changed logic."],
  ["Callers", "Check every caller of what changed: can any of them break?"],
  ["Security", "Look for security problems: auth, input validation, secrets, injection."],
  ["Errors", "Check error handling: what happens when each call fails?"],
  ["Concurrency", "Look for races, ordering and retry problems."],
  ["Tests", "Are the changes tested? What important case is missing a test?"],
];
let ask = null; // { app, el, text, returnTo, starting }
export function openAsk(app, { tools = false } = {}) {
  if (ask) { if (tools) { ask.tools.open = true; drawAsk(); } return; }
  ask = { app, text: "", returnTo: document.activeElement, tools: { open: tools } };
  void loadTools();
  ask.el = Object.assign(document.createElement("div"), { className: "cs-overlay" });
  ask.el.addEventListener("click", onAskClick);
  ask.el.addEventListener("keydown", onAskKey);
  ask.el.addEventListener("input", (ev) => { if (ev.target.matches("textarea")) ask.text = ev.target.value; });
  document.body.append(ask.el);
  if (app.agent?.error) errorSeen = app.agent.error; // the pill's "failed" is a notice: seen now
  app.emit("view");
  drawAsk();
}
function closeAsk() {
  if (!ask) return;
  ask.el.remove();
  if (ask.returnTo?.isConnected) ask.returnTo.focus({ preventScroll: true });
  ask = null;
}
function drawAsk() {
  const a = ask.app.agent ?? {}, review = ask.app.agentReview;
  let html;
  if (a.running || ask.starting) {
    const steps = a.steps?.length ? a.steps : ["Starting"];
    html = `<h2 id="ag-h">Claude is reviewing…</h2>
      ${(a.focus ?? ask.focus) ? `<p>Focusing on: <i>${esc(a.focus ?? ask.focus)}</i></p>` : `<p>Reading the diff, then checking the code around it.</p>`}
      <ol class="ag-steps">${steps.map((s, k) => `<li${k === steps.length - 1 ? ` class="now"` : ""}>${esc(s)}</li>`).join("")}</ol>
      <p class="ag-muted">It usually takes a minute or two. Close this and keep reviewing: the ✦ pill says when it's done.</p>
      <div class="row"><button class="btn primary" data-ag="close">Keep reviewing</button><button class="btn" data-ag="stop">Stop it</button></div>`;
  } else {
    const left = review?.findings.filter((f) => f.status === "open").length ?? 0;
    const err = a.error && a.error !== "Stopped" ? `<p class="cs-err">The last review failed: ${esc(a.error)}</p>` : "";
    html = `<h2 id="ag-h">Review with Claude</h2>
      <p>Claude reads the diff and checks the code around it, then suggests comments for you to add or dismiss. Nothing is posted unless you add it and submit.</p>
      <label class="ag-label" for="ag-text">What should it focus on? <span>Optional</span></label>
      <textarea id="ag-text" class="ag-text" rows="3" placeholder="e.g. Could this break existing API clients? Is the retry logic safe under load?">${esc(ask.text)}</textarea>
      <div class="ag-ideas">${IDEAS.map(([t], k) => `<button class="ag-idea" data-idea="${k}">${esc(t)}</button>`).join("")}</div>
      ${toolsHtml()}
      ${review ? `<p class="ag-muted">This replaces the last review${left ? `, and its ${left} finding${left > 1 ? "s" : ""} you haven't added or dismissed` : ""}. What you've added to your review stays.</p>` : ""}${err}
      <div class="row"><button class="btn primary" data-ag="start">Start review <kbd>${MOD}↵</kbd></button><button class="btn" data-ag="close">Cancel</button></div>`;
  }
  const had = ask.el.querySelector("textarea");
  ask.el.innerHTML = `<div class="modal csetup agask" role="dialog" aria-modal="true" aria-labelledby="ag-h" tabindex="-1">${html}</div>`;
  const ta = ask.el.querySelector("textarea");
  if (ta) { ta.focus(); ta.setSelectionRange(ta.value.length, ta.value.length); }
  else if (!had || !ask.el.contains(document.activeElement)) (ask.el.querySelector(".btn.primary") ?? ask.el.querySelector(".modal")).focus();
}

// ---- your own tools for Claude (connected.ts): what this PR lets it use, each Off, Read or All
async function loadTools(fresh = false) {
  ask.tools.loading = true;
  const j = await api(`/api/agent/tools${fresh ? "?fresh=1" : ""}`).catch((e) => ({ ok: false, error: e.message }));
  if (!ask) return;
  Object.assign(ask.tools, { loading: false, data: j.ok ? j : null, error: j.ok ? null : j.error });
  if (!ask.app.agent?.running && !ask.starting) drawAsk();
}
const short = (name) => name.replace(/^claude\.ai /, "");
function toolsHtml() {
  const t = ask.tools, d = t.data;
  const on = d ? Object.entries(d.selection) : [];
  const summary = t.loading && !d ? "checking your Claude Code setup…" : t.error ? "couldn't read your Claude Code setup" : on.length
    ? on.map(([n, a]) => `${esc(short(n))}${a === "all" ? " (all)" : ""}`).join(", ") : "none";
  const head = `<button class="ag-tools-h" data-ag="tools" aria-expanded="${!!t.open}"><span>Your tools for this PR: <b>${summary}</b>${d && on.length ? `<span class="ag-src">${d.source === "pr" ? "this PR" : "launch default"}</span>` : ""}</span><span class="ag-chev">${t.open ? "▴" : "▾"}</span></button>`;
  if (!t.open) return `<div class="ag-tools">${head}</div>`;
  const body = t.error ? `<p class="cs-err">${esc(t.error)}</p><button class="btn" data-ag="tools-retry">Try again</button>`
    : !d ? `<p class="ag-muted">Asking Claude Code what you have connected…</p>`
    : !d.servers.length ? `<p class="ag-muted">Your Claude Code has no MCP servers or connectors.</p>`
    : `<p class="ag-muted">Your MCP servers and claude.ai connectors, for context the code doesn't have: the PR's ticket, docs, discussions, alerts. <b>Read</b> lets Claude use only the tools that read; <b>All</b> lets it post and change things too.</p>
      <div class="ag-tlist">${d.servers.map((v) => { const cur = d.selection[v.name] ?? "off";
        return `<div class="ag-trow"><span class="ag-tname">${esc(short(v.name))}${v.name.startsWith("claude.ai ") ? `<span class="ag-ttag">connector</span>` : ""}${v.status !== "connected" ? `<span class="ag-ttag warn">${esc(v.status)}</span>` : ""}<span class="ag-tn">${v.read} read · ${v.write} other</span></span>
          <span class="ag-seg" role="group" aria-label="${esc(short(v.name))}">${["off", "read", "all"].map((x) => `<button data-tool="${esc(v.name)}" data-to="${x}" aria-pressed="${cur === x}">${x === "off" ? "Off" : x === "read" ? "Read" : "All"}</button>`).join("")}</span></div>`; }).join("")}</div>
      <div class="ag-tfoot">${d.source === "pr" ? `<button class="ag-link" data-ag="tools-reset">Use the launch default${d.spec ? ` (${esc(d.spec)})` : " (none)"}</button>` : `<span class="ag-muted">${d.spec ? `From --agent-tools ${esc(d.spec)}; a change here is for this PR.` : "A change here is for this PR; --agent-tools sets it for every PR."}</span>`}<button class="ag-link" data-ag="tools-refresh">Refresh</button></div>`;
  return `<div class="ag-tools open">${head}<div class="ag-tbody">${body}</div></div>`;
}
async function setTool(name, to) {
  const d = ask.tools.data;
  const sel = { ...d.selection };
  if (to === "off") delete sel[name]; else sel[name] = to;
  Object.assign(d, { selection: sel, source: "pr" });
  drawAsk();
  await api("/api/agent/tools", { selection: sel }).catch((e) => ask?.app.toast?.(`<span>Couldn't save that: ${esc(e.message)}</span>`, 6000));
}

async function start() {
  const app = ask.app, focus = ask.text.trim();
  const st = await fetch("/api/claude").then((r) => r.json()).catch(() => null);
  if (st && !(st.installed && st.loggedIn)) { closeAsk(); await offerClaude({ force: true }); return; }
  ask.starting = true; ask.focus = focus;
  drawAsk();
  const r = await api("/api/agent/start", focus ? { focus } : {}).catch((e) => ({ ok: false, error: e.message }));
  if (!ask) return;
  ask.starting = false;
  if (!r.ok) { app.agent = { ...app.agent, error: r.error }; return drawAsk(); }
  app.agent = { ...app.agent, running: true, step: "Starting", steps: ["Starting"], error: undefined };
  app.emit("view");
  drawAsk();
  app.watchServers?.(); // poll now, and quickly while it runs
}
function onAskClick(ev) {
  if (ev.target === ask.el) return closeAsk(); // the backdrop
  const idea = ev.target.closest("[data-idea]");
  if (idea) {
    const t = IDEAS[Number(idea.dataset.idea)][1];
    ask.text = ask.text.includes(t) ? ask.text : `${ask.text.trim()}${ask.text.trim() ? "\n" : ""}${t}`;
    return drawAsk();
  }
  const tool = ev.target.closest("[data-tool]");
  if (tool) return void setTool(tool.dataset.tool, tool.dataset.to);
  const b = ev.target.closest("[data-ag]");
  if (!b) return;
  const what = b.dataset.ag;
  if (what === "tools") { ask.tools.open = !ask.tools.open; return drawAsk(); }
  if (what === "tools-retry" || what === "tools-refresh") { ask.tools.data = what === "tools-retry" ? null : ask.tools.data; drawAsk(); return void loadTools(true); }
  if (what === "tools-reset") { void api("/api/agent/tools", { selection: null }).then(() => loadTools()); return; }
  if (what === "close") return closeAsk();
  if (what === "start") return void start();
  if (what === "stop") { b.disabled = true; void api("/api/agent/cancel", {}).then(() => ask?.app.watchServers?.()); }
}
function onAskKey(ev) {
  ev.stopPropagation(); // the page's keys stay out of the dialog
  if (ev.key === "Escape") { ev.preventDefault(); return closeAsk(); }
  if (ev.key === "Enter" && (ev.metaKey || ev.ctrlKey) && !ask.app.agent?.running && !ask.starting) { ev.preventDefault(); void start(); }
}
