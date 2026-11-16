// The first launch's setup page (/welcome): GitHub's CLI, then Claude Code, each installed and signed in from here (or
// skipped), then on to where you were going (?next=, a page of Bobby's own). Until it's finished the server sends every
// page here (onboarding.ts). Each step is the same setup the palette and Settings open, drawn into its step.
import { mountGh } from "/app/gh-setup.js";
import { mountClaude } from "/app/claude-setup.js";

const $ = (s) => document.querySelector(s);
const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);
const raw = new URLSearchParams(location.search).get("next");
const own = raw && raw.startsWith("/") && !raw.startsWith("//") && !raw.startsWith("/\\") && !raw.startsWith("/welcome");
const next = (own ? raw : "/") + location.hash; // the browser kept the #fragment through the server's redirect
const go = $("[data-go]");
const state = { gh: "", claude: "" }; // "" while it's being set up, then "done" or "skipped"
const step = (k) => $(`[data-step="${k}"]`);

function open(k) {
  step(k).classList.add("on");
  const body = step(k).querySelector(".body");
  if (k === "gh") mountGh(body, { onReady: (s) => settle("gh", "done", s.login ? `Signed in as ${s.login}` : "Signed in"), onSkip: () => settle("gh", "skipped", "Skipped") });
  else mountClaude(body, { onReady: (s) => settle("claude", "done", s.email ? `Signed in as ${s.email}` : "Signed in"), onSkip: () => settle("claude", "skipped", "Skipped") });
}
function settle(k, how, tag) {
  if (state[k]) return;
  state[k] = how;
  const el = step(k);
  el.classList.remove("on");
  el.classList.add(how);
  el.querySelector(".n").textContent = how === "done" ? "✓" : "–";
  el.querySelector(".tag").textContent = tag;
  if (k === "gh") open("claude");
  ready();
}
function ready() {
  const done = state.gh && state.claude;
  go.disabled = !done;
  const opening = new URLSearchParams(next.split("?")[1]?.split("#")[0] ?? "").get("open");
  $("[data-note]").innerHTML = !done ? "" : opening ? `Then Bobby opens <b>${esc(opening)}</b>.` : next.startsWith("/r/") ? "Then Bobby opens the review you asked for." : "Set either up later from Settings, or the command palette (⌘K).";
  if (done) go.focus();
}

go.addEventListener("click", async () => {
  go.disabled = true;
  const r = await fetch("/api/onboarding/done", { method: "POST", headers: { "content-type": "application/json" }, body: "{}" }).catch(() => null);
  if (!r?.ok) { go.disabled = false; const e = $("[data-err]"); e.hidden = false; e.textContent = `Couldn't save that setup is done${r ? ` (${r.status})` : ""}: is Bobby still running?`; return; }
  location.replace(next);
});

open("gh");
