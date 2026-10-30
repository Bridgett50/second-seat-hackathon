import { pathToFileURL } from "node:url";
import type { Server } from "node:http";
import { createWebServer } from "./server.js";

export const PUBLIC_BIND_HOST = "0.0.0.0";

export type EnvRecord = Record<string, string | undefined>;

export function validatePublicStartEnv(env: EnvRecord): string[] {
  const errors: string[] = [];

  // PORT must be present and valid TCP port
  const portRaw = env["PORT"];
  if (portRaw === undefined || portRaw === "") {
    errors.push("Refused: PORT is required");
  } else {
    const n = Number(portRaw);
    if (!Number.isInteger(n) || n < 1 || n > 65535) {
      errors.push("Refused: PORT must be a valid TCP port number");
    }
  }

  // SECOND_SEAT_MODE must be offline
  if (env["SECOND_SEAT_MODE"] !== "offline") {
    errors.push("Refused: SECOND_SEAT_MODE must be offline");
  }

  // Each of these must be unset or "0"
  for (const key of ["SECOND_SEAT_TEST_MODE", "LIVE_DEV", "SECOND_SEAT_EXPERIMENTAL_IMAGES"] as const) {
    const v = env[key];
    if (v !== undefined && v !== "0") {
      errors.push(`Refused: ${key} must be unset or 0`);
    }
  }

  return errors;
}

/** Parse PORT after validation; caller should have validated first. */
function parsePort(env: EnvRecord): number {
  return Number(env["PORT"]);
}

export function startPublicServer(env: EnvRecord = process.env as EnvRecord): Promise<Server> {
  const problems = validatePublicStartEnv(env);
  if (problems.length > 0) {
    const msg = problems.join("; ");
    throw new Error(msg);
  }
  const port = parsePort(env);
  const server = createWebServer();
  return new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(port, PUBLIC_BIND_HOST, () => {
      server.off("error", reject);
      resolve(server);
    });
  });
}

const isMain =
  process.argv[1] !== undefined && import.meta.url === pathToFileURL(process.argv[1]).href;

if (isMain) {
  try {
    const problems = validatePublicStartEnv(process.env as EnvRecord);
    if (problems.length > 0) {
      for (const p of problems) console.error(p);
      process.exit(1);
    }
    const port = parsePort(process.env as EnvRecord);
    const server = createWebServer();
    server.listen(port, PUBLIC_BIND_HOST, () => {
      console.log(`public demo on http://${PUBLIC_BIND_HOST}:${port}/briefs/demo`);
    });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error(msg);
    process.exit(1);
  }
}
