import { describe, expect, it } from "vitest";
import { modelChips } from "../src/modelStrip.js";
import { loadDemo } from "../src/loadFixtures.js";

describe("modelChips", () => {
  it("marks a missing sam-region stage as not run", () => {
    const { runLog } = loadDemo();
    expect(runLog.some((l) => l.stage === "sam-region")).toBe(false);
    const chips = modelChips(runLog);
    expect(chips.map((c) => c.stage)).toEqual([
      "glimmer-redact",
      "spark-brief",
      "spark-shield",
      "sam-region",
      "image-slide",
    ]);
    expect(chips.find((c) => c.stage === "sam-region")).toEqual({
      stage: "sam-region",
      model: null,
      status: "not run",
    });
  });

  it("reports the model for stages present in the run log", () => {
    const { runLog } = loadDemo();
    const chips = modelChips(runLog);
    expect(
      chips.find((c) => c.stage === "glimmer-redact"),
    ).toMatchObject({ status: "run", model: "meta-models/Muse-Glimmer-30B" });
  });
});
