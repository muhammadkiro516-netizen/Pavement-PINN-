// Screenshots of the restored original UI on a phone viewport, for comparing with
// pitchdeck-visuals/screenshots_mentah. Usage: node e2e-v5/restore-shots.mjs <baseUrl> <outDir>
import fs from 'node:fs';
import { chromium } from 'playwright-core';

const [base = 'http://localhost:3100', out = 'test-results/restore'] = process.argv.slice(2);
fs.mkdirSync(out, { recursive: true });
const browser = await chromium.launch();
const context = await browser.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true, geolocation: { latitude: -6.2006, longitude: 106.8574 }, permissions: ['geolocation'] });
const page = await context.newPage();
const errors = [];
page.on('pageerror', (e) => errors.push(e.message));

for (const [name, path] of [['beranda', '/beranda/'], ['root', '/'], ['peta', '/peta/'], ['login', '/login/'], ['bukti', '/bukti/']]) {
  await page.goto(base + path, { waitUntil: 'load' });
  await page.waitForTimeout(3500);
  await page.screenshot({ path: `${out}/${name}.png` });
  console.log(name, '->', new URL(page.url()).pathname, '|', (await page.locator('body').innerText()).replace(/\s+/g, ' ').slice(0, 110));
}
console.log('page errors:', errors.length, errors.slice(0, 3));
await browser.close();
