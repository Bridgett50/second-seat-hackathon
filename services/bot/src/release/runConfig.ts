/**
 * C9 run configuration schema — preparation only.
 *
 * This file defines the shape of the eventual bounded evidence-run
 * configuration and validates it with dummy values in tests. It does not
 * authorize, launch, or fund any run.
 *
 * Preparation only: a timeout is not a hard billing guarantee; prices and
 * resource assumptions must be checked, and enforcement confirmed, before
 * separate authorization.
 */

const HEX_40 = /^[0-9a-fA-F]{40}$/;
const HEX_64 = /^[0-9a-fA-F]{64}$/;

export const RUN_CONFIG_REQUIRED_KEYS: readonly string[] = [
  "sourceSha",
  "dataset",
  "model",
  "image",
  "prompt",
  "schema",
  "scorer",
  "decoding",
  "tokenLimits",
  "timeouts",
  "retry",
  "modal",
  "glimmerDemoRequests",
  "budget",
];

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/**
 * Validate a run configuration. Returns an empty array when valid; each
 * error string names the offending key.
 */
export function validateRunConfig(cfg: unknown): string[] {
  const errors: string[] = [];
  if (!isRecord(cfg)) {
    return RUN_CONFIG_REQUIRED_KEYS.map((k) => `${k} is missing: config must be an object`);
  }
  for (const key of RUN_CONFIG_REQUIRED_KEYS) {
    if (!(key in cfg)) {
      errors.push(`${key} is missing`);
    }
  }

  const sourceSha = cfg["sourceSha"];
  if ("sourceSha" in cfg && !(typeof sourceSha === "string" && HEX_40.test(sourceSha))) {
    errors.push("sourceSha must be 40-hex");
  }

  if ("dataset" in cfg) {
    const dataset = cfg["dataset"];
    if (!isRecord(dataset)) {
      errors.push("dataset must be an object");
    } else {
      const id = dataset["id"];
      if (!(typeof id === "string" && id.length > 0)) {
        errors.push("dataset.id must be a non-empty string");
      }
      const sha = dataset["sha256"];
      if (!(typeof sha === "string" && HEX_64.test(sha))) {
        errors.push("dataset.sha256 must be 64-hex");
      }
    }
  }

  if ("model" in cfg) {
    const model = cfg["model"];
    if (!isRecord(model)) {
      errors.push("model must be an object");
    } else {
      const revision = model["revision"];
      if (!(typeof revision === "string" && HEX_40.test(revision))) {
        errors.push('model.revision must be 40-hex, not a branch like "main"');
      }
    }
  }

  if ("image" in cfg) {
    const image = cfg["image"];
    if (!isRecord(image)) {
      errors.push("image must be an object");
    } else {
      const ref = image["ref"];
      const digest = image["digest"];
      const refOk = typeof ref === "string" && /^.+@sha256:[0-9a-fA-F]{64}$/.test(ref);
      const digestOk = typeof digest === "string" && /^sha256:[0-9a-fA-F]{64}$/.test(digest);
      if (!refOk) {
        errors.push("image.ref must be pinned (@sha256:<64hex>)");
      }
      if (!digestOk) {
        errors.push("image.digest must be sha256:<64hex>");
      }
      if (refOk && digestOk && !(ref as string).endsWith(`@${digest as string}`)) {
        errors.push("image.ref must equal image.digest suffix");
      }
    }
  }

  for (const key of ["prompt", "schema", "scorer"] as const) {
    if (key in cfg) {
      const section = cfg[key];
      if (!isRecord(section)) {
        errors.push(`${key} must be an object`);
      } else {
        const sha = section["sha256"];
        if (!(typeof sha === "string" && HEX_64.test(sha))) {
          errors.push(`${key}.sha256 must be 64-hex`);
        }
      }
    }
  }

  if ("decoding" in cfg) {
    const decoding = cfg["decoding"];
    if (!isRecord(decoding)) {
      errors.push("decoding must be an object");
    } else {
      if (!("temperature" in decoding) || typeof decoding["temperature"] !== "number") {
        errors.push("decoding.temperature is missing or not a number");
      }
      if (!("seed" in decoding) || typeof decoding["seed"] !== "number") {
        errors.push("decoding.seed is missing or not a number");
      }
      if (!("reasoning" in decoding) || typeof decoding["reasoning"] !== "string") {
        errors.push("decoding.reasoning is missing or not a string");
      }
    }
  }

  if ("tokenLimits" in cfg) {
    const tokenLimits = cfg["tokenLimits"];
    if (!isRecord(tokenLimits)) {
      errors.push("tokenLimits must be an object");
    } else {
      const maxTokens = tokenLimits["maxTokens"];
      if (!(typeof maxTokens === "number" && Number.isInteger(maxTokens) && maxTokens > 0)) {
        errors.push("tokenLimits.maxTokens must be a positive integer");
      }
    }
  }

  if ("timeouts" in cfg) {
    const timeouts = cfg["timeouts"];
    if (!isRecord(timeouts)) {
      errors.push("timeouts must be an object");
    } else {
      const requestMs = timeouts["requestMs"];
      const workDeadlineS = timeouts["workDeadlineS"];
      const functionTimeoutS = timeouts["functionTimeoutS"];
      if (!(typeof requestMs === "number" && requestMs > 0)) {
        errors.push("timeouts.requestMs must be positive");
      }
      if (!(typeof workDeadlineS === "number" && workDeadlineS > 0)) {
        errors.push("timeouts.workDeadlineS must be positive");
      }
      if (!(typeof functionTimeoutS === "number" && functionTimeoutS > 0)) {
        errors.push("timeouts.functionTimeoutS must be positive");
      }
      if (
        typeof workDeadlineS === "number" &&
        typeof functionTimeoutS === "number" &&
        workDeadlineS > 0 &&
        functionTimeoutS > 0 &&
        !(workDeadlineS < functionTimeoutS)
      ) {
        errors.push("timeouts.workDeadlineS must be less than timeouts.functionTimeoutS");
      }
    }
  }

  if ("retry" in cfg) {
    const retry = cfg["retry"];
    if (!isRecord(retry)) {
      errors.push("retry must be an object");
    } else if (retry["maxAttempts"] !== 1) {
      errors.push("retry.maxAttempts must equal 1 for the Spark proof run");
    }
  }

  if ("modal" in cfg) {
    const modal = cfg["modal"];
    if (!isRecord(modal)) {
      errors.push("modal must be an object");
    } else {
      if (modal["allocations"] !== 1) {
        errors.push("modal.allocations must be 1 (single allocation)");
      }
      if (modal["scoredCanary"] !== true) {
        errors.push("modal.scoredCanary must be true (scored canary)");
      }
      const concurrency = modal["concurrency"];
      const maxConcurrency = modal["maxConcurrency"];
      if (
        !(typeof concurrency === "number" && typeof maxConcurrency === "number") ||
        !(Number.isInteger(concurrency) && Number.isInteger(maxConcurrency)) ||
        !(concurrency >= 1 && concurrency <= maxConcurrency)
      ) {
        errors.push("modal.concurrency must satisfy 1 <= concurrency <= modal.maxConcurrency");
      }
      if (modal["teardown"] !== true) {
        errors.push("modal.teardown must be true");
      }
      if (modal["evidenceDownload"] !== "complete") {
        errors.push('modal.evidenceDownload must be "complete"');
      }
    }
  }

  if ("glimmerDemoRequests" in cfg) {
    const value = cfg["glimmerDemoRequests"];
    if (!(typeof value === "number" && Number.isInteger(value) && value >= 0)) {
      errors.push("glimmerDemoRequests must be a non-negative integer");
    }
  }

  if ("budget" in cfg) {
    const budget = cfg["budget"];
    if (!isRecord(budget)) {
      errors.push("budget must be an object");
    } else {
      if (budget["status"] !== "PROPOSED") {
        errors.push('budget.status must be "PROPOSED"');
      }
      const modalUsd = budget["modalUsd"];
      const sparkUsd = budget["sparkUsd"];
      const totalUsd = budget["totalUsd"];
      if (!(typeof modalUsd === "number" && Math.abs(modalUsd - 2) < 1e-9)) {
        errors.push("budget.modalUsd must be 2");
      }
      if (!(typeof sparkUsd === "number" && Math.abs(sparkUsd - 0.1) < 1e-9)) {
        errors.push("budget.sparkUsd must be 0.10");
      }
      if (!(typeof totalUsd === "number" && Math.abs(totalUsd - 2.1) < 1e-9)) {
        errors.push("budget.totalUsd must be 2.10");
      }
    }
  }

  return errors;
}

/** Options for the Spark proof client derived from a validated run config. */
export function sparkProofClientOptions(cfg: { retry: { maxAttempts: number } }): { maxAttempts: number } {
  return { maxAttempts: cfg.retry.maxAttempts };
}
