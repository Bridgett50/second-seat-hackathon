import { readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import type {
  Brief,
  Frame,
  PayloadDemo,
  PressureItem,
  TranscriptSegment,
} from "./render.js";
import type { RunLogLine } from "./modelStrip.js";

const here = dirname(fileURLToPath(import.meta.url));

function findWebRoot(start: string): string {
  let dir = start;
  for (let i = 0; i < 6; i++) {
    try {
      const pkg = JSON.parse(readFileSync(join(dir, "package.json"), "utf8")) as {
        name?: string;
      };
      if (pkg.name === "@second-seat/web") return dir;
    } catch {
      /* keep walking up */
    }
    const parent = dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }
  return start;
}

export const WEB_ROOT = findWebRoot(here);

export function parseTranscript(text: string): TranscriptSegment[] {
  const out: TranscriptSegment[] = [];
  for (const line of text.split("\n")) {
    const m = line.match(/^\[(\d{2}:\d{2})\]\s+([^:]+):\s*(.*)$/);
    if (!m || m[1] === undefined || m[2] === undefined || m[3] === undefined) {
      continue;
    }
    out.push({
      id: `t-${m[1]}`,
      time: m[1],
      speaker: m[2].trim(),
      text: m[3],
    });
  }
  return out;
}

export function parseFrames(text: string): Frame[] {
  const out: Frame[] = [];
  for (const line of text.split("\n")) {
    const m = line.trim().match(/^(\S+)\s+(\d{2}:\d{2})$/);
    if (!m || m[1] === undefined || m[2] === undefined) continue;
    out.push({ id: `f-${m[2]}`, file: m[1], time: m[2] });
  }
  return out;
}

export interface DemoData {
  brief: Brief;
  segments: TranscriptSegment[];
  frames: Frame[];
  runLog: RunLogLine[];
  pressureFallback: PressureItem[];
  payloadDemo: PayloadDemo | null;
}

export function loadDemo(webRoot: string = WEB_ROOT): DemoData {
  const recorded = JSON.parse(
    readFileSync(
      join(webRoot, "..", "..", "services", "bot", "fixtures", "hero-brief.recorded.json"),
      "utf8",
    ),
  );
  const brief = JSON.parse(recorded.rawText) as Brief;
  const segments = parseTranscript(
    readFileSync(
      join(webRoot, "..", "..", "services", "bot", "fixtures", "hero-input", "transcript.txt"),
      "utf8",
    ),
  );
  const frames = parseFrames(
    readFileSync(
      join(webRoot, "..", "..", "services", "bot", "fixtures", "hero-input", "frames.txt"),
      "utf8",
    ),
  );
  const runLog = readFileSync(join(webRoot, "fixtures", "run-log.jsonl"), "utf8")
    .split("\n")
    .filter((l) => l.trim().length > 0)
    .map((l) => JSON.parse(l) as RunLogLine);
  let pressureFallback: PressureItem[] = [];
  try {
    const raw = JSON.parse(
      readFileSync(join(webRoot, "fixtures", "pressure-demo.json"), "utf8"),
    );
    pressureFallback = (raw.items as { id: string; text: string; segmentId: string }[]).map(
      (it) => ({ id: it.id, text: it.text, segmentIds: [it.segmentId] }),
    );
  } catch {
    pressureFallback = [];
  }
  let payloadDemo: PayloadDemo | null = null;
  try {
    payloadDemo = JSON.parse(
      readFileSync(join(webRoot, "fixtures", "payload-demo.json"), "utf8"),
    ) as PayloadDemo;
  } catch {
    payloadDemo = null;
  }
  return { brief, segments, frames, runLog, pressureFallback, payloadDemo };
}
