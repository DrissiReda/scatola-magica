import { defineConfig } from "@playwright/test";

export default defineConfig({
  globalSetup: "./global-setup.ts",
  workers: 1,
  timeout: 300_000,
  expect: { timeout: 60_000 },
  reporter: [["list"], ["json", { outputFile: "test-results/results.json" }]],
  use: {
    channel: "chromium",
    launchOptions: {
      args: ["--unsafely-treat-insecure-origin-as-secure=http://scatola:3000,http://scatola2:3000,http://lb"],
    },
  },
});
