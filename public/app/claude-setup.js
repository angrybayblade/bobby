// Setting up Claude Code, from the page: offered the first time Bobby runs without it (installed and signed in), and
// any time from the palette or Settings. Install it (Anthropic's installer, run by Bobby), then sign in: Bobby gets a
// sign-in link from `claude auth login`, you open it in a tab, sign in, and paste back the code it shows. Works the same
// on a remote machine. Used by the home page and the review page alike, so it brings its own overlay.
const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);
const call = async (path, body) => {
  const r = await fetch(`/api/claude${path}`, body ? { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) } : {});
  return r.json().catch(() => ({ ok: false, error: `${r.status} ${r.statusText}` }));
};

let el = null, timer = null, st = null, busy = "", returnTo = null;

/** Offers the setup if Claude isn't ready and you haven't said not now or never; with force, opens it whatever. */
export async function offerClaude({ force = false } = {}) {
  const s = await call("").catch(() => null);
  if (!s || (!force && !s.ask) || el) return;
  show(s);
}

function show(s) {
  st = s;
  if (!el) {
    returnTo = document.activeElement;
    el = Object.assign(document.createElement("div"), { className: "cs-overlay" });
    el.addEventListener("click", onClick);
    el.addEventListener("keydown", onKey);
    document.body.append(el);
  }
  const done = st.installed && st.loggedIn;
  el.innerHTML = `<div class="modal csetup" role="dialog" aria-modal="true" aria-labelledby="cs-h" tabindex="-1">${body()}</div>`;
  (el.querySelector("input") ?? el.querySelector(".btn.primary") ?? el.querySelector(".modal"))?.focus();
  clearTimeout(timer); // installing, or waiting on the sign-in: look again shortly
  if (st.step === "installing" || st.step === "verifying" || busy) timer = setTimeout(refresh, 1200);
  if (done) busy = "";
}
async function refresh() { if (el) show(await call("").catch(() => st)); }
function close() {
  clearTimeout(timer);
  el?.remove(); el = null; busy = "";
  if (returnTo?.isConnected) returnTo.focus({ preventScroll: true });
}

function body() {
  const err = st.error ? `<p class="cs-err">${esc(st.error)}</p>` : "";
  const later = `<button class="btn" data-cs="later">Not now</button><button class="btn quiet" data-cs="never" title="You can still set it up from Settings, or the command palette">Don't ask again</button>`;
  if (st.step === "installing") return `<h2 id="cs-h">Installing Claude Code…</h2>
    <p>Anthropic's installer is running. It takes about a minute.</p><pre class="cs-log">${esc(st.log || "Starting…")}</pre>`;
  if (!st.installed) return `<h2 id="cs-h">Set up Claude Code?</h2>
    <p>Bobby works without it. With it, Bobby also asks Claude to organise each PR: the change in a few cores, foundations first, what each relies on and affects, and a question to look into for each.</p>
    <p>It runs here, with your own Claude account; the PR's code goes to Anthropic to do it (<a href="https://bobby.viraj.computer/docs/privacy.html" target="_blank" rel="noopener">what leaves your machine</a>). Bobby installs it with Anthropic's installer:</p>
    <code class="cs-cmd">${esc(st.install)}</code>${err}
    <div class="row"><button class="btn primary" data-cs="install">Install Claude Code</button>${later}</div>`;
  if (!st.loggedIn && st.url && st.step !== "idle") return `<h2 id="cs-h">Sign in to Claude</h2>
    <ol class="cs-steps">
      <li><a class="btn primary" href="${esc(st.url)}" target="_blank" rel="noopener" data-cs="opened">Open the sign-in page ↗</a></li>
      <li>Sign in with your Claude account, and authorize Claude Code. The page then shows a code: copy it.</li>
      <li>Paste it here:<div class="cs-code"><input name="code" placeholder="Paste the code" autocomplete="off" spellcheck="false"${st.step === "verifying" ? " disabled" : ""}><button class="btn primary" data-cs="code"${st.step === "verifying" ? " disabled" : ""}>${st.step === "verifying" ? "Signing in…" : "Sign in"}</button></div></li>
    </ol>${err}
    <div class="row"><button class="btn" data-cs="cancel">Cancel</button></div>`;
  if (!st.loggedIn) return `<h2 id="cs-h">Sign in to Claude</h2>
    <p>Claude Code ${esc(st.version ?? "")} is installed, but not signed in. Bobby gets a sign-in link from it: you open it, sign in with your Claude account, and paste back the code it shows.</p>${err}
    <div class="row"><button class="btn primary" data-cs="login"${busy === "login" ? " disabled" : ""}>${busy === "login" ? "Getting a link…" : "Get a sign-in link"}</button>${later}</div>`;
  return `<h2 id="cs-h">Claude is ready</h2>
    <p>Claude Code ${esc(st.version ?? "")} is signed in${st.email ? ` as <b>${esc(st.email)}</b>` : ""}${st.method ? ` (${esc(st.method)})` : ""}. Bobby asks it for the reviews you open, and the open ones that went without are asking it now.</p>
    <div class="row"><button class="btn primary" data-cs="close">Done</button></div>`;
}

async function onClick(ev) {
  if (ev.target === el) return st.step === "installing" || st.step === "verifying" ? undefined : close(); // the backdrop
  const t = ev.target.closest("[data-cs]");
  if (!t) return;
  const what = t.dataset.cs;
  if (what === "opened") return setTimeout(() => el?.querySelector("input")?.focus(), 300); // back from the tab: ready to paste
  if (what === "close") return close();
  if (what === "later" || what === "never") { await call("/dismiss", { never: what === "never" }); return close(); }
  if (what === "cancel") { await call("/cancel", {}); return show(await call("")); }
  if (what === "install") { show(await call("/install", {})); return; }
  if (what === "login") { busy = "login"; show(st); const r = await call("/login", {}); busy = ""; return show(r); }
  if (what === "code") return sendCode();
}
async function sendCode() {
  const code = el.querySelector("input[name=code]")?.value.trim();
  if (!code) return el.querySelector("input")?.focus();
  show({ ...st, step: "verifying", error: undefined });
  show(await call("/code", { code }));
}
function onKey(ev) {
  ev.stopPropagation(); // the page's keys stay out of the dialog
  if (ev.key === "Enter" && ev.target.matches("input[name=code]")) { ev.preventDefault(); sendCode(); }
  if (ev.key === "Escape" && st.step !== "installing" && st.step !== "verifying") close();
}
