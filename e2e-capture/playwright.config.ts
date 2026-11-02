import { defineConfig } from '@playwright/test';

/** Records the product footage against a separate server on its own data folder. Not part of the test suites. */
export default defineConfig({
  testDir: '.',
  timeout: 2_400_000,
  workers: 1,
  reporter: 'line',
  outputDir: '../.data/capture/pw',
  expect: { timeout: 60_000 },
  use: {
    baseURL: 'http://localhost:3200',
    actionTimeout: 60_000,
    launchOptions: { slowMo: 200, args: ['--use-fake-ui-for-media-stream', '--use-fake-device-for-media-stream', '--ignore-gpu-blocklist', '--use-gl=angle'] }
  }
});
