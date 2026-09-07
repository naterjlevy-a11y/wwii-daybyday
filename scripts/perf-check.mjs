/**
 * Time the simulate loop. The hex source must not be rebuilt on every day
 * step — only when the set of live campaigns changes — or playback crawls
 * once Barbarossa's 9,176 cells are on screen.
 */
import { chromium } from "playwright";
const b = await chromium.launch({ args: ["--use-gl=angle","--use-angle=swiftshader","--enable-unsafe-swiftshader"] });
const p = await b.newPage({ viewport: { width: 1400, height: 880 } });
await p.goto("http://localhost:3000", { waitUntil: "domcontentloaded" });
await p.waitForSelector("canvas");
await p.waitForTimeout(5000);

// Count how often the hex source actually receives new data.
await p.evaluate(() => {
  const src = window.__map.getSource("hexes");
  window.__setDataCalls = 0;
  const orig = src.setData.bind(src);
  src.setData = (d) => { window.__setDataCalls++; return orig(d); };
});

const setDate = (v) => p.evaluate((iso) => {
  const el = document.querySelector("input[type=range]");
  const day = Math.round(Date.parse(iso + "T00:00:00Z") / 86400000);
  Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, "value").set.call(el, String(day));
  el.dispatchEvent(new Event("input", { bubbles: true }));
}, v);

// Thirty days inside Barbarossa: same campaigns throughout.
await setDate("1941-08-01");
await p.waitForTimeout(2500);
await p.evaluate(() => { window.__setDataCalls = 0; });

const t0 = Date.now();
for (let i = 1; i <= 30; i++) {
  await setDate(`1941-08-${String(i).padStart(2, "0")}`);
  await p.waitForTimeout(40);
}
const elapsed = Date.now() - t0;
const calls = await p.evaluate(() => window.__setDataCalls);
console.log(`30 day-steps inside one campaign set: ${elapsed}ms, hex source rebuilt ${calls}x`);
console.log(calls === 0 ? "PASS — stepping a day only repaints" : "FAIL — the source is being rebuilt per day");
await b.close();
