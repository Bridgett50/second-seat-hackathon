import { createServer } from "node:http";
import { loadDemo } from "./loadFixtures.js";
import { renderBriefPage } from "./render.js";

const PORT = Number(process.env.PORT ?? 4173);
const LIVE_DEV = process.env.LIVE_DEV === "1";

const server = createServer((req, res) => {
  const url = new URL(req.url ?? "/", "http://localhost");
  if (url.pathname === "/briefs/demo" || url.pathname === "/briefs/demo/") {
    const demo = loadDemo();
    const html = renderBriefPage(
      demo.brief,
      demo.segments,
      demo.frames,
      demo.runLog,
      {
        liveDev: LIVE_DEV,
        pressureFallback: demo.pressureFallback,
        payloadDemo: demo.payloadDemo,
        glimmerLive: demo.glimmerLive,
        briefScore: demo.briefScore,
      },
    );
    res.writeHead(200, { "content-type": "text/html; charset=utf-8" });
    res.end(html);
    return;
  }
  res.writeHead(404, { "content-type": "text/plain" });
  res.end("not found");
});

server.listen(PORT, () => {
  console.log(`web demo on http://localhost:${PORT}/briefs/demo`);
});
