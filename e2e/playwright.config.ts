import { defineConfig } from 'playwright/test';

import { E2E_PREVIEW_HOST, E2E_PREVIEW_PORT, E2E_PREVIEW_URL, E2E_VIEWPORT } from './constants/testEnv';

export default defineConfig({
  testDir: './tests',
  outputDir: '../test-results/playwright',
  workers: 1,
  fullyParallel: false,
  timeout: 120_000,
  expect: {
    timeout: 15_000,
  },
  use: {
    baseURL: E2E_PREVIEW_URL,
    viewport: E2E_VIEWPORT,
    headless: process.env.CI === 'true',
    screenshot: 'only-on-failure',
    trace: 'retain-on-failure',
  },
  webServer: {
    command: `npm run build && npm run preview -- --host ${E2E_PREVIEW_HOST} --port ${E2E_PREVIEW_PORT}`,
    url: E2E_PREVIEW_URL,
    reuseExistingServer: false,
    timeout: 180_000,
  },
  reporter: [['list']],
});
