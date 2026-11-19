// The UI's static files. Run from source, the server reads them from public/; a compiled binary
// (scripts/build.ts) embeds them here at startup instead, so it runs with nothing beside it.
export interface Asset { type: string; body: Uint8Array }
let embedded: Map<string, Asset> | null = null;

/** path under public/ → [content type, base64 body] */
export function embed(files: Record<string, [string, string]>) {
  embedded = new Map(Object.entries(files).map(([path, [type, b64]]) => [path, { type, body: Uint8Array.from(atob(b64), (ch) => ch.charCodeAt(0)) }]));
}
export const embeddedAsset = (path: string) => embedded?.get(path) ?? null;

// import … from "./x.js", import "./x.js", export … from "./x.js": what a module loads before it runs. Not import("./x.js"),
// which loads when it's reached, if ever.
const STATIC_IMPORT = /^[ \t]*(?:import\s*(?:[\w$*\s,]*(?:\{[^}]*\})?\s*from\s*)?|export\s*(?:\*(?:\s*as\s+[\w$]+)?|\{[^}]*\})\s*from\s*)["'](\.{0,2}\/[^"'\n]+\.js)["']/gm;
/** A page with every module its script imports named in its head (modulepreload), so the browser asks for them all at
 *  once, not each as the one that imports it arrives: four round trips of imports for a review's page, which on a
 *  remote Bobby is most of opening it. `read` gives a file under public/ as text, or null. */
export function withPreloads(html: string, read: (path: string) => string | null): string {
  const entry = /<script type="module" src="\/([^"]+)"/.exec(html)?.[1];
  if (!entry || html.includes('rel="modulepreload"')) return html;
  const seen = new Set<string>(), queue = [entry];
  for (let path; (path = queue.shift()) !== undefined;) {
    const src = read(path);
    if (seen.has(path) || src === null) continue;
    seen.add(path);
    for (const m of src.matchAll(STATIC_IMPORT)) queue.push(new URL(m[1], `http://x/${path}`).pathname.slice(1));
  }
  seen.delete(entry); // the page asks for that one itself
  return html.replace("</head>", `${[...seen].map((p) => `  <link rel="modulepreload" href="/${p}" />\n`).join("")}</head>`);
}
