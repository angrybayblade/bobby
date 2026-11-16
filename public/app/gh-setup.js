// Setting up GitHub's CLI, gh, from the page: offered the first time Bobby runs without it (installed and signed in),
// and any time from the palette or Settings. Install it (Bobby downloads it from GitHub's releases), then sign in: Bobby
// gets a one-time code from `gh auth login`, you enter it on github.com and authorize, and Bobby notices. Works the same
// on a remote machine. A PR asked for before gh was set up is opened once it is. Brings its own overlay, as
// claude-setup.js does; or draws into a page's own box (mountGh), as the first launch's setup page does.
const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);
const call = async (path, body) => {
  const r = await fetch(`/api/gh${path}`, body ? { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) } : {});
  return r.json().catch(() => ({ ok: false, error: `${r.status} ${r.statusText}` }));
};
const ready = (s) => s.installed && s.loggedIn;

let el = null, box = null, inline = null, timer = null, st = null, busy = "", returnTo = null, then = null, onReady = null, settle = null, copied = false;

/** Offers the setup if gh isn't ready and you haven't said not now or never; with force, opens it whatever. then: a PR
 *  to open once it's ready. onReady: called when it becomes ready here. Resolves when the dialog closes (or isn't shown). */
export async function offerGh({ force = false, then: pr = null, onReady: cb = null } = {}) {
  const s = await call("").catch(() => null);
  if (!s) return;
  if (ready(s)) return pr ? openPr(pr) : undefined;
  if ((!force && !s.ask) || el || inline) return;
  then = pr; onReady = cb; copied = false;
  show(s);
  return new Promise((r) => { settle = r; });
}

/** Draws the setup into container, for a page of its own: onReady once gh is set up (at once, if it already is), onSkip
 *  when you skip it (saved as "don't ask again": Settings and the palette still set it up). */
export async function mountGh(container, { onReady: ready = null, onSkip = null } = {}) {
  box = container; inline = { onSkip }; onReady = ready; then = null; st = null;
  box.addEventListener("click", onClick);
  show(await call("").catch((e) => ({ installed: false, loggedIn: false, step: "idle", error: String(e) })));
}

async function openPr(arg) {
  const r = await fetch("/api/open", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ arg }) });
  const j = await r.json().catch(() => ({}));
  if (j.id) { location.href = `/r/${j.id}`; return true; }
  if (st) { st = { ...st, error: `Couldn't open ${arg}: ${j.error ?? r.statusText}` }; if (el || inline) show(st); }
  return false;
}

function show(s) {
  const was = st && ready(st);
  st = s;
  if (!inline && !el) {
    returnTo = document.activeElement;
    box = el = Object.assign(document.createElement("div"), { className: "cs-overlay" });
    el.addEventListener("click", onClick);
    el.addEventListener("keydown", onKey);
    document.body.append(el);
  }
  const away = inline && document.activeElement && document.activeElement !== document.body && !box.contains(document.activeElement);
  box.innerHTML = inline ? `<div class="csetup inline">${body()}</div>` : `<div class="modal csetup" role="dialog" aria-modal="true" aria-labelledby="gs-h" tabindex="-1">${body()}</div>`;
  if (!away) (box.querySelector(".btn.primary") ?? box.querySelector(".modal"))?.focus({ preventScroll: true });
  clearTimeout(timer); // installing, or waiting for you on github.com: look again shortly
  if (st.step === "installing" || st.step === "login" || busy) timer = setTimeout(refresh, st.step === "login" ? 2000 : 1200);
  if (ready(st) && !was) { busy = ""; onReady?.(st); if (then) openPr(then); }
}
async function refresh() { if (el || inline) show(await call("").catch(() => st)); }
function close() {
  if (inline) return;
  clearTimeout(timer);
  el?.remove(); el = null; busy = "";
  if (returnTo?.isConnected) returnTo.focus({ preventScroll: true });
  settle?.(); settle = null;
}

