import { defineConfig, devices } from "@playwright/test";

export default defineConfig({
  testDir: "./e2e",
  // One worker: e2e specs share one server whose outbound log is global, so
  // parallel specs made exact analyzer-call assertions racy.
  workers: 1,
  use: {
    baseURL: "http://localhost:4173",
  },
  reporter: [["list"], ["html", { open: "never", outputFolder: "playwright-report" }]],
  webServer: {
    command: "node dist/src/server.js",
    port: 4173,
    reuseExistingServer: !process.env.CI,
    env: {
      PORT: "4173",
      SECOND_SEAT_TEST_MODE: "1",
      MODEL_API_KEY: "test-dummy-not-a-key",
      META_API_KEY: "test-dummy-not-a-key",
    },
  },
  projects: [{ name: "chromium", use: { ...devices["Desktop Chrome"] } }],
});
