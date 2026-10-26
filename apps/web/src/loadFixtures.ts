import { readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import type {
  Brief,
  BriefScore,
  Frame,
  PayloadDemo,
  PressureItem,
  TranscriptSegment,
} from "./render.js";
import type { RunLogLine } from "./modelStrip.js";
import { parseGlimmerRecall } from "./modelStrip.js";

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

export interface GlimmerLive {
  recall: string;
}

export function loadGlimmerLive(webRoot: string = WEB_ROOT): GlimmerLive | null {
  try {
    const raw = JSON.parse(
      readFileSync(
        join(
          webRoot,
          "..",
          "..",
          "services",
          "bot",
          "fixtures",
          "glimmer-live-eval.json",
        ),
        "utf8",
      ),
    ) as {
      health_status?: unknown;
      eval_returncode?: unknown;
      eval_stdout?: unknown;
    };
    if (raw.health_status !== 200 || raw.eval_returncode !== 0) return null;
    if (typeof raw.eval_stdout !== "string") return null;
    const recall = parseGlimmerRecall(raw.eval_stdout);
    if (recall === null) return null;
    return { recall };
  } catch {
    return null;
  }
}

export function loadBriefScore(webRoot: string = WEB_ROOT): BriefScore | null {
  try {
    const raw = JSON.parse(
      readFileSync(
        join(webRoot, "..", "..", "eval", "results", "hero-brief-score.json"),
        "utf8",
      ),
    ) as Record<string, unknown>;
    const keys = [
      "briefEntries",
      "truthEntries",
      "validatorClean",
      "matched",
      "categoryAgree",
    ] as const;
    const values = keys.map((k) => raw[k]);
    if (
      !values.every((v) => typeof v === "number" && Number.isFinite(v as number))
    ) {
      return null;
    }
    return {
      briefEntries: raw["briefEntries"] as number,
      truthEntries: raw["truthEntries"] as number,
      validatorClean: raw["validatorClean"] as number,
      matched: raw["matched"] as number,
      categoryAgree: raw["categoryAgree"] as number,
    };
  } catch {
    return null;
  }
}

export interface DemoData {
  brief: Brief;
  segments: TranscriptSegment[];
  frames: Frame[];
  runLog: RunLogLine[];
  pressureFallback: PressureItem[];
  payloadDemo: PayloadDemo | null;
  glimmerLive: GlimmerLive | null;
  briefScore: BriefScore | null;
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
  const heroInputDir = join(
    webRoot,
    "..",
    "..",
    "services",
    "bot",
    "fixtures",
    "hero-input",
  );
  const frames = parseFrames(
    readFileSync(join(heroInputDir, "frames.txt"), "utf8"),
  ).map((f) => {
    try {
      const pngBase64 = readFileSync(join(heroInputDir, f.file)).toString(
        "base64",
      );
      return { ...f, pngBase64 };
    } catch {
      return f;
    }
  });
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
  const glimmerLive = loadGlimmerLive(webRoot);
  const briefScore = loadBriefScore(webRoot);
  return { brief, segments, frames, runLog, pressureFallback, payloadDemo, glimmerLive, briefScore };
}
