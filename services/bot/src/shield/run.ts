/**
 * shield:run CLI: `shield:run <lines.jsonl> --record <path>`.
 *
 * Runs the live Spark pressure classifier (ONE batched call) over the
 * input lines and records the raw response to `--record`, marked as
 * recorded from a live call. Lines file: JSONL of {segmentId, text}.
 */
import { readFileSync, writeFileSync } from "node:fs";
import { PRESSURE_MODEL, PRESSURE_PROMPT_VERSION, SparkPressureClassifier } from "./classify.js";
import { createPrivacyGate } from "../private/gate.js";

function usage(): never {
  console.error("usage: shield:run <lines.jsonl> --record <path>");
  process.exit(2);
}

async function main(): Promise<void> {
  const argv = process.argv.slice(2);
  const recordFlag = argv.indexOf("--record");
  if (argv.length < 3 || recordFlag === -1 || recordFlag + 1 >= argv.length) {
    usage();
  }
  const linesPath = argv[0] as string;
  const recordPath = argv[recordFlag + 1] as string;
  const lines = readFileSync(linesPath, "utf8")
    .split("\n")
    .filter((line) => line.trim() !== "")
    .map((line) => JSON.parse(line) as { segmentId: string; text: string });
  // Live analysis goes through the privacy gate: raw line text reaches
  // only the Glimmer redactor, and Spark receives only approved
  // redacted text via gate-minted GatedText.
  const gate = createPrivacyGate({ mode: "live" });
  const gatedLines = await Promise.all(
    lines.map(async (line) => {
      const prepared = await gate.prepare(line.text);
      const token = gate.approve(prepared.runId, prepared.redactedText);
      const gated = await gate.send(prepared.runId, token, async (g) => g);
      return { segmentId: line.segmentId, text: gated };
    }),
  );
  const classifier = new SparkPressureClassifier();
  const { labels, rawText, usage: callUsage } = await classifier.classifyRaw(gatedLines);
  writeFileSync(
    recordPath,
    `${JSON.stringify({
      recordedFromLiveCall: true,
      model: PRESSURE_MODEL,
      promptVersion: PRESSURE_PROMPT_VERSION,
      timestamp: new Date().toISOString(),
      rawText,
      ...callUsage,
    })}\n`,
    "utf8",
  );
  console.log(JSON.stringify({ recorded: recordPath, labels }, null, 2));
}

await main();
