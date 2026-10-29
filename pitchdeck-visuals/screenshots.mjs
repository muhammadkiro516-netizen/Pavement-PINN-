// Real screenshots of the running app (http://127.0.0.1:3100), phone size + desktop.
// node pitchdeck-visuals/screenshots.mjs
import { chromium } from 'playwright';
import { mkdirSync } from 'node:fs';

const BASE = 'http://127.0.0.1:3100';
const OUT = 'pitchdeck-visuals/17_screenshot_aplikasi';
mkdirSync(OUT, { recursive: true });
const JAKARTA = { latitude: -6.2253, longitude: 106.8995 };

const browser = await chromium.launch();
async function shoot(name, path, { login, width = 390, height = 844, wait = 3500 } = {}) {
  const ctx = await browser.newContext({ viewport: { width, height }, deviceScaleFactor: 2, geolocation: JAKARTA, permissions: ['geolocation'], colorScheme: 'dark' });
  const page = await ctx.newPage();
  if (login) {
    const r = await page.request.post(`${BASE}/api/auth/login`, { data: login });
    if (!r.ok()) console.log('login failed', name, r.status());
    await page.addInitScript(() => {
      try { localStorage.setItem('pp-map-coach', '1'); } catch {}
    });
  }
  await page.goto(`${BASE}${path}`, { waitUntil: 'networkidle' }).catch(() => undefined);
  await page.waitForTimeout(wait);
  await page.screenshot({ path: `${OUT}/${name}.png` });
  console.log('wrote', name);
  await ctx.close();
}

// Credentials from the environment (never commit them): PP_KOOR=email:pass PP_PETUGAS=email:pass
const cred = (v) => { const [email, ...p] = String(process.env[v] ?? '').split(':'); return { email, password: p.join(':') }; };
const KOOR = cred('PP_KOOR');
const PETUGAS = cred('PP_PETUGAS');
await shoot('01_beranda_hp', '/beranda/', { wait: 4500 });
await shoot('02_beranda_desktop', '/beranda/', { width: 1440, height: 900, wait: 4500 });
await shoot('03_login_hp', '/login/');
await shoot('04_peta_petugas_hp', '/peta/', { login: PETUGAS, wait: 6000 });
await shoot('05_tugas_petugas_hp', '/tugas/', { login: PETUGAS });
await shoot('06_antrian_koordinator_desktop', '/antrian/', { login: KOOR, width: 1440, height: 900 });
await shoot('07_statistik_koordinator_desktop', '/statistik/', { login: KOOR, width: 1440, height: 900 });
await shoot('08_analisis_pinn_desktop', '/analisis/', { login: KOOR, width: 1440, height: 900 });
await shoot('09_bukti_transparansi_desktop', '/bukti/', { width: 1440, height: 900 });
await shoot('10_peta_koordinator_desktop', '/peta/', { login: KOOR, width: 1440, height: 900, wait: 6000 });
await browser.close();
