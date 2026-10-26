// Captures the real Bobby app, state by state, as DOM + CSS for the marketing mock: drives a running Bobby through the
// story (Diff, Lens, a draft and a note, progress, park, welcome back, submit, Conversation) and writes each state's
// regions (#top, #where, #view, #files, #keys, #overlay, #toast) with their boxes, plus the app's CSS.
// usage: PAGE=../index.html node capture.mjs <review url> <out.js> [screenshots dir]   (run.sh does it all)
import puppeteer from "puppeteer-core";
import { readFileSync, writeFileSync } from "node:fs";

const [url, outFile, shots] = process.argv.slice(2);
const W = 1440, H = 900;
const b = await puppeteer.launch({ executablePath: process.env.CHROME ?? "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome", headless: "new" });
const p = await b.newPage();
await p.setViewport({ width: W, height: H });
await p.emulateMediaFeatures([{ name: "prefers-color-scheme", value: "light" }, { name: "prefers-reduced-motion", value: "reduce" }]);
const errors = [];
p.on("pageerror", (e) => errors.push(e.message));

// ---- nothing reaches GitHub: avatars are initials, the conversation is the story's
const COLORS = { maya: "#1a7f37", jon: "#bf3989", lina: "#bf8700", you: "#8250df" };
const avatar = (u) => `<svg xmlns="http://www.w3.org/2000/svg" width="40" height="40"><rect width="40" height="40" fill="${COLORS[u] ?? "#59636e"}"/><text x="20" y="25" font-family="-apple-system,Segoe UI,sans-serif" font-size="14" font-weight="700" fill="#fff" text-anchor="middle">${(u === "you" ? "AB" : u.slice(0, 2)).toUpperCase()}</text></svg>`;
const at = (m) => new Date(Date.now() - m * 60000).toISOString();
const who = (login) => ({ login });
const conversation = {
  author: who("maya"), createdAt: at(300), url: "https://github.com/acme/payments/pull/482", base: "main", head: "retry-idempotency",
  body: "Failed charges are retried up to three times with backoff. Every attempt carries the same idempotency key, so the processor charges at most once.\n\n- `withRetry` in policy.ts: 3 tries, 200ms → 800ms\n- the worker mints the key once and keeps it on `payment.retryKey`\n- the retry endpoint queues a job instead of charging inline\n\nCloses #476",
  html: "", state: "OPEN", draft: false, mergeable: "MERGEABLE", decision: "APPROVED",
  timeline: [
    { kind: "commit", sha: "4be1a0c", subject: "Add withRetry with exponential backoff", author: who("maya"), createdAt: at(290), url: "" },
    { kind: "commit", sha: "9901b67", subject: "Retry failed charges with one idempotency key", author: who("maya"), createdAt: at(288), url: "" },
    { kind: "review", id: "r1", author: who("lina"), state: "COMMENTED", body: "", html: "", createdAt: at(140), url: "" },
    { kind: "comment", id: "c1", author: who("lina"), body: "Do fees belong in this PR? Happy to review them separately.", html: "", createdAt: at(138), url: "" },
    { kind: "review", id: "r2", author: who("jon"), state: "COMMENTED", body: "One question on how the key survives retries.", html: "", createdAt: at(50), url: "" },
    { kind: "comment", id: "c2", author: who("maya"), body: "Answered inline: the worker mints it once.", html: "", createdAt: at(38), url: "" },
    { kind: "review", id: "r3", author: who("you"), state: "APPROVED", body: "LGTM!", html: "", createdAt: at(1), url: "" },
  ],
  threads: [
    { id: "t1", path: "src/payments/policy.ts", line: 11, startLine: null, side: "RIGHT", resolved: true, outdated: false, reviewId: "r1",
      hunk: "@@ -0,0 +11,1 @@\n+export async function withRetry<T>(fn: () => Promise<T>, policy: RetryPolicy = DEFAULT_POLICY): Promise<T> {",
      comments: [{ id: "903", author: who("lina"), body: "Name the parameter `policy`, not `opts`?", html: "", createdAt: at(140), url: "" }, { id: "904", author: who("maya"), body: "Done.", html: "", createdAt: at(120), url: "" }] },
    { id: "t2", path: "src/payments/retry.ts", line: 8, startLine: null, side: "RIGHT", resolved: false, outdated: false, reviewId: "r2",
      hunk: "@@ -5,1 +6,3 @@\n-export async function retryCharge(payment: Payment): Promise<ChargeResult> {\n+export async function retryCharge(\n+  payment: Payment,\n+  idempotencyKey: string,",
      comments: [{ id: "901", author: who("jon"), body: "Could this make a new key on every retry? If a caller mints one per call we're back to double charges.", html: "", createdAt: at(50), url: "" }, { id: "902", author: who("maya"), body: "The worker keeps it on `payment.retryKey`, so it's minted once per payment.", html: "", createdAt: at(38), url: "" }] },
    { id: "t3", path: "src/payments/retry.ts", line: 12, startLine: null, side: "RIGHT", resolved: false, outdated: false, reviewId: "r3",
      hunk: "@@ -6,2 +10,3 @@\n   payment.attempts += 1;\n-  return gateway.charge(payment);\n+  return withRetry(() =>\n+    gateway.charge(payment, { idempotencyKey }),",
      comments: [{ id: "906", author: who("you"), body: "Not blocking: `webhooks/charge.ts` still calls `retryCharge(payment)` without a key. Worth a follow-up so webhook retries reuse it too.", html: "", createdAt: at(0), url: "" }] },
  ],
  verdicts: [{ author: who("you"), state: "APPROVED" }, { author: who("jon"), state: "COMMENTED" }, { author: who("lina"), state: "COMMENTED" }],
  requested: [],
  checks: [
    { name: "test", workflow: "CI", status: "success", startedAt: at(287), completedAt: at(284) },
    { name: "typecheck", workflow: "CI", status: "success", startedAt: at(287), completedAt: at(286) },
    { name: "lint", workflow: "CI", status: "success", startedAt: at(287), completedAt: at(286) },
  ],
  fetchedAt: at(0),
};
// ---- Claude's side, the story's too, so the mock doesn't depend on a login or on what a model says that day: an
// answer on retryCharge's signature, a review's two findings, and the tools you'd let it use. References are as Bobby
// writes them once they've resolved (refs.ts).
const ref = (path, a, b) => `ref://head/${path}#L${a}${b ? `-L${b}` : ""}`;
const story = {
  ask: { id: "q1", headSha: "", path: "src/payments/retry.ts", side: "RIGHT", line: 9, startLine: 6, turns: [{ q: "Who calls this, and does every caller pass the same key?", at: at(2),
    a: `Two callers:\n\n- [\`processPayment\`](${ref("src/payments/worker.ts", 5, 8)}) mints the key once, on \`payment.retryKey\`, and passes it on every attempt.\n- [\`handleChargeFailed\`](${ref("src/webhooks/charge.ts", 7)}) still calls \`retryCharge(payment)\` with no key. Now that the key is required, that won't type-check; built without the check, each webhook retry would get a new key, which is the double charge this PR fixes.\n\nThe PR doesn't touch \`src/webhooks/charge.ts\`, so its diff won't show you this one.` }] },
  review: { headSha: "", at: at(1), focus: "Check every caller of retryCharge: can any still retry without the key?",
    summary: `The worker's key handling is right: one key per payment, kept across attempts. One caller still retries without it, [the charge webhook](${ref("src/webhooks/charge.ts", 5, 8)}), which this PR never touched.`,
    findings: [
      { id: "f1", path: "src/payments/retry.ts", side: "RIGHT", line: 8, startLine: 6, severity: "bug", status: "open", title: "The charge webhook still retries without a key",
        body: `[\`handleChargeFailed\`](${ref("src/webhooks/charge.ts", 7)}) calls \`retryCharge(payment)\` with no key. Now that the key is required this won't type-check, and built without the check, each webhook retry would get a fresh key and could charge twice. Pass \`payment.retryKey\`, minted once as [the worker does](${ref("src/payments/worker.ts", 6)}).` },
      { id: "f2", path: "src/payments/worker.ts", side: "RIGHT", line: 6, severity: "question", status: "open", title: "Is the key saved before the first charge?",
        body: `\`payment.retryKey ??= randomUUID()\` sets it in memory. If the worker stops after the processor has seen the key but before the payment is saved, the next run mints a new one. Is the payment stored with its key before [the charge](${ref("src/payments/worker.ts", 8)})?` },
    ] },
  tools: { ok: true, source: "launch", spec: "linear", selection: { "claude.ai Linear": "read" }, launch: { "claude.ai Linear": "read" },
    servers: [["claude.ai Linear", 44, 39], ["claude.ai Notion", 33, 32], ["claude.ai Slack", 14, 13], ["claude.ai Datadog", 269, 212]].map(([name, read, write]) => ({ name, status: "connected", read, write })) },
};
let reviewed = false; // the review's findings, once the story has got to them
await p.setRequestInterception(true);
p.on("request", (r) => {
  const u = new URL(r.url());
  if (u.pathname.endsWith("/api/avatar")) return r.respond({ contentType: "image/svg+xml", body: avatar(u.searchParams.get("u") ?? "?") });
  if (u.pathname.endsWith("/api/conversation")) return r.respond({ contentType: "application/json", body: JSON.stringify(conversation) });
  if (u.pathname.endsWith("/api/agent/tools") && r.method() === "GET") return r.respond({ contentType: "application/json", body: JSON.stringify(story.tools) });
  if (u.pathname.endsWith("/api/agent") && reviewed) return r.respond({ contentType: "application/json", body: JSON.stringify({ running: false, open: 2, review: story.review }) });
  if (u.hostname !== "127.0.0.1") return r.respond({ status: 204, body: "" }); // fonts, GitHub
  r.continue();
});

