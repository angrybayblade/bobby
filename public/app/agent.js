// Agent-assisted review (a first cut, on Claude Code; agent.ts): ask Claude to review the PR, watch what it's reading
// in the top bar, and go through its findings one at a time (agent-walk.js); they also sit on their lines as
// suggestions. Each one becomes a draft of yours (Add to review) or goes away (Dismiss); nothing is posted until you
// submit, as with your own drafts.
import { api, esc } from "./core.js";
import { offerClaude } from "./claude-setup.js";
import { openWalk } from "./agent-walk.js";

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
      else if (!st.error) app.toast?.(`<span>Claude's review is in: ${st.open ? `${st.open} finding${st.open > 1 ? "s" : ""} on their lines. Add each to your review, or dismiss it.` : "nothing to raise."}</span>${st.open ? ` <button class="btn" data-act="agent-next">Go through them</button>` : ""}`, 12000);
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
export async function findingAct(app, id, act, body, undo = true) {
  const r = await api("/api/agent/finding", { id, act, ...(body != null ? { body } : {}) }).catch((e) => ({ ok: false, error: e.message }));
  if (!r.ok) return app.toast?.(`<span>Couldn't do that: ${esc(r.error)}</span>`, 8000);
  app.agentReview = r.review;
  if (r.comment) app.state.comments.push(r.comment);
  app.agent = { ...app.agent, open: r.review.findings.filter((f) => f.status === "open").length };
  if (act === "dismiss" && undo) app.offerUndo?.("Finding dismissed", () => findingAct(app, id, "restore"));
  app.emit("comments");
  app.emit("view");
}

/** Goes through the open findings, one at a time. False when there are none. */
export const nextFinding = (app) => openWalk(app);

/** The top bar's pill: Review with Claude; what it's doing while it runs; then its open findings. */
export function agentPill(app) {
  const a = app.agent;
  if (!a) return "";
  if (a.running) return `<button class="pill pulse agpill" data-act="agent-cancel" title="Claude is reviewing the PR: ${esc(a.step ?? "")}. Click to stop it">✦ ${esc(short(a.step ?? "Reviewing"))}…</button>`;
  if (a.open) return `<button class="pill signal agpill" data-act="agent-next" title="Go through Claude's findings, one at a time">✦ ${a.open} finding${a.open > 1 ? "s" : ""}</button>`;
  return `<button class="pill agpill" data-act="agent-review" title="${a.at ? "Claude found nothing more to raise. Ask it to review again" : "Ask Claude to review the PR: it reads the code around the changes and suggests comments on their lines, for you to add or dismiss"}">✦ ${a.at ? "Review again" : "Review with Claude"}</button>`;
}
const short = (s) => (s.length > 36 ? `${s.slice(0, 35)}…` : s);
