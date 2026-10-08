// The code page every view shows at level 2: why it matters, then the code.
import { BAND_TEXT, DONE, LOW, api, esc } from "./core.js";

const EXT = {
  ts: "typescript", tsx: "typescript", mts: "typescript", cts: "typescript", js: "javascript", jsx: "javascript", mjs: "javascript", cjs: "javascript",
  py: "python", go: "go", rs: "rust", java: "java", kt: "kotlin", rb: "ruby", php: "php", cs: "csharp", c: "c", h: "c",
  cc: "cpp", cpp: "cpp", hpp: "cpp", swift: "swift", scala: "scala", sh: "bash", bash: "bash", zsh: "bash", yml: "yaml",
  yaml: "yaml", json: "json", md: "markdown", css: "css", scss: "scss", html: "xml", xml: "xml", vue: "xml", sql: "sql",
  toml: "ini", lua: "lua", ex: "elixir", exs: "elixir", dart: "dart",
};
const langOf = (path) => {
  const base = path.split("/").pop().toLowerCase();
  return base === "dockerfile" ? "dockerfile" : EXT[base.split(".").pop()];
};

// Highlight a whole block (so multi-line comments/strings colour correctly), then split per line.
function hlBlock(lines, lang) {
  if (!lang || !window.hljs?.getLanguage(lang)) return lines.map(esc);
  let html;
  try { html = hljs.highlight(lines.join("\n"), { language: lang, ignoreIllegals: true }).value; } catch { return lines.map(esc); }
  const out = [], open = [];
  let cur = "";
  for (const m of html.matchAll(/(<span[^>]*>)|(<\/span>)|(\n)|([^<\n]+|<)/g)) {
    if (m[1]) { open.push(m[1]); cur += m[1]; }
    else if (m[2]) { open.pop(); cur += m[2]; }
    else if (m[3]) { out.push(cur + "</span>".repeat(open.length)); cur = open.join(""); }
    else cur += m[4];
  }
  out.push(cur + "</span>".repeat(open.length));
  return out;
}

