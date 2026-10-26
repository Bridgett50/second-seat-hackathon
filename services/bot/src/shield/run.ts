/**
 * shield:run CLI: `shield:run <lines.jsonl> --record <path>`.
 *
 * Runs the live Spark pressure classifier (ONE batched call) over the
 * input lines and records the raw response to `--record`, marked as
 * recorded from a live call. Lines file: JSONL of {segmentId, text}.
 */
import { readFileSync, writeFileSync } from "node:fs";
import { PRESSURE_MODEL, PRESSURE_PROMPT_VERSION, SparkPressureClassifier } from "./classify.js";

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
  const classifier = new SparkPressureClassifier();
  const { labels, rawText, usage: callUsage } = await classifier.classifyRaw(lines);
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
