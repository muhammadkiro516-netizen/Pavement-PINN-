// Restored screens per role, for comparing with pitchdeck-visuals/screenshots_mentah.
// Usage: node e2e-v5/restore-shots-roles.mjs <baseUrl> <outDir>
import fs from 'node:fs';
import { chromium } from 'playwright-core';

const [base, out] = process.argv.slice(2);
fs.mkdirSync(out, { recursive: true });
const browser = await chromium.launch();
const options = { viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true, geolocation: { latitude: -6.2006, longitude: 106.8574 }, permissions: ['geolocation'] };
const errors = [];

async function shot(page, name) {
  await page.waitForTimeout(3500);
  await page.screenshot({ path: `${out}/${name}.png` });
  console.log(name, '->', new URL(page.url()).pathname, '|', (await page.locator('body').innerText()).replace(/\s+/g, ' ').slice(0, 130));
}

// Citizens enter through the anonymous session the landing page starts.
const citizenContext = await browser.newContext(options);
const citizen = await citizenContext.newPage();
citizen.on('pageerror', (e) => errors.push(e.message));
const anon = await citizenContext.request.post(`${base}/api/auth/anonymous`, { data: {} });
console.log('citizen session', anon.status());
await citizen.goto(`${base}/peta/`);
await shot(citizen, 'warga-peta');
await citizen.goto(`${base}/laporanku/`);
await shot(citizen, 'warga-kawal');

const staff = [
  ['koordinator-antrian', 'ops.hendra', 'OpsPinn2026!', '/antrian/'],
  ['petugas-tugas', 'field.ahmad', 'FieldPinn2026!', '/tugas/'],
  ['petugas-analisis', 'field.ahmad', 'FieldPinn2026!', '/analisis/']
];
for (const [name, username, password, path] of staff) {
  const context = await browser.newContext(options);
  const page = await context.newPage();
  page.on('pageerror', (e) => errors.push(e.message));
  const login = await context.request.post(`${base}/api/auth/login`, { data: { username, password } });
  console.log(name, 'login', login.status());
  await page.goto(base + path);
  await shot(page, name);
}
console.log('page errors:', errors.length, errors.slice(0, 3));
await browser.close();