const wait = (ms) => new Promise((r) => setTimeout(r, ms));
await p.goto(url, { waitUntil: "networkidle0" });
await p.evaluate(() => bobby.saveSettings({ tour: "seen", theme: "light", palette: "github", motion: "off", drift: "off", diffLayout: "inline", hints: "always" }));
await p.goto(url, { waitUntil: "networkidle0" });
await wait(800);

const click = (sel) => p.evaluate((s) => { const e = document.querySelector(s); e?.click(); return !!e; }, sel);
const clickText = (sel, t) => p.evaluate((s, t) => { const e = [...document.querySelectorAll(s)].find((e) => e.textContent.trim() === t); e?.click(); return !!e; }, sel, t);
const closeToast = () => p.evaluate(() => document.querySelector("#toast .x")?.click());
/** Scrolls el's scrolling ancestor so el sits at `at` (0 top … 1 bottom) of it. */
const scrollTo = (sel, at) => p.evaluate((sel, at) => {
  const el = document.querySelector(sel); if (!el) return false;
  let s = el.parentElement;
  while (s && !(s.scrollHeight > s.clientHeight + 2 && /auto|scroll/.test(getComputedStyle(s).overflowY))) s = s.parentElement;
  if (!s) return false;
  const top = el.getBoundingClientRect().top - s.getBoundingClientRect().top + s.scrollTop;
  s.scrollTop = Math.max(0, top - s.clientHeight * at);
  return true;
}, sel, at);
const view = async (name) => { await clickText("#top .seg button", name); await wait(900); };
const key = async (k, ms = 500) => { await p.keyboard.press(k); await wait(ms); };

