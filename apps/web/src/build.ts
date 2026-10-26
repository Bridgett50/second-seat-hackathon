import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { loadDemo, WEB_ROOT } from "./loadFixtures.js";
import { renderBriefPage } from "./render.js";

const demo = loadDemo();
const html = renderBriefPage(
  demo.brief,
  demo.segments,
  demo.frames,
  demo.runLog,
  {
    liveDev: false,
    pressureFallback: demo.pressureFallback,
    payloadDemo: demo.payloadDemo,
    glimmerLive: demo.glimmerLive,
  },
);
const outDir = join(WEB_ROOT, "dist-site", "briefs", "demo");
mkdirSync(outDir, { recursive: true });
writeFileSync(join(outDir, "index.html"), html);
console.log(`wrote ${join(outDir, "index.html")}`);
