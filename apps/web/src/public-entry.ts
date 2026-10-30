// Offline-only public entry point for a hosted demo (for example Render).
// It reuses createWebServer() from server.ts, binds 0.0.0.0 on PORT, and
// refuses to start unless SECOND_SEAT_MODE=offline and SECOND_SEAT_TEST_MODE,
// LIVE_DEV and SECOND_SEAT_EXPERIMENTAL_IMAGES are each unset or "0".
// The loopback CLI in server.ts (127.0.0.1) is unchanged.
// Run after the build: node apps/web/dist/src/public-entry.js
import type { Server } from "node:http";
import { pathToFileURL } from "node:url";
import { createWebServer } from "./server.js";

/** The public entry listens on every interface; the loopback CLI does not. */
export const PUBLIC_BIND_HOST = "0.0.0.0";

type Env = Readonly<Record<string, string | undefined>>;

function isOff(value: string | undefined): boolean {
  return value === undefined || value === "" || value === "0";
}

/**
 * Every reason this environment may not start the public entry.
 * An empty list means startup is allowed. Names only, never values.
 */
export function publicEntryProblems(env: Env): string[] {
  const problems: string[] = [];
  if (env["SECOND_SEAT_MODE"] !== "offline") problems.push("SECOND_SEAT_MODE must be offline");
  if (!isOff(env["SECOND_SEAT_TEST_MODE"])) problems.push("SECOND_SEAT_TEST_MODE must be unset or 0");
  if (!isOff(env["LIVE_DEV"])) problems.push("LIVE_DEV must be unset or 0");
  if (!isOff(env["SECOND_SEAT_EXPERIMENTAL_IMAGES"])) {
    problems.push("SECOND_SEAT_EXPERIMENTAL_IMAGES must be unset or 0");
  }
  const port = env["PORT"] ?? "";
  if (!/^\d{1,5}$/.test(port) || Number(port) > 65535) problems.push("PORT must be a port number");
  return problems;
}

/**
 * Start the offline public server from process.env (the same environment
 * createWebServer() reads). Rejects without listening when any check fails.
 */
export function startPublicServer(): Promise<Server> {
  const problems = publicEntryProblems(process.env);
  if (problems.length > 0) {
    return Promise.reject(new Error(`refusing to start: ${problems.join("; ")}`));
  }
  const server = createWebServer();
  return new Promise<Server>((resolve, reject) => {
    server.once("error", reject);
    server.listen(Number(process.env["PORT"]), PUBLIC_BIND_HOST, () => resolve(server));
  });
}

const isMain =
  process.argv[1] !== undefined && import.meta.url === pathToFileURL(process.argv[1]).href;
if (isMain) {
  startPublicServer().then(
    (server) => {
      const addr = server.address();
      const port = addr !== null && typeof addr === "object" ? addr.port : process.env["PORT"];
      console.log(`offline public demo on ${PUBLIC_BIND_HOST}:${port} (/meeting-room?demo=1)`);
    },
    (err: unknown) => {
      console.error(err instanceof Error ? err.message : String(err));
      process.exit(1);
    },
  );
}