// ---- word-level diff: pair removed/added runs line by line, LCS over tokens.
const tok = (s) => s.match(/\w+|\s+|[^\w\s]/g) ?? [];
function changedRanges(a, b) {
  const A = tok(a), B = tok(b);
  if (A.length * B.length > 40000) return [[[0, a.length]], [[0, b.length]]];
  const dp = Array.from({ length: A.length + 1 }, () => new Uint16Array(B.length + 1));
  for (let i = A.length - 1; i >= 0; i--) for (let j = B.length - 1; j >= 0; j--)
    dp[i][j] = A[i] === B[j] ? dp[i + 1][j + 1] + 1 : Math.max(dp[i + 1][j], dp[i][j + 1]);
  const ra = [], rb = [];
  let i = 0, j = 0, pa = 0, pb = 0;
  const push = (r, s, e) => { if (e > s) { const last = r[r.length - 1]; last && last[1] === s ? (last[1] = e) : r.push([s, e]); } };
  while (i < A.length || j < B.length) {
    if (i < A.length && j < B.length && A[i] === B[j]) { pa += A[i++].length; pb += B[j++].length; }
    else if (j < B.length && (i === A.length || dp[i][j + 1] >= dp[i + 1][j])) { push(rb, pb, pb + B[j].length); pb += B[j++].length; }
    else { push(ra, pa, pa + A[i].length); pa += A[i++].length; }
  }
  return [ra, rb];
}
function wordRanges(lines) {
  const ranges = new Array(lines.length).fill(null);
  for (let i = 0; i < lines.length;) {
    if (lines[i].t !== "-") { i++; continue; }
    const ds = i; while (i < lines.length && lines[i].t === "-") i++;
    const as = i; while (i < lines.length && lines[i].t === "+") i++;
    const pairs = Math.min(as - ds, i - as);
    for (let k = 0; k < pairs; k++) {
      const [rd, ra] = changedRanges(lines[ds + k].s, lines[as + k].s);
      const tiny = (r, s) => r.reduce((n, [x, y]) => n + y - x, 0) < s.length * 0.7; // whole-line changes read better without marks
      if (tiny(rd, lines[ds + k].s)) ranges[ds + k] = rd;
      if (tiny(ra, lines[as + k].s)) ranges[as + k] = ra;
    }
  }
  return ranges;
}
// Wrap text ranges of an HTML string in <mark>, re-opening across tag boundaries.
function applyRanges(html, ranges, cls) {
  if (!ranges?.length) return html;
  let out = "", pos = 0, ri = 0, on = false;
  for (const m of html.matchAll(/(<[^>]+>)|(&[#\w]+;)|([^<&])/g)) {
    if (m[1]) { out += on ? `</mark>${m[1]}<mark class="${cls}">` : m[1]; continue; }
    while (ri < ranges.length && pos >= ranges[ri][1]) ri++;
    const want = ri < ranges.length && pos >= ranges[ri][0];
    if (want && !on) { out += `<mark class="${cls}">`; on = true; }
    if (!want && on) { out += "</mark>"; on = false; }
    out += m[0];
    pos++;
  }
  return on ? out + "</mark>" : out;
}

const hunkCache = new Map();
function hunkHtml(h) {
  if (hunkCache.has(h.hash)) return hunkCache.get(h.hash);
  const lang = langOf(h.file);
  const nw = hlBlock(h.lines.filter((l) => l.t !== "-").map((l) => l.s), lang);
  const od = hlBlock(h.lines.filter((l) => l.t !== "+").map((l) => l.s), lang);
  const words = wordRanges(h.lines);
  let ni = 0, oi = 0;
  const html = h.lines.map((l, i) => {
    const raw = l.t === "-" ? od[oi++] : l.t === "+" ? nw[ni++] : (oi++, nw[ni++]);
    return applyRanges(raw, words[i], l.t === "+" ? "wa" : "wd");
  });
  hunkCache.set(h.hash, html);
  return html;
}

// ---- files for context expansion
const files = new Map();
function fileLines(app, path, rerender) {
  if (!app.caps.files) return null;
  const f = files.get(path);
  if (f === undefined) {
    files.set(path, "loading");
    api(`/api/file?path=${encodeURIComponent(path)}`).then((r) => { files.set(path, r.lines ?? []); rerender(); });
    return null;
  }
  return f === "loading" ? null : f;
}

// ---- rendering
function row(app, { t, o, n }, html, target) {
  const side = t === "-" ? "LEFT" : "RIGHT";
  const line = t === "-" ? o : n;
  const key = `${target.path}|${side}|${line}`;
  const cls = t === "+" ? "add" : t === "-" ? "del" : t === "x" ? "exp" : "ctx";
  const comments = app.state.comments.filter((c) => c.path === target.path && c.side === side && c.line === line);
  const composing = app.page.composing?.key === key;
  return `<div class="ln ${cls}${app.page.sel?.key === key ? " sel" : ""}${target.hi === n && t !== "-" ? " target" : ""}" data-key="${esc(key)}" data-path="${esc(target.path)}" data-line="${line}" data-side="${side}" data-indiff="${target.inDiff && t !== "x" ? 1 : 0}">
    <span class="bar"></span><span class="no">${o ?? ""}</span><span class="no">${n ?? ""}</span><span class="sg">${t === "+" ? "+" : t === "-" ? "−" : ""}</span><code>${html}</code></div>`
    + comments.map((c) => `<div class="cmt"><button class="x" data-del="${c.id}" title="Delete draft">✕</button>${esc(c.body)}${c.inDiff ? "" : `<div class="note">Outside the diff, so this goes into the review summary.</div>`}</div>`).join("")
    + (composing ? `<div class="cmt"><textarea data-composer placeholder="Draft a comment.  ⌘/Ctrl+Enter to save · Esc to cancel"></textarea></div>` : "");
}

function fileHead(path, extra = "", stat = "") {
  const dir = path.includes("/") ? path.slice(0, path.lastIndexOf("/") + 1) : "";
  return `<div class="fh"><span>${esc(dir)}<b>${esc(path.split("/").pop())}</b>${extra}</span><span class="ctx"></span>${stat}</div>`;
}

function hunkBox(app, h, rerender) {
  const e = app.page.exp[h.id] ?? { above: 0, below: 0 };
  const file = e.above || e.below ? fileLines(app, h.file, rerender) : null;
  const target = { path: h.file, inDiff: true };
  const lastN = h.newStart + h.lines.filter((l) => l.t !== "-").length - 1;
  const lastO = h.oldStart + h.lines.filter((l) => l.t !== "+").length - 1;
  const ctxRows = (from, to, offset) => {
    if (!file || to < from) return "";
    const nums = []; for (let n = from; n <= Math.min(to, file.length); n++) nums.push(n);
    const html = hlBlock(nums.map((n) => file[n - 1] ?? ""), langOf(h.file));
    return nums.map((n, i) => row(app, { t: "x", o: n + offset, n }, html[i], target)).join("");
  };
  const html = hunkHtml(h);
  let a = 0, d = 0; for (const l of h.lines) l.t === "+" ? a++ : l.t === "-" ? d++ : 0;
  const canExpand = app.caps.files;
  return `<div class="code">
    ${fileHead(h.file, h.context ? ` <span style="color:var(--faint)">· ${esc(h.context)}</span>` : "", `<span class="st"><span style="color:var(--ok)">+${a}</span> <span style="color:var(--risk)">−${d}</span></span>`)}
    ${canExpand && h.newStart > 1 ? `<button class="more" data-exp="${h.id}:above">⋯ more above</button>` : ""}
    <div class="lines">${ctxRows(Math.max(1, h.newStart - e.above), h.newStart - 1, h.oldStart - h.newStart)}${h.lines.map((l, i) => row(app, l, html[i], target)).join("")}${ctxRows(lastN + 1, lastN + e.below, lastO - lastN)}</div>
    ${canExpand ? `<button class="more" data-exp="${h.id}:below">⋯ more below</button>` : ""}
  </div>`;
}

function contextBox(app, node, rerender) {
  const { path, line } = node.location;
  const key = `ctx:${path}:${line}`;
  const r = app.page.exp[key] ?? { start: Math.max(1, line - 6), end: line + 6 };
  const snip = node.snippet;
  const inSnippet = r.start >= snip.start && r.end < snip.start + snip.lines.length;
  const file = inSnippet ? null : fileLines(app, path, rerender);
  const src = (n) => (file ? file[n - 1] : snip.lines[n - snip.start]);
  const lo = file ? Math.max(1, r.start) : Math.max(r.start, snip.start);
  const hi = file ? Math.min(file.length, r.end) : Math.min(r.end, snip.start + snip.lines.length - 1);
  const nums = []; for (let n = lo; n <= hi; n++) nums.push(n);
  const html = hlBlock(nums.map((n) => src(n) ?? ""), langOf(path));
  const target = { path, inDiff: false, hi: line };
  const canMore = app.caps.files || lo > snip.start || hi < snip.start + snip.lines.length - 1;
  return `<div class="code">
    ${fileHead(path, `<span style="color:var(--faint)">:${line} · not changed in this PR</span>`)}
    ${canMore && lo > 1 ? `<button class="more" data-exp="${esc(key)}:above">⋯ more above</button>` : ""}
    <div class="lines">${nums.map((n, i) => row(app, { t: " ", o: null, n }, html[i], target)).join("")}</div>
    ${canMore ? `<button class="more" data-exp="${esc(key)}:below">⋯ more below</button>` : ""}
  </div>`;
}

function lowPage(app) {
  const byFile = new Map();
  for (const h of app.hunksOf(LOW)) (byFile.get(h.file) ?? byFile.set(h.file, []).get(h.file)).push(h);
  const open = app.page.lowOpen ?? new Set();
  return `<div class="band">Low-signal changes</div>
    <h1>Skim, don't read${app.isReviewed(LOW) ? `<span class="badges"><span class="badge done">✓ reviewed</span></span>` : ""}</h1>
    <p class="why">Lockfiles, generated output and whitespace-only edits. Open anything that looks surprising, then press <kbd>a</kbd>.</p>
    ${[...byFile].map(([file, hs]) => {
      let a = 0, d = 0; for (const h of hs) for (const l of h.lines) l.t === "+" ? a++ : l.t === "-" ? d++ : 0;
      return `<div class="code"><button class="fh" style="width:100%;text-align:left" data-low="${esc(file)}"><span><b>${esc(file)}</b> <span style="color:var(--faint)">· ${esc(hs[0].lowSignal)}</span></span><span class="ctx"></span><span class="st">+${a} −${d} · ${open.has(file) ? "hide" : "show"}</span></button>
        ${open.has(file) ? `<div class="lines">${hs.flatMap((h) => h.lines.slice(0, 300).map((l) => row(app, l, esc(l.s), { path: file, inDiff: true }))).join("")}</div>` : ""}</div>`;
    }).join("")}`;
}

function donePage(app) {
  const { done, total } = app.progress();
  const flagged = app.index.walk.filter((p) => p !== DONE && app.isFlagged(p));
  return `<div style="text-align:center;margin-top:12vh">
    <h1 style="font-family:var(--font-ui)">${done === total ? "All reviewed ✓" : "End of the walk"}</h1>
    <p class="why" style="margin:0 auto 24px">${done === total
      ? `${app.state.comments.length} draft comment(s). Press <kbd>s</kbd> to submit your review.`
      : `${total - done} page(s) still unreviewed. Press <kbd>n</kbd> to jump to the next one.`}</p>
    ${flagged.length ? `<div class="band" style="justify-content:center;margin-top:30px">Flagged for a second look</div>${flagged.map((p) => `<p><button class="pill" data-go="${p}">${esc(app.get(p)?.pl.title ?? "Low-signal changes")}</button></p>`).join("")}` : ""}
  </div>`;
}

export function renderPage(app, el, pid) {
  const rerender = () => renderPage(app, el, pid);
  bind(app, el, rerender);
  let body;
  if (pid === DONE) body = donePage(app);
  else if (pid === LOW) body = lowPage(app);
  else {
    const { pl } = app.get(pid);
    const node = app.nodeOf(pid);
    const badges = [
      pl.risk === "high" ? `<span class="badge risk">high risk</span>` : "",
      app.isReviewed(pid) ? `<span class="badge done">✓ reviewed</span>` : "",
      app.isFlagged(pid) ? `<span class="badge flag">⚑ flagged</span>` : "",
    ].join("");
    const glyph = pl.band === "core" ? "core" : node.kind;
    body = `<div class="band"><i class="glyph ${glyph}"></i>${BAND_TEXT[pl.band]}</div>
      <h1>${esc(pl.title)}${badges ? `<span class="badges">${badges}</span>` : ""}</h1>
      <p class="why">${esc(pl.why)}</p>
      ${node.kind === "change" ? app.hunksOf(pid).map((h) => hunkBox(app, h, rerender)).join("") : contextBox(app, node, rerender)}`;
  }
  el.innerHTML = `<div class="page">${body}</div>`;
  const ta = el.querySelector("textarea[data-composer]");
  if (ta) ta.focus();
}

// One delegated listener per container.
const bound = new WeakMap();
function bind(app, el, rerender) {
  bound.set(el, rerender);
  if (el.dataset.bound) return;
  el.dataset.bound = "1";
  el.addEventListener("click", (ev) => {
    const t = ev.target.closest("[data-exp],[data-del],[data-low],[data-go],.ln[data-key]");
    if (!t) return;
    const again = () => bound.get(el)();
    const ds = t.dataset;
    if (ds.go) app.setFocus(ds.go);
    else if (ds.exp) {
      const i = ds.exp.lastIndexOf(":"), id = ds.exp.slice(0, i), dir = ds.exp.slice(i + 1);
      if (id.startsWith("ctx:")) {
        const line = Number(id.slice(id.lastIndexOf(":") + 1));
        const r = (app.page.exp[id] ??= { start: Math.max(1, line - 6), end: line + 6 });
        dir === "above" ? (r.start = Math.max(1, r.start - 12)) : (r.end += 12);
      } else {
        const e = (app.page.exp[id] ??= { above: 0, below: 0 });
        e[dir] += 12;
      }
      again();
    } else if (ds.del) {
      api(`/api/comment/${ds.del}`, null, "DELETE");
      app.state.comments = app.state.comments.filter((c) => c.id !== ds.del);
      app.emit("comments");
      again();
    } else if (ds.low) {
      const open = (app.page.lowOpen ??= new Set());
      open.has(ds.low) ? open.delete(ds.low) : open.add(ds.low);
      again();
    } else if (ds.key) {
      if (app.page.sel?.key === ds.key && !app.page.composing) { app.page.composing = { ...ds }; return again(); }
      el.querySelectorAll(".ln.sel").forEach((x) => x.classList.remove("sel"));
      t.classList.add("sel");
      app.page.sel = { ...ds };
    }
  });
  el.addEventListener("keydown", (ev) => {
    if (!ev.target.matches("textarea[data-composer]")) return;
    ev.stopPropagation();
    if (ev.key === "Escape") { app.page.composing = null; bound.get(el)(); }
    if (ev.key === "Enter" && (ev.metaKey || ev.ctrlKey)) { ev.preventDefault(); saveComment(app, ev.target.value).then(() => bound.get(el)()); }
  });
}

async function saveComment(app, text) {
  const t = app.page.composing;
  app.page.composing = null;
  if (!text.trim()) return;
  const c = await api("/api/comment", { path: t.path, line: Number(t.line), side: t.side, body: text.trim(), inDiff: t.indiff === "1" });
  app.state.comments.push(c);
  app.emit("comments");
}

/** `c` key: comment on the selected line, else the most relevant line on the page. */
export function startComment(app, el) {
  if (!app.page.sel) {
    const rows = [...el.querySelectorAll(".ln[data-key]")];
    const pick = rows.find((r) => r.classList.contains("target")) ?? rows.find((r) => r.classList.contains("add") || r.classList.contains("del")) ?? rows[0];
    if (!pick) return;
    app.page.sel = { ...pick.dataset };
  }
  app.page.composing = { ...app.page.sel };
  bound.get(el)?.();
}

/** `e` key: more context around everything on the page. */
export function expandAll(app, el) {
  const pid = app.focus;
  const node = app.nodeOf(pid);
  if (!node) return;
  if (node.kind === "context") {
    const id = `ctx:${node.location.path}:${node.location.line}`;
    const r = (app.page.exp[id] ??= { start: Math.max(1, node.location.line - 6), end: node.location.line + 6 });
    r.start = Math.max(1, r.start - 10); r.end += 10;
  } else if (app.caps.files) {
    for (const h of app.hunksOf(pid)) { const e = (app.page.exp[h.id] ??= { above: 0, below: 0 }); e.above += 10; e.below += 10; }
  }
  bound.get(el)?.();
}