// the app's CSS (theme.css and each view's, which a view may drop when you leave it): collected at every snap, for a
// shadow root: the page's root becomes .root, and the viewport units the frame's, since the mock is drawn at W × H
const cssSeen = new Set();
const grabCss = async () => {
  for (const t of await p.evaluate(async (W, H) => {
    const out = [];
    for (const sh of document.styleSheets) {
      if (sh.href && new URL(sh.href).origin !== location.origin) continue; // fonts
      out.push((sh.href ? await (await fetch(sh.href)).text() : sh.ownerNode.textContent).replace(/:root\b/g, ".root").replace(/(?<![\w.#-])(html|body)(?![\w-])/g, ".root")
        .replace(/@media([^{]+)\{/g, (m, q) => /width|height|aspect/.test(q) ? `@media ${matchMedia(q.trim()).matches ? "all" : "not all"} /* ${q.trim()} at ${W}×${H} */ {` : m)
        .replace(/(?<![\w.-])(-?\d*\.?\d+)(d|s|l)?vh\b/g, (_, n) => `${(n * H) / 100}px`).replace(/(?<![\w.-])(-?\d*\.?\d+)vw\b/g, (_, n) => `${(n * W) / 100}px`));
    }
    return out;
  }, W, H)) cssSeen.add(t);
};

// ---- one state: every region's HTML and box, images inlined
const states = {};
async function snap(name) {
  await grabCss();
  states[name] = await p.evaluate(async () => {
    const out = {};
    const data = new Map();
    for (const img of document.querySelectorAll("img")) {
      const src = img.getAttribute("src");
      if (!src || src.startsWith("data:") || data.has(src)) continue;
      const blob = await (await fetch(img.src)).blob();
      data.set(src, await new Promise((r) => { const f = new FileReader(); f.onload = () => r(f.result); f.readAsDataURL(blob); }));
    }
    for (const [region, sel] of Object.entries({ top: "#top", where: "#where", view: "#view", files: "#files", keys: "#keys", overlay: "#overlay", toast: "#toast", inspector: ".inspector", dialog: ".cs-overlay", walk: ".aw-overlay" })) {
      const el = document.querySelector(sel);
      if (!el || el.hidden || getComputedStyle(el).display === "none" || !el.getBoundingClientRect().width) continue;
      const r = el.getBoundingClientRect();
      // outerHTML drops what's typed and ticked: write it into the markup
      for (const t of el.querySelectorAll("textarea")) t.textContent = t.value;
      for (const i of el.querySelectorAll("input")) { i.setAttribute("value", i.value); if (i.checked) i.setAttribute("checked", ""); }
      // outerHTML drops scroll positions: keep them as attributes
      el.querySelectorAll("[data-scroll]").forEach((n) => n.removeAttribute("data-scroll"));
      for (const n of [el, ...el.querySelectorAll("*")]) if (n.scrollTop || n.scrollLeft) n.setAttribute("data-scroll", `${n.scrollTop},${n.scrollLeft}`);
      let html = el.outerHTML;
      for (const [src, uri] of data) html = html.split(`src="${src}"`).join(`src="${uri}"`);
      out[region] = { box: [r.x, r.y, r.width, r.height].map((n) => Math.round(n * 100) / 100), html };
    }
    return out;
  });
  if (shots) await p.screenshot({ path: `${shots}/${name}.png` });
  console.log(name, Object.keys(states[name]).join(" "));
}

// D: the Diff view, on the Stable retry key core
await view("Diff");
await click('[data-ffile="src/payments/retry.ts"]'); await wait(1200);
await click("#toast .x");
await snap("diff");
// the same canvas zoomed out: every file at once, each right of what it relies on
const lvl = await p.evaluate(() => bobby.level);
await p.evaluate(() => bobby.setLevel(0)); await wait(1200);
await closeToast();
await snap("diff-overview");
await p.evaluate((l) => bobby.setLevel(l), lvl); await wait(900);
// the inspector, on the same file: ⌘-click a name for its declaration, ⌘⇧-click for every use
const inspectName = async (line, name, shift) => {
  const at = await p.evaluate((line, name) => {
    // the canvas keeps other copies of a file off screen: the one in view
    const code = [...document.querySelectorAll(`#view .ln[data-path="src/payments/retry.ts"][data-line="${line}"][data-side="RIGHT"] code`)]
      .find((c) => { const b = c.getBoundingClientRect(); return b.width && b.left >= 0 && b.right <= innerWidth && b.top >= 0 && b.bottom <= innerHeight; });
    if (!code) return null;
    const walker = document.createTreeWalker(code, NodeFilter.SHOW_TEXT);
    while (walker.nextNode()) {
      const i = walker.currentNode.textContent.indexOf(name);
      if (i < 0) continue;
      const range = document.createRange(); range.setStart(walker.currentNode, i); range.setEnd(walker.currentNode, i + name.length);
      const b = range.getBoundingClientRect();
      return { x: b.left + b.width / 2, y: b.top + b.height / 2 };
    }
    return null;
  }, line, name);
  if (!at) throw new Error(`no ${name} on line ${line}`);
  await p.keyboard.down("Meta"); if (shift) await p.keyboard.down("Shift");
  await p.mouse.click(at.x, at.y);
  if (shift) await p.keyboard.up("Shift"); await p.keyboard.up("Meta");
  await p.waitForFunction(() => document.querySelector(".inspector") && !document.querySelector(".inspector .pkw")?.textContent.includes("looking"), { timeout: 8000 }).catch(async (e) => {
    if (shots) await p.screenshot({ path: `${shots}/inspect-failed.png` });
    console.log("inspect failed at", at, await p.evaluate((x, y) => { const el = document.elementFromPoint(x, y); return el?.outerHTML.slice(0, 200); }, at.x, at.y));
    throw e;
  });
  await wait(600);
};
await inspectName(11, "withRetry", false);
await snap("definition");
await key("Escape", 500);
await inspectName(6, "retryCharge", true);
// open the caller in the PR: its code in place, and the button to its diff node
await p.click('.inspector .uitem[data-use="0"]');
await p.waitForSelector(".inspector .uview [data-uopen]", { timeout: 8000 });
await wait(400);
await snap("uses");
await key("Escape", 500);
// L: the Lens view, the core's card and the hook
await view("Lens"); await wait(400);
// untouched code on: the webhook that still calls retryCharge without a key is the story's bug
console.log("untouched", await p.evaluate(() => { const b = [...document.querySelectorAll("#top .pill.tog")].find((b) => b.textContent.includes("Untouched")); b?.click(); return !!b; }));
await wait(900);
await p.evaluate(async () => (await import("/app/chrome.js")).coreIntro(bobby.get(bobby.focus))); await wait(400);
await snap("lens");
await click("#toast .x");
// L2: the code open, the threads under their lines
await key("e", 1000);
await snap("lens-code");
// L3: your draft on line 12 and a private note on line 8
const compose = async (line, k, text) => {
  await p.evaluate((line) => {
    const row = bobby.pageEl.querySelector(`.ln[data-line="${line}"][data-side="RIGHT"]`);
    bobby.page.sel = { ...row.dataset }; bobby.page.selKeys = new Set([row.dataset.key]);
  }, line);
  await key(k, 400);
  await p.waitForSelector("[data-composer]", { timeout: 3000 });
  await p.focus("[data-composer]");
  await p.keyboard.type(text);
  await p.keyboard.down("Meta"); await p.keyboard.press("Enter"); await p.keyboard.up("Meta");
  await wait(900);
};
const level = (n) => p.evaluate((n) => bobby.setLevel(n), n);
await level(2); await wait(900);
await compose(12, "c", "Not blocking: webhooks/charge.ts still calls retryCharge(payment) without a key. Worth a follow-up so webhook retries reuse it too.");
await compose(8, "m", "Ask about the key's TTL at the processor.");
await level(1); await wait(1000);
console.log("scrolled", await p.evaluate(() => {
  const nb = document.querySelector("#view .lens .focus .nbody"); if (!nb) return "no nbody";
  const row = [...nb.querySelectorAll(".ln")].find((r) => r.dataset.line === "8" && r.dataset.side === "RIGHT");
  if (!row) return "no row: " + [...nb.querySelectorAll(".ln")].slice(0, 3).map((r) => JSON.stringify(r.dataset)).join(" ");
  nb.scrollTop = row.getBoundingClientRect().top - nb.getBoundingClientRect().top + nb.scrollTop - 8;
  return nb.scrollTop;
}));
await wait(400);
await snap("lens-draft");
// P: progress, the first core walked and part of this one
await p.evaluate(() => { const walk = bobby.index.walk.filter((x) => typeof x === "string"); for (const pid of walk.slice(0, 5)) if (pid !== bobby.focus) bobby.mark(pid, "reviewed"); });
await wait(900);
await closeToast(); await wait(300);
await snap("progress");
// park: the prompt, then the thought in the bar
await key("p", 600);
await p.keyboard.type("does the webhook path keep the key?");
await wait(300);
await snap("park");
await click('[data-act="save-note"]'); await wait(800);
await snap("parked");
// welcome back
await p.evaluate(async () => (await import("/app/chrome.js")).reentry(bobby.focus, bobby.level)); await wait(600);
await snap("welcome");
await key("Escape", 500);
// Claude: a question on retryCharge's signature, answered on those lines, its references links
await p.evaluate((ask) => { bobby.me ??= { login: "you", avatar: "you" }; bobby.asks = [ask]; bobby.emit("comments"); }, story.ask); await wait(900); // you asked it
console.log("ask scrolled", await p.evaluate(() => {
  const nb = document.querySelector("#view .lens .focus .nbody"); if (!nb) return "no nbody";
  const row = [...nb.querySelectorAll(".ln")].find((r) => r.dataset.line === "6" && r.dataset.side === "RIGHT");
  if (!row) return "no row";
  nb.scrollTop = row.getBoundingClientRect().top - nb.getBoundingClientRect().top + nb.scrollTop - 8;
  return nb.scrollTop;
}));
await wait(400);
await snap("ask");
// one of them opened: the code viewer, the PR's changes highlighted. It and the walkthrough are drawn at 700px, as on
// a smaller window, so that a phone's crop of the mock (about 720px of it) shows them whole.
const narrow = await p.addStyleTag({ content: ".inspector .pkwin, .aw { width: 700px !important; }" });
await p.evaluate(async (path) => (await import("/app/code.js")).openRef(bobby, { path, side: "head", line: 5, end: 8 }), "src/payments/worker.ts");
await p.waitForFunction(() => document.querySelector(".inspector .pl"), { timeout: 8000 }); await wait(400);
await snap("ref");
await key("Escape", 500);
// Review with Claude: what to focus on, and your own tools (Linear, read only)
await p.evaluate(async () => (await import("/app/agent.js")).openAsk(bobby, { tools: true })); await wait(600);
await p.focus("#ag-text"); await p.keyboard.type(story.review.focus);
await p.waitForSelector(".ag-tlist", { timeout: 5000 }); await wait(300);
await snap("agent-ask");
await key("Escape", 500);
// its findings, one at a time: the first, with its code
reviewed = true;
await p.evaluate(async (review) => { bobby.agentReview = review; bobby.agent = { running: false, open: 2, at: review.at }; bobby.emit("view"); (await import("/app/agent-walk.js")).openWalk(bobby, null, () => {}); }, story.review);
await p.waitForSelector(".aw .aw-code", { timeout: 5000 }); await wait(500);
await snap("agent-walk");
await key("Escape", 500);
await narrow.evaluate((s) => s.remove());
await p.evaluate(() => { bobby.asks = []; bobby.agentReview = null; bobby.agent = { running: false, open: 0 }; bobby.emit("comments"); bobby.emit("view"); });
reviewed = false; await wait(400);
// submit
await key("s", 800);
await p.type("#rbody", "LGTM!");
await wait(300);
await snap("submit");
await key("Escape", 500);
// the Conversation view: the review already in GitHub's timeline, the drafts gone with it
await p.evaluate(() => { bobby.state.comments.splice(0); bobby.emit("comments"); });
await view("Conversation"); await wait(1200);
await closeToast();
console.log("conv scrolled", await p.evaluate(() => {
  const c = document.querySelector(".conv"); if (!c) return "no conv";
  const el = [...c.querySelectorAll(".item, .card, .review")].find((e) => e.textContent.includes("LGTM!"));
  if (!el) return "no review";
  c.scrollTop = el.getBoundingClientRect().top - c.getBoundingClientRect().top + c.scrollTop - 150;
  return c.scrollTop;
}));
await wait(300);
await snap("conversation");

const css = [...cssSeen].join("\n");
const root = await p.evaluate(() => ({ attrs: Object.fromEntries([...document.documentElement.attributes].filter((a) => a.name.startsWith("data-")).map((a) => [a.name, a.value])), style: document.documentElement.getAttribute("style") ?? "" }));

// only what the page uses: the state/region pairs its layers name
const page = process.env.PAGE && readFileSync(process.env.PAGE, "utf8");
if (page) {
  const used = new Set([...page.matchAll(/data-state="([^"]+)" data-region="([^"]+)"/g)].map((m) => `${m[1]}/${m[2]}`));
  for (const [name, regions] of Object.entries(states)) {
    for (const r of Object.keys(regions)) if (!used.has(`${name}/${r}`)) delete regions[r];
    if (!Object.keys(regions).length) delete states[name];
  }
}
writeFileSync(outFile, `// generated by capture.mjs from the real app: don't edit\nwindow.BOBBY = ${JSON.stringify({ size: [W, H], root, css, states })};\n`);
console.log("errors", errors);
await b.close();
