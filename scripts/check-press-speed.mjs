/**
 * The front pages must not make the reader wait.
 *
 * Everything is baked to disk, so stepping the timeline should never show a
 * loading state: the index is in memory and the scans for nearby days have
 * already been warmed. This walks a run of days and fails if any of them
 * renders "searching…".
 */
import { chromium } from "playwright";

const b = await chromium.launch({ args: ["--use-gl=angle","--use-angle=swiftshader","--enable-unsafe-swiftshader"] });
const p = await b.newPage({ viewport: { width: 1500, height: 950 } });
await p.goto("http://localhost:3000", { waitUntil: "domcontentloaded" });
await p.waitForSelector("canvas");
await p.waitForTimeout(5000);

const setDate = (iso) => p.evaluate((v) => {
  const el = document.querySelector("input[type=range]");
  const day = Math.round(Date.parse(v + "T00:00:00Z") / 86_400_000);
  Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, "value").set.call(el, String(day));
  el.dispatchEvent(new Event("input", { bubbles: true }));
}, iso);

let stalls = 0, checked = 0, worst = 0;
for (let i = 1; i <= 20; i++) {
  const iso = `1939-09-${String(i).padStart(2, "0")}`;
  const t0 = Date.now();
  await setDate(iso);
  await p.waitForTimeout(60);
  const searching = await p.evaluate(() => document.body.innerText.includes("searching…"));
  const took = Date.now() - t0;
  worst = Math.max(worst, took);
  checked++;
  if (searching) { stalls++; console.log(`  ${iso}: still searching after ${took}ms`); }
}
console.log(`${checked} day-steps, ${stalls} showed a loading state, slowest step ${worst}ms`);
console.log(stalls === 0 ? "PASS — the papers are there before the day is" : "FAIL — the strip is still waiting on something");
await b.close();
process.exit(stalls === 0 ? 0 : 1);
