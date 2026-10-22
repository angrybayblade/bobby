// Builds the docs into the marketing site: docs/*.md and SPEC.md become marketing/docs/*.html, one page each, with
// the site's header, a sidebar, the page's sections and prev/next. The Markdown stays the source: edit it, then run
// `bun run docs`. Links between docs become links between pages; anything else in the repo links to GitHub.
import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { dirname, join, normalize } from "node:path";

const ROOT = join(import.meta.dir, "..");
const OUT = join(ROOT, "marketing/docs");
const REPO = "https://github.com/angrybayblade/focus-bobby";

/** The sidebar, in reading order. `src` is the Markdown, relative to the repo. */
const GROUPS: { title: string; pages: { slug: string; src: string; label: string }[] }[] = [
  { title: "", pages: [{ slug: "index", src: "docs/README.md", label: "Overview" }] },
  {
    title: "User manual",
    pages: [
      { slug: "getting-started", src: "docs/getting-started.md", label: "Getting started" },
      { slug: "reviewing", src: "docs/reviewing.md", label: "Reviewing a PR" },
      { slug: "views", src: "docs/views.md", label: "Views" },
      { slug: "settings", src: "docs/settings.md", label: "Settings" },
      { slug: "privacy", src: "docs/privacy.md", label: "What leaves your machine" },
    ],
  },
  {
    title: "Implementation",
    pages: [
      { slug: "architecture", src: "docs/architecture.md", label: "Architecture" },
      { slug: "extraction", src: "docs/extraction.md", label: "Extraction pipeline" },
      { slug: "server-and-state", src: "docs/server-and-state.md", label: "Server and state" },
      { slug: "frontend", src: "docs/frontend.md", label: "Browser runtime" },
      { slug: "spec", src: "SPEC.md", label: "Review graph v1" },
      { slug: "contributing", src: "docs/contributing.md", label: "Contributing" },
    ],
  },
];
const PAGES = GROUPS.flatMap((g) => g.pages);
const bySrc = new Map(PAGES.map((p) => [p.src, p]));
bySrc.set("README.md", PAGES[0]);


const decode = (s: string) => s.replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&amp;/g, "&");
const strip = (html: string) => decode(html.replace(/<[^>]+>/g, ""));
/** GitHub's heading anchors, so links like views.md#flow keep working. */
const slugger = () => {
  const seen = new Map<string, number>();
  return (text: string) => {
    const base = text.trim().toLowerCase().replace(/[^\p{L}\p{N}\s_-]/gu, "").replace(/\s/g, "-");
    const n = seen.get(base) ?? 0;
    seen.set(base, n + 1);
    return n ? `${base}-${n}` : base;
  };
};

/** A link in `src`'s Markdown, as it should read on the site. */
function rewrite(href: string, src: string): string {
  if (/^([a-z]+:|#)/i.test(href)) return href;
  const [path, hash = ""] = href.split("#");
  const target = normalize(join(dirname(src), path));
  const page = bySrc.get(target);
  if (page) return `${page.slug === "index" ? "./" : `${page.slug}.html`}${hash ? `#${hash}` : ""}`;
  return `${REPO}/blob/main/${target}${hash ? `#${hash}` : ""}`;
}

function render(page: (typeof PAGES)[number]) {
  const md = readFileSync(join(ROOT, page.src), "utf8");
  let html = Bun.markdown.html(md);
  const slug = slugger();
  const toc: { id: string; html: string }[] = [];
  let title = page.label;
  html = html.replace(/<h([1-4])>([\s\S]*?)<\/h\1>/g, (_, n, inner) => {
    if (n === "1") { title = strip(inner); return `<h1>${inner}</h1>`; }
    const id = slug(strip(inner));
    if (n === "2") toc.push({ id, html: inner });
    return `<h${n} id="${id}"><a class="anchor" href="#${id}" aria-hidden="true">#</a>${inner}</h${n}>`;
  });
  html = html.replace(/href="([^"]+)"/g, (_, h) => `href="${rewrite(decode(h), page.src).replace(/"/g, "&quot;")}"`);
  html = html.replace(/<table>/g, '<div class="table"><table>').replace(/<\/table>/g, "</table></div>");

  const i = PAGES.indexOf(page), prev = PAGES[i - 1], next = PAGES[i + 1];
  const href = (p: (typeof PAGES)[number]) => (p.slug === "index" ? "./" : `${p.slug}.html`);
  const nav = GROUPS.map((g) => `
        <div class="group">${g.title ? `<h4>${g.title}</h4>` : ""}${g.pages.map((p) => `
          <a href="${href(p)}"${p === page ? ' class="on" aria-current="page"' : ""}>${p.label}</a>`).join("")}
        </div>`).join("");

  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <meta name="theme-color" content="#f6f2ea" />
  <title>${page.slug === "index" ? "Bobby docs" : `${title} · Bobby docs`}</title>
  <link rel="icon" href="../assets/bobby.svg" type="image/svg+xml" />
  <link rel="preconnect" href="https://fonts.googleapis.com" />
  <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin />
  <link href="https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700;800&family=JetBrains+Mono:wght@400;500&display=swap" rel="stylesheet" />
  <link rel="stylesheet" href="../styles.css" />
  <link rel="stylesheet" href="./docs.css" />
  <script src="./docs.js" defer></script>
</head>
<body class="docs">
  <!-- generated by scripts/docs.ts from ${page.src}: edit that, then run \`bun run docs\` -->
  <header class="site">
    <a class="logo" href="../"><img src="../assets/bobby.svg" alt="" width="22" height="22" /><b>bobby</b></a>
    <nav>
      <a class="cta" href="../#install">Install</a>
      <a href="./" class="on">Docs</a>
      <a href="${REPO}">GitHub ↗</a>
    </nav>
  </header>
  <div class="shell">
    <nav class="side" aria-label="Docs">
      <details open>
        <summary>${page.label}</summary>${nav}
      </details>
    </nav>
    <main class="doc">
      <article>
${html}
      </article>
      <footer class="pager">
        ${prev ? `<a class="prev" href="${href(prev)}"><small>Previous</small>${prev.label}</a>` : "<span></span>"}
        ${next ? `<a class="next" href="${href(next)}"><small>Next</small>${next.label}</a>` : "<span></span>"}
      </footer>
      <p class="edit"><a href="${REPO}/blob/main/${page.src}">Edit this page on GitHub ↗</a></p>
    </main>
    <aside class="toc" aria-label="On this page">${toc.length ? `
      <h4>On this page</h4>${toc.map((t) => `
      <a href="#${t.id}">${t.html}</a>`).join("")}` : ""}
    </aside>
  </div>
</body>
</html>
`;
}

// --check: fail if a page is out of date with its Markdown (scripts/check.sh runs this before each commit)
if (process.argv.includes("--check")) {
  const stale = PAGES.filter((p) => { try { return readFileSync(join(OUT, `${p.slug}.html`), "utf8") !== render(p); } catch { return true; } });
  if (stale.length) {
    console.error(`docs: ${stale.map((p) => p.src).join(", ")} changed; run \`bun run docs\` and commit marketing/docs`);
    process.exit(1);
  }
} else {
  mkdirSync(OUT, { recursive: true });
  for (const page of PAGES) writeFileSync(join(OUT, `${page.slug}.html`), render(page));
  console.log(`docs: ${PAGES.length} pages → ${OUT.replace(ROOT + "/", "")}`);
}
