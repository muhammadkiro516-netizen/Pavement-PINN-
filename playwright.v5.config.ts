/**
 * Golden path with real accounts and the live camera path (phone viewport, mocked GPS).
 * Local:  npx playwright test -c playwright.v5.config.ts   (needs the server on port 3100)
 * HTTPS:  V5_BASE_URL=https://....trycloudflare.com npx playwright test -c playwright.v5.config.ts
 */
import { defineConfig } from '@playwright/test';

export default defineConfig({
  testDir: 'e2e-v5',
  timeout: 240_000,
  expect: { timeout: 45_000 },
  fullyParallel: false,
  workers: 1,
  reporter: [['list']],
  use: {
    baseURL: process.env.V5_BASE_URL ?? 'http://localhost:3100',
    viewport: { width: 390, height: 844 },
    isMobile: true,
    hasTouch: true,
    geolocation: { latitude: -6.2006, longitude: 106.8574, accuracy: 8 },
    permissions: ['geolocation', 'camera'],
    screenshot: 'only-on-failure',
    actionTimeout: 45_000,
    launchOptions: { args: ['--use-fake-device-for-media-stream', '--use-fake-ui-for-media-stream'] }
  }
});