function body() {
  const err = st.error ? `<p class="cs-err">${esc(st.error)}</p>` : "";
  const later = inline ? `<button class="btn quiet" data-gs="skip" title="You can still set it up from Settings, or the command palette">Skip: review local branches only</button>`
    : `<button class="btn" data-gs="later">Not now</button><button class="btn quiet" data-gs="never" title="You can still set it up from Settings, or the command palette">Don't ask again</button>`;
  const why = then ? `To open <b>${esc(then)}</b>, Bobby needs GitHub's CLI, <code>gh</code>, signed in as you.` : "Bobby reads PRs and posts your reviews through GitHub's CLI, <code>gh</code>, signed in as you. Without it, Bobby reviews local branches only.";
  if (st.step === "installing") return `<h2 id="gs-h">Installing GitHub CLI…</h2>
    <p>Bobby is downloading <code>gh</code> from GitHub's releases.</p><pre class="cs-log">${esc(st.log || "Starting…")}</pre>`;
  if (!st.installed) return `<h2 id="gs-h">Set up GitHub CLI?</h2>
    <p>${why}</p>
    <p>Bobby downloads it from <a href="https://github.com/cli/cli/releases/latest" target="_blank" rel="noopener">GitHub's releases</a>, checks it against their checksums, and puts it in <code>~/.local/bin</code>. No sudo, nothing else changed.</p>${err}
    <div class="row"><button class="btn primary" data-gs="install">Install GitHub CLI</button>${later}</div>`;
  if (!st.loggedIn && st.code) return `<h2 id="gs-h">Sign in to GitHub</h2>
    <p>Enter this one-time code on GitHub, and authorize GitHub CLI. Bobby notices when you're done.</p>
    <div class="cs-devcode"><input value="${esc(st.code)}" readonly aria-label="One-time code" spellcheck="false"><a class="btn primary" href="${esc(st.url)}" target="_blank" rel="noopener" data-gs="opened">${copied ? "Copied · open GitHub" : "Copy and open GitHub"} ↗</a></div>${err}
    <div class="row"><button class="btn" data-gs="cancel">Cancel</button><span class="cs-wait">Waiting for GitHub…</span></div>`;
  if (!st.loggedIn) return `<h2 id="gs-h">Sign in to GitHub</h2>
    <p>${then ? `${why} ` : ""}GitHub CLI ${esc(st.version ?? "")} is installed, but not signed in. Bobby gets a one-time code from it: you enter it on github.com, and authorize it.</p>${err}
    <div class="row"><button class="btn primary" data-gs="login"${busy === "login" ? " disabled" : ""}>${busy === "login" ? "Getting a code…" : "Get a sign-in code"}</button>${later}</div>`;
  if (inline) return `<p class="cs-ok">GitHub CLI ${esc(st.version ?? "")} is signed in${st.login ? ` as <b>${esc(st.login)}</b>` : ""}.</p>`;
  return `<h2 id="gs-h">GitHub is ready</h2>
    <p>GitHub CLI ${esc(st.version ?? "")} is signed in${st.login ? ` as <b>${esc(st.login)}</b>` : ""}.${then ? ` Opening <b>${esc(then)}</b>…` : ""}</p>${err}
    <div class="row"><button class="btn primary" data-gs="close">Done</button></div>`;
}

async function copyCode() {
  const input = box?.querySelector(".cs-devcode input");
  if (!input) return;
  try { await navigator.clipboard.writeText(input.value); } // not on http://<another machine>: not a secure context
  catch { input.select(); try { document.execCommand("copy"); } catch { /* it's selected: ⌘C */ } }
  copied = true;
}
async function onClick(ev) {
  if (!inline && ev.target === el) return st.step === "installing" ? undefined : close(); // the backdrop
  if (ev.target.matches(".cs-devcode input")) return ev.target.select();
  const t = ev.target.closest("[data-gs]");
  if (!t) return;
  const what = t.dataset.gs;
  if (what === "opened") { void copyCode(); return; } // the link opens github.com/login/device in a new tab
  if (what === "close") return close();
  if (what === "skip") { await call("/dismiss", { never: true }); return inline?.onSkip?.(); }
  if (what === "later" || what === "never") { await call("/dismiss", { never: what === "never" }); return close(); }
  if (what === "cancel") { await call("/cancel", {}); return show(await call("")); }
  if (what === "install") { show(await call("/install", {})); return; }
  if (what === "login") { busy = "login"; show(st); const r = await call("/login", {}); busy = ""; return show(r); }
}
function onKey(ev) {
  ev.stopPropagation(); // the page's keys stay out of the dialog
  if (ev.key === "Escape" && st.step !== "installing") close();
}
