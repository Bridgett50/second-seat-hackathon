import { defineConfig, devices } from "@playwright/test";

export default defineConfig({
  testDir: "./e2e-meeting-room",
  // One worker: specs share one server, so parallel runs would race.
  workers: 1,
  outputDir: "test-results/meeting-room",
  reporter: [["list"]],
  use: {
    baseURL: "http://127.0.0.1:4174",
  },
  webServer: {
    command: "node dist/src/server.js",
    url: "http://127.0.0.1:4174/meeting-room",
    reuseExistingServer: false,
    // Test mode only on this private loopback process (the server binds 127.0.0.1).
    env: {
      PORT: "4174",
      SECOND_SEAT_TEST_MODE: "1",
      MODEL_API_KEY: "test-dummy-not-a-key",
      META_API_KEY: "test-dummy-not-a-key",
    },
  },
  projects: [
    {
      name: "chrome",
      use: {
        ...devices["Desktop Chrome"],
        launchOptions: {
          executablePath:
            process.env.PLAYWRIGHT_CHROME_PATH || "/usr/bin/google-chrome",
        },
        headless: true,
      },
    },
  ],
});
