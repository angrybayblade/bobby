// The link preview card (Open Graph / Twitter): 1200 × 630, Bobby's head and the line on the left, the real mock (the
// Lens step, shot from the running site) on the right. Writes ../assets/og.png.
// usage: node og.mjs [site url]      the site served locally, e.g. python3 -m http.server 8080 --directory marketing
import puppeteer from "puppeteer-core";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));
const SITE = process.argv[2] ?? "http://127.0.0.1:8080/";
const STEP = 9; // Lens, with what the change relies on and affects either side, and a draft comment
const CHROME = process.env.CHROME ?? "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";
const wait = (ms) => new Promise((r) => setTimeout(r, ms));

const browser = await puppeteer.launch({ executablePath: CHROME, headless: "new" });
const page = await browser.newPage();

// the mock, at the step, from the site itself
await page.setViewport({ width: 1600, height: 900, deviceScaleFactor: 2 });
await page.goto(SITE, { waitUntil: "networkidle0" });
await page.evaluate((s) => { const st = document.querySelector("[data-story]"); const t = st.offsetHeight - innerHeight; scrollTo(0, st.offsetTop + (t * (s + 0.5)) / document.querySelectorAll("[data-cap]").length); }, STEP);
await wait(3000);
const mock = await (await page.$(".frame")).screenshot({ encoding: "base64" });

// the card
const head = readFileSync(join(HERE, "../assets/bobby.svg"), "utf8");
await page.setViewport({ width: 1200, height: 630, deviceScaleFactor: 1 });
await page.setContent(`<!doctype html><html><head>
<link href="https://fonts.googleapis.com/css2?family=Inter:wght@400;500;700;800&family=JetBrains+Mono:wght@500&display=swap" rel="stylesheet">
<style>
  * { box-sizing: border-box; margin: 0; }
  body { width: 1200px; height: 630px; overflow: hidden; background: #f6f2ea; font-family: Inter, sans-serif; color: #2b261e; position: relative; }
  .copy { position: absolute; left: 64px; top: 0; bottom: 0; width: 430px; display: flex; flex-direction: column; justify-content: center; }
  .brand { display: flex; align-items: center; gap: 12px; margin-bottom: 36px; font-size: 30px; font-weight: 700; letter-spacing: -.02em; }
  .brand svg { width: 64px; height: 64px; }
  h1 { font-size: 50px; line-height: 1.06; font-weight: 800; letter-spacing: -.035em; margin-bottom: 22px; text-wrap: balance; }
  p { font-size: 21px; line-height: 1.45; color: #6e6556; }
  small { display: block; margin-top: 30px; font: 500 16px "JetBrains Mono", monospace; color: #a8691a; }
  .mock { position: absolute; left: 540px; top: 70px; width: 820px; border-radius: 4px; box-shadow: 0 0 0 1px rgba(60, 40, 10, .16), 0 30px 70px -24px rgba(60, 40, 10, .35); }
</style></head><body>
  <div class="copy">
    <div class="brand">${head}<span>bobby</span></div>
    <h1>Review a PR one focused page at a time.</h1>
    <p>Your GitHub pull request as a short walk of focused pages. Same diff, same threads, same review.</p>
    <small>bobby.viraj.computer</small>
  </div>
  <img class="mock" src="data:image/png;base64,${mock}">
</body></html>`, { waitUntil: "load" });
await page.evaluate(() => document.fonts.ready);
await page.screenshot({ path: join(HERE, "../assets/og.png"), type: "png" });
await browser.close();
console.log("wrote marketing/assets/og.png");
