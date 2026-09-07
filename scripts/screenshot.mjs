/**
 * Screenshot the running app at a set of dates.
 *
 *   node scripts/screenshot.mjs <outDir> [date...]   (defaults to a spread across the war)
 *
 * Uses a software GL stack so it runs headless. `networkidle` never settles
 * here — the front-page scans stream in lazily — so it waits on the canvas and
 * on the press strip instead.
 */
import { chromium } from "playwright";

const OUT = process.argv[2];
const DATES = process.argv.slice(3);
const dates = DATES.length ? DATES : [
  "1939-09-01", "1939-09-09", "1939-09-18", "1939-10-06",  // Poland
  "1939-10-14", "1939-11-08",                              // the Phoney War
  "1939-12-06", "1940-01-08", "1940-03-13",                // Finland
];

if (!OUT) { console.error("usage: node scripts/screenshot.mjs <outDir> [date...]"); process.exit(1); }

const browser = await chromium.launch({
  args: ["--use-gl=angle", "--use-angle=swiftshader", "--enable-unsafe-swiftshader"],
});
const page = await browser.newPage({ viewport: { width: 1500, height: 950 }, deviceScaleFactor: 2 });
const errors = [];
page.on("pageerror", (e) => errors.push(String(e)));
page.on("console", (m) => m.type() === "error" && errors.push(m.text()));

await page.goto("http://localhost:3000", { waitUntil: "domcontentloaded" });
await page.waitForSelector("canvas");
await page.waitForTimeout(4000);

for (const date of dates) {
  await page.evaluate((v) => {
    const el = document.querySelector("input[type=range]");
    const day = Math.round(Date.parse(`${v}T00:00:00Z`) / 86_400_000);
    Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, "value").set.call(el, String(day));
    el.dispatchEvent(new Event("input", { bubbles: true }));
  }, date);
  await page
    .waitForFunction(() => !document.body.innerText.includes("searching…"), { timeout: 20_000 })
    .catch(() => {});
  await page.waitForTimeout(3000);
  await page.screenshot({ path: `${OUT}/${date}.png` });
  console.log("captured", date);
}

console.log(errors.length ? `PAGE ERRORS:\n${errors.slice(0, 8).join("\n")}` : "no page errors");
await browser.close();
