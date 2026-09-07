/**
 * Walk the whole war looking for the app falling over.
 *
 * Steps every N days from the first to the last, watching for page errors,
 * failed requests, a map that has stopped rendering, and a UI that has gone
 * blank. Reports the first date each distinct failure appears on.
 */
import { chromium } from "playwright";

const STEP = Number(process.argv[2] ?? 5);
const b = await chromium.launch({ args: ["--use-gl=angle","--use-angle=swiftshader","--enable-unsafe-swiftshader"] });
const p = await b.newPage({ viewport: { width: 1500, height: 950 } });

const seen = new Map();
let current = "start";
const note = (kind, detail) => {
  const key = `${kind}: ${detail}`.slice(0, 200);
  if (!seen.has(key)) seen.set(key, current);
};
p.on("pageerror", (e) => note("PAGE ERROR", String(e)));
p.on("console", (m) => m.type() === "error" && note("CONSOLE", m.text()));
p.on("requestfailed", (r) => note("REQ FAILED", r.url().slice(0, 110)));
p.on("response", (r) => r.status() >= 400 && note(`HTTP ${r.status()}`, r.url().slice(0, 110)));

await p.goto("http://localhost:3000", { waitUntil: "domcontentloaded" });
await p.waitForSelector("canvas");
await p.waitForTimeout(5000);

const DAY = 86_400_000;
const first = Date.parse("1939-09-01T00:00:00Z") / DAY;
const last = Date.parse("1941-12-31T00:00:00Z") / DAY;

let checked = 0;
for (let d = first; d <= last; d += STEP) {
  current = new Date(d * DAY).toISOString().slice(0, 10);
  await p.evaluate((v) => {
    const el = document.querySelector("input[type=range]");
    const day = Math.round(Date.parse(v + "T00:00:00Z") / 86_400_000);
    Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, "value").set.call(el, String(day));
    el.dispatchEvent(new Event("input", { bubbles: true }));
  }, current);
  await p.waitForTimeout(120);

  const state = await p.evaluate(() => {
    const m = window.__map;
    return {
      alive: Boolean(m) && Boolean(m.getCanvas()),
      hexes: m ? m.queryRenderedFeatures({ layers: ["hex-fill"] }).length : -1,
      text: document.body.innerText.length,
    };
  }).catch((e) => ({ crashed: String(e) }));

  if (state.crashed) note("EVALUATE THREW", state.crashed);
  else {
    if (!state.alive) note("MAP GONE", "window.__map missing");
    if (state.text < 200) note("UI BLANK", `body text ${state.text} chars`);
  }
  checked++;
}

console.log(`stepped ${checked} dates every ${STEP} days`);
if (seen.size === 0) console.log("no failures");
else for (const [what, when] of seen) console.log(`  first at ${when} — ${what}`);
await b.close();
