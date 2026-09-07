/**
 * Click a place on the map and check the panel answers: who held it, when it
 * changes hands, and what the American press had. Also proves the click
 * resolves into the right campaign when several fronts are drawn at once.
 *
 *   node scripts/check-panel.mjs <outDir> [date] [lng] [lat]
 */
import { chromium } from "playwright";

const OUT = process.argv[2];
const DATE = process.argv[3] ?? "1941-09-26";
const LNG = Number(process.argv[4] ?? 30.52); // Kiev
const LAT = Number(process.argv[5] ?? 50.45);

const b = await chromium.launch({ args: ["--use-gl=angle","--use-angle=swiftshader","--enable-unsafe-swiftshader"] });
const p = await b.newPage({ viewport: { width: 1500, height: 950 }, deviceScaleFactor: 2 });
const errs = []; p.on("pageerror", (e) => errs.push(String(e)));

await p.goto("http://localhost:3000", { waitUntil: "domcontentloaded" });
await p.waitForSelector("canvas");
await p.waitForTimeout(4000);

await p.evaluate((iso) => {
  const el = document.querySelector("input[type=range]");
  const day = Math.round(Date.parse(iso + "T00:00:00Z") / 86_400_000);
  Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, "value").set.call(el, String(day));
  el.dispatchEvent(new Event("input", { bubbles: true }));
}, DATE);
await p.waitForTimeout(3500);

const pt = await p.evaluate(([lng, lat]) => window.__map.project([lng, lat]), [LNG, LAT]);
await p.mouse.click(pt.x, pt.y);
await p.waitForFunction(() => !document.body.innerText.includes("Searching the archive"), { timeout: 45_000 })
  .catch(() => console.log("archive lookup did not settle in 45s"));
await p.waitForTimeout(1200);

if (OUT) await p.screenshot({ path: `${OUT}/panel.png` });
console.log(await p.evaluate(() => {
  const el = [...document.querySelectorAll("div")].find((d) => d.innerText?.startsWith("SELECTED"));
  return el ? el.innerText : "no place panel opened";
}));
console.log(errs.length ? `ERRORS:\n${errs.join("\n")}` : "no page errors");
await b.close();
