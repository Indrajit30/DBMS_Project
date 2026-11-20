import { defineConfig } from "@playwright/test";
export default defineConfig({
  testDir: "./tests",
  workers: 1,
  reporter: "list",
  use: {
    baseURL: process.env.CUSTOMER_PREVIEW_URL || "http://127.0.0.1:5174",
    channel: "chrome",
    headless: true,
    viewport: { width: 1440, height: 1000 },
  },
});
