export interface RunLogLine {
  stage: string;
  model: string;
  at: string;
  note?: string;
}

export interface ModelChip {
  stage: string;
  model: string | null;
  status: "run" | "not run";
}

export const MODEL_STAGES = [
  "glimmer-redact",
  "spark-brief",
  "spark-shield",
  "sam-region",
  "image-slide",
] as const;

export function modelChips(runLog: RunLogLine[]): ModelChip[] {
  const byStage = new Map(runLog.map((line) => [line.stage, line.model]));
  return MODEL_STAGES.map((stage) => {
    const model = byStage.get(stage) ?? null;
    return { stage, model, status: model === null ? "not run" : "run" };
  });
}
