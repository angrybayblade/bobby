// Agent-assisted review (a first cut, on Claude Code; agent.ts): ask Claude to review the PR, watch what it's reading
// in the top bar, and go through its findings, shown on their lines as suggestions. Each one becomes a draft of yours
// (Add to review) or goes away (Dismiss); nothing is posted until you submit, as with your own drafts.
import { api, esc, live } from "./core.js";
import { offerClaude } from "./claude-setup.js";

let seen = null; // the status last drawn from
/** From each status poll: redraws the pill when it changed, and fetches the findings when a review lands. True while
 *  one runs (poll quickly). */
export async function agentPoll(app, s) {
  const st = s.agent ?? { running: false, open: 0 }, was = app.agent;
  app.agent = st;
  const sig = JSON.stringify([st.running, st.step, st.error, st.at, st.open]);
  if (sig !== seen) {
    const first = seen === null;
    seen = sig;
    if (st.at !== app.agentReview?.at || (!st.at && app.agentReview)) await loadFindings(app);
    app.emit("view");
    if (!first && was?.running && !st.running) {
      if (st.error && st.error !== "Stopped") app.toast?.(`<span>Claude's review failed: ${esc(st.error)}</span> <button class="btn" data-act="agent-review">Try again</button>`, 12000);
      else if (!st.error) app.toast?.(`<span>Claude's review is in: ${st.open ? `${st.open} finding${st.open > 1 ? "s" : ""} on their lines. Add each to your review, or dismiss it.` : "nothing to raise."}</span>${st.open ? ` <button class="btn" data-act="agent-next">Go to the first</button>` : ""}`, 12000);
    }
  }
  return st.running;
}
async function loadFindings(app) {
  const r = await api("/api/agent").catch(() => null);
  app.agentReview = r?.review ?? null;
  app.emit("comments");
}

/** Asks Claude to review the PR (setting Claude Code up first, if it isn't). */
export async function startAgentReview(app) {
  if (app.agent?.running) return;
  const st = await fetch("/api/claude").then((r) => r.json()).catch(() => null);
  if (st && !(st.installed && st.loggedIn)) { await offerClaude({ force: true }); return; }
  const r = await api("/api/agent/start", {}).catch((e) => ({ ok: false, error: e.message }));
  if (!r.ok) return app.toast?.(`<span>Couldn't start Claude's review: ${esc(r.error)}</span>`, 8000);
  app.agent = { running: true, step: "Starting", open: 0 };
  app.emit("view");
  app.watchServers?.(); // poll now, and quickly while it runs
}
export const cancelAgentReview = (app) => api("/api/agent/cancel", {}).then(() => app.watchServers?.());

/** Adds a finding to your drafts, dismisses it, or brings a dismissed one back. */
export async function findingAct(app, id, act) {
  const r = await api("/api/agent/finding", { id, act }).catch((e) => ({ ok: false, error: e.message }));
  if (!r.ok) return app.toast?.(`<span>Couldn't do that: ${esc(r.error)}</span>`, 8000);
  app.agentReview = r.review;
  if (r.comment) app.state.comments.push(r.comment);
  app.agent = { ...app.agent, open: r.review.findings.filter((f) => f.status === "open").length };
  if (act === "dismiss") app.offerUndo?.("Finding dismissed", () => findingAct(app, id, "restore"));
  app.emit("comments");
  app.emit("view");
}

/** The open findings, in walk order (those on a page you can see). */
export function openFindings(app) {
  const pos = (pid) => app.index.walkPos.get(pid) ?? Infinity;
  return (app.agentReview?.findings ?? []).filter((f) => f.status === "open")
    .map((f) => ({ f, pid: app.pidAt(f.path, f.line) })).filter((x) => x.pid)
    .sort((a, b) => pos(a.pid) - pos(b.pid) || a.f.line - b.f.line);
}
let last = null;
/** The next open finding after the last one gone to, opened and in view. Wraps around. */
export function nextFinding(app) {
  const list = openFindings(app);
  if (!list.length) return false;
  const was = list.findIndex((x) => x.f.id === last), here = app.index.walkPos.get(app.focus) ?? -1;
  const t = was >= 0 ? list[(was + 1) % list.length] : list.find((x) => app.index.walkPos.get(x.pid) >= here) ?? list[0];
  last = t.f.id;
  if (app.settings.view === "conversation") app.switchView("diff");
  app.setFocus(t.pid, { level: 2 });
  app.emit("comments");
  setTimeout(() => {
    const el = [...document.querySelectorAll(`.cthread[data-thread="a:${CSS.escape(t.f.id)}"]`)].find(live);
    if (!el) return;
    el.scrollIntoView({ block: "center", behavior: "smooth" });
    el.classList.remove("cflash"); void el.offsetWidth; el.classList.add("cflash");
  }, 60);
  return true;
}

/** The top bar's pill: Review with Claude; what it's doing while it runs; then its open findings. */
export function agentPill(app) {
  const a = app.agent;
  if (!a) return "";
  if (a.running) return `<button class="pill pulse agpill" data-act="agent-cancel" title="Claude is reviewing the PR: ${esc(a.step ?? "")}. Click to stop it">✦ ${esc(short(a.step ?? "Reviewing"))}…</button>`;
  if (a.open) return `<button class="pill signal agpill" data-act="agent-next" title="Claude's findings: go to the next one">✦ ${a.open} finding${a.open > 1 ? "s" : ""}</button>`;
  return `<button class="pill agpill" data-act="agent-review" title="${a.at ? "Claude found nothing more to raise. Ask it to review again" : "Ask Claude to review the PR: it reads the code around the changes and suggests comments on their lines, for you to add or dismiss"}">✦ ${a.at ? "Review again" : "Review with Claude"}</button>`;
}
const short = (s) => (s.length > 36 ? `${s.slice(0, 35)}…` : s);
