// MapLibre v6 locates its worker relative to import.meta.url. Bundlers that
// rewrite that (Turbopack, among others) point it at a chunk path where the
// worker file does not exist, so the worker never boots and no source ever
// finishes parsing — the map stays blank with no error. We serve the worker
// from /public instead and hand MapLibre the URL explicitly.
import { copyFileSync, mkdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const from = join(root, "node_modules/maplibre-gl/dist");
const to = join(root, "public/maplibre");
mkdirSync(to, { recursive: true });
for (const f of ["maplibre-gl-worker.mjs", "maplibre-gl-shared.mjs"]) {
  copyFileSync(join(from, f), join(to, f));
  console.log("copied", f);
}
