// The UI's static files. Run from source, the server reads them from public/; a compiled binary
// (scripts/build.ts) embeds them here at startup instead, so it runs with nothing beside it.
export interface Asset { type: string; body: Uint8Array }
let embedded: Map<string, Asset> | null = null;

/** path under public/ → [content type, base64 body] */
export function embed(files: Record<string, [string, string]>) {
  embedded = new Map(Object.entries(files).map(([path, [type, b64]]) => [path, { type, body: Uint8Array.from(atob(b64), (ch) => ch.charCodeAt(0)) }]));
}
export const embeddedAsset = (path: string) => embedded?.get(path) ?? null;
