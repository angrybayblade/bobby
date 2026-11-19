import { expect, test } from "bun:test";
import { idFromPath, reviewId } from "../src/review.ts";
import { withPreloads } from "../src/assets.ts";
import { hostAllowed, originAllowed, packed } from "../src/server.ts";

test("answers at loopback names on any port: Bobby's own, or an SSH tunnel's", () => {
  for (const h of ["127.0.0.1:4173", "localhost:4173", "localhost:9000", "LOCALHOST:9000", "[::1]:4173", "localhost"]) expect(hostAllowed(h)).toBe(true);
});

test("refuses any other name unless it's allowed: a rebinding site sends its own", () => {
  expect(hostAllowed("evil.example:4173")).toBe(false);
  expect(hostAllowed("10.0.0.5:4173")).toBe(false);
  expect(hostAllowed("localhost.evil.example:4173")).toBe(false);
  expect(hostAllowed("")).toBe(false);
});

test("an allowed name takes any port; with a port, only that one; * takes anything", () => {
  expect(hostAllowed("bobby.vm.internal:4173", ["bobby.vm.internal"])).toBe(true);
  expect(hostAllowed("bobby.vm.internal", ["bobby.vm.internal"])).toBe(true); // behind a proxy on 80/443
  expect(hostAllowed("Bobby.VM.internal:8080", ["bobby.vm.internal:8080"])).toBe(true);
  expect(hostAllowed("bobby.vm.internal:4173", ["bobby.vm.internal:8080"])).toBe(false);
  expect(hostAllowed("other.vm.internal:4173", ["bobby.vm.internal"])).toBe(false);
  expect(hostAllowed("34.120.1.9:4173", ["*"])).toBe(true);
});

test("a change comes from Bobby's page at its Host, or at a name allowed by name, behind a proxy that rewrites Host", () => {
  expect(originAllowed("http://127.0.0.1:4173", "127.0.0.1:4173")).toBe(true);
  expect(originAllowed("https://evil.example", "127.0.0.1:4173")).toBe(false);
  expect(originAllowed("https://vm.exe.xyz", "localhost:8000", ["vm.exe.xyz"])).toBe(true);
  expect(originAllowed("https://vm.exe.xyz:4173", "vm.exe.xyz:4173", ["vm.exe.xyz:8000"])).toBe(true); // its Host
  expect(originAllowed("https://vm.exe.xyz:4173", "localhost:8000", ["vm.exe.xyz:8000"])).toBe(false);
  expect(originAllowed("https://other.exe.xyz", "localhost:8000", ["vm.exe.xyz"])).toBe(false);
  expect(originAllowed("https://evil.example", "localhost:8000", ["*"])).toBe(false); // * opens Host, not Origin
});

test("a review's address leads back to its id, for a branch of any depth or spelling", () => {
  for (const branch of ["main", "x/y", "x/y/z", "x/y/z/w/v", "feat#1", "50%-done", "a b/c"]) {
    const id = reviewId({ provider: "local", owner: "local", repo: "my repo", number: 0, branch });
    const address = new URL(`http://bobby/r/${id}/api/graph`).pathname.slice(3).split("/"); // as the server gets it
    expect(address.length).toBe(5);
    expect(idFromPath(address.slice(0, 3))).toBe(id);
  }
  for (const pr of [{}, { commit: { sha: "c".repeat(40), subject: "s" } }, { commit: { sha: "c".repeat(40), from: "f".repeat(40), subject: "s" } }]) {
    const id = reviewId({ provider: "github", owner: "o", repo: "r", number: 7, ...pr });
    expect(idFromPath(new URL(`http://bobby/r/${id}`).pathname.slice(3).split("/"))).toBe(id);
  }
});

test("a page names every module its script imports, however deep, once each", () => {
  const files: Record<string, string> = {
    "app/main.js": `import {\n  a,\n} from "./a.js";\nimport * as v from "./views/index.js";\nconst lazy = () => import("./lazy.js");\nexport const open = async () => {\n  const m = await import("./lazy.js")\n}`,
    "app/a.js": `import "./b.js";\nexport { c } from "./views/c.js";`,
    "app/b.js": `import { a } from "./a.js"; // a cycle`,
    "app/views/index.js": `import c from "./c.js";\nimport { a } from "../a.js";`,
    "app/views/c.js": `export default 1;`,
    "app/lazy.js": ``,
  };
  const html = `<head>\n  <script src="/app/look.js"></script>\n</head><body><script type="module" src="/app/main.js"></script></body>`;
  const out = withPreloads(html, (p) => files[p] ?? null);
  expect([...out.matchAll(/modulepreload" href="([^"]+)"/g)].map((m) => m[1]).sort()).toEqual(["/app/a.js", "/app/b.js", "/app/views/c.js", "/app/views/index.js"]);
  expect(withPreloads(out, (p) => files[p] ?? null)).toBe(out);
  expect(withPreloads("<head></head>", () => null)).toBe("<head></head>");
});

test("opened from another machine, answers are compressed and not sent twice; on this one they go as they are", async () => {
  const body = JSON.stringify({ lines: Array.from({ length: 400 }, (_, i) => `line ${i}`) });
  const answer = () => new Response(body, { headers: { "content-type": "application/json;charset=utf-8" } });
  const get = (headers: Record<string, string>) => new Request("http://x/api/graph", { headers });
  const local = await packed(get({ host: "127.0.0.1:4173", "accept-encoding": "gzip" }), answer());
  expect(local.headers.get("content-encoding")).toBeNull();
  expect(await local.text()).toBe(body);
  const far = await packed(get({ host: "vm.exe.xyz", "accept-encoding": "gzip, br" }), answer());
  expect(far.headers.get("content-encoding")).toBe("gzip");
  expect(new TextDecoder().decode(Bun.gunzipSync(new Uint8Array(await far.arrayBuffer())))).toBe(body);
  const etag = far.headers.get("etag")!;
  const again = await packed(get({ host: "vm.exe.xyz", "accept-encoding": "gzip", "if-none-match": etag }), answer());
  expect(again.status).toBe(304);
  const proxied = await packed(get({ host: "localhost:8000", "x-forwarded-host": "vm.exe.xyz", "accept-encoding": "gzip" }), answer());
  expect(proxied.headers.get("content-encoding")).toBe("gzip");
  const plain = await packed(get({ host: "vm.exe.xyz" }), answer()); // a client that takes no gzip
  expect(await plain.text()).toBe(body);
  const post = await packed(new Request("http://x/api/x", { method: "POST", headers: { host: "vm.exe.xyz", "accept-encoding": "gzip" } }), answer());
  expect(post.headers.get("etag")).toBeNull();
});
