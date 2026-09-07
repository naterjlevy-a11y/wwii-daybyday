import { chromium } from "playwright";
const OUT = process.argv[2];
const b = await chromium.launch({ args: ["--use-gl=angle","--use-angle=swiftshader","--enable-unsafe-swiftshader"] });
const p = await b.newPage({ viewport: { width: 1500, height: 950 }, deviceScaleFactor: 2 });
const errs=[]; p.on("pageerror",e=>errs.push(String(e)));
await p.goto("http://localhost:3000", { waitUntil: "domcontentloaded" });
await p.waitForSelector("canvas");
await p.waitForTimeout(4000);
await p.evaluate(() => {
  const el = document.querySelector("input[type=range]");
  const day = Math.round(Date.parse("1941-11-27T00:00:00Z") / 86400000);
  Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, "value").set.call(el, String(day));
  el.dispatchEvent(new Event("input", { bubbles: true }));
});
await p.waitForTimeout(3500);
const before = await p.evaluate(() => ({ z: +window.__map.getZoom().toFixed(2), c: window.__map.getCenter().toArray().map(n=>+n.toFixed(1)) }));
console.log("both fronts:", JSON.stringify(before));

await p.getByRole("button", { name: "The Western Desert" }).click();
await p.waitForTimeout(3500);
const desert = await p.evaluate(() => ({ z: +window.__map.getZoom().toFixed(2), c: window.__map.getCenter().toArray().map(n=>+n.toFixed(1)) }));
console.log("focused desert:", JSON.stringify(desert));
await p.screenshot({ path: `${OUT}/focus-desert.png` });

await p.getByRole("button", { name: "Barbarossa" }).click();
await p.waitForTimeout(3500);
const barb = await p.evaluate(() => ({ z: +window.__map.getZoom().toFixed(2), c: window.__map.getCenter().toArray().map(n=>+n.toFixed(1)) }));
console.log("focused barbarossa:", JSON.stringify(barb));
await p.screenshot({ path: `${OUT}/focus-barbarossa.png` });

const moved = desert.c[0] !== barb.c[0] && desert.z > before.z;
console.log(moved ? "PASS — picking a front zooms to it" : "FAIL — the camera did not follow the picker");
console.log(errs.length ? "ERRORS:\n"+errs.slice(0,4).join("\n") : "no page errors");
await b.close();
