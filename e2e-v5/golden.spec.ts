import fs from 'node:fs';
import { expect, test, type Browser, type BrowserContext, type Page } from '@playwright/test';

/**
 * Golden path: a citizen reports on the original screen with the live camera, then every role signs in
 * with its own account through the real form. The test only replaces the camera's picture, so each
 * photo is a different scene: the server refuses reused photos. The code path is getUserMedia as in use.
 */
const DATA = process.env.V5_DATA_DIR ?? '.data/v5-live';
const LOGINS: { accountId: string; email: string; password: string }[] = JSON.parse(fs.readFileSync(`${DATA}/staff-logins.json`, 'utf8'));
const SHOTS = 'test-results/screens';
const AT = { latitude: -6.2006, longitude: 106.8574, accuracy: 8 };

const id = (page: Page, testId: string) => page.getByTestId(testId);

async function liveCamera(context: BrowserContext) {
  await context.addInitScript(() => {
    let scene = Math.floor(Math.random() * 1e6);
    navigator.mediaDevices.getUserMedia = async () => {
      scene += 1;
      const canvas = document.createElement('canvas');
      canvas.width = 800;
      canvas.height = 600;
      const g = canvas.getContext('2d')!;
      let seed = scene * 2654435761;
      const next = () => { seed = (seed * 48271) % 2147483647; return seed / 2147483647; };
      const paint = () => { for (let y = 0; y < 12; y++) for (let x = 0; x < 16; x++) { const v = Math.floor(next() * 255); g.fillStyle = `rgb(${v},${v},${v})`; g.fillRect(x * 50, y * 50, 50, 50); } };
      paint();
      const stream = canvas.captureStream(5);
      setInterval(() => { const v = g.getImageData(0, 0, 1, 1); g.putImageData(v, 0, 0); }, 200);
      return stream;
    };
    localStorage.setItem('pp-onboarded', '1');
    localStorage.setItem('pp-map-coach', '1');
  });
}

async function staffPage(browser: Browser, accountId: string): Promise<{ page: Page; close: () => Promise<void> }> {
  const context = await browser.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true, geolocation: AT, permissions: ['geolocation', 'camera'], baseURL: process.env.V5_BASE_URL ?? 'http://localhost:3100' });
  await liveCamera(context);
  const page = await context.newPage();
  const login = LOGINS.find((l) => l.accountId === accountId)!;
  await page.goto('/login/');
  await page.locator('input[type=email]').fill(login.email);
  await page.locator('input[type=password]').fill(login.password);
  await page.locator('button[type=submit]').click();
  await page.waitForURL(/kerja/);
  await expect(id(page, 'v5-role-name')).toBeVisible();
  return { page, close: () => context.close() };
}

async function openCase(page: Page, code: string) {
  await id(page, `v5-open-${code}`).click();
  await expect(id(page, 'v5-case-head')).toBeVisible();
}

async function shoot(page: Page) {
  await expect(id(page, 'v5-shutter')).toBeEnabled();
  await id(page, 'v5-shutter').click();
}

test('golden path: report, route, assign, measure, approve, repair, supervise, confirm, audit, verify', async ({ browser, context, page }) => {
  test.setTimeout(420_000);
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await liveCamera(context);

  // Citizen, no login, on the original screens.
  await page.goto('/beranda/');
  await page.getByRole('button', { name: 'Laporkan jalan rusak' }).first().click();
  await page.waitForURL(/peta/);
  await id(page, 'report-open-camera').click();
  await expect(page.locator('input[type=file]')).toHaveCount(0);
  await page.screenshot({ path: `${SHOTS}/warga-1-kamera.png` });
  await expect(page.getByRole('button', { name: /ambil foto|potret/i }).first()).toBeVisible();
  await page.getByRole('button', { name: /ambil foto|potret/i }).first().click();
  await page.getByRole('button', { name: /gunakan|lanjut|pakai foto/i }).first().click({ timeout: 15_000 }).catch(() => undefined);
  await expect(id(page, 'road-owner')).toBeVisible({ timeout: 90_000 });
  await expect(id(page, 'road-owner-office')).toContainText('Bina Marga');
  await page.screenshot({ path: `${SHOTS}/warga-2-hasil-ai.png`, fullPage: true });
  await page.getByRole('radio', { name: 'Sedang' }).or(page.getByRole('button', { name: 'Sedang' })).first().click();
  await page.getByRole('button', { name: 'Kirim laporan' }).click();
  await expect(id(page, 'report-code')).toBeVisible({ timeout: 60_000 });
  const code = (await id(page, 'report-code').innerText()).trim();
  expect(code).toMatch(/^JKT-/);
  await page.screenshot({ path: `${SHOTS}/warga-3-terkirim.png` });

  // Coordinator.
  {
    const { page: p, close } = await staffPage(browser, 'ACC-COORD');
    await expect(p.locator(`li[data-code="${code}"]`).getByTestId('v5-priority-reasons')).toBeVisible();
    await p.screenshot({ path: `${SHOTS}/koordinator-1-antrian.png` });
    await openCase(p, code);
    await id(p, 'v5-reason').fill('Foto menunjukkan lubang di jalan ini.');
    await p.screenshot({ path: `${SHOTS}/koordinator-2-kasus.png` });
    await id(p, 'v5-accept-assign').click();
    await expect(id(p, 'v5-state-label')).toHaveText('Inspeksi dijadwalkan');
    await close();
  }

  // Inspector.
  const inspector = await staffPage(browser, 'ACC-INSPECT');
  {
    const p = inspector.page;
    await openCase(p, code);
    for (const title of ['1. Foto keseluruhan', '2. Kartu penanda', '3. Penggaris di titik terdalam']) {
      await expect(id(p, 'v5-capture')).toContainText(title);
      await shoot(p);
    }
    await id(p, 'v5-length').fill('80');
    await id(p, 'v5-width').fill('60');
    await id(p, 'v5-depth').fill('45');
    await p.screenshot({ path: `${SHOTS}/petugas-1-ukur.png`, fullPage: true });
    await id(p, 'v5-submit-inspection').click();
    await expect(id(p, 'v5-state-label')).toHaveText('Inspeksi selesai');
  }
  {
    const { page: p, close } = await staffPage(browser, 'ACC-COORD');
    await openCase(p, code);
    await id(p, 'v5-reason').fill('Ukuran dan foto sudah lengkap.');
    await id(p, 'v5-verify-inspection').click();
    await expect(id(p, 'v5-state-label')).toHaveText('Hasil inspeksi diperiksa');
    await close();
  }
  {
    const p = inspector.page;
    await p.reload();
    await id(p, 'v5-esal').fill('250000');
    await id(p, 'v5-run-pinn').click();
    await expect(id(p, 'v5-pinn-range')).toContainText('bulan');
    await expect(id(p, 'v5-pinn-range')).not.toContainText('P10');
    await id(p, 'v5-run-cost').click();
    await expect(id(p, 'v5-cost-range')).toContainText('Rp');
    await p.screenshot({ path: `${SHOTS}/petugas-2-umur-biaya.png`, fullPage: true });
    // Technical words appear only after opening the toggle.
    await expect(p.getByText(/P10.P90/)).toBeHidden();
    for (const summary of await p.locator('summary', { hasText: 'Detail teknis' }).all()) await summary.click();
    await expect(p.getByText(/P10.P90/)).toBeVisible();
    await p.screenshot({ path: `${SHOTS}/petugas-3-detail-teknis.png`, fullPage: true });
    await id(p, 'v5-rationale').fill('Lubang di jalur roda. Tambal sampai dasar.');
    await id(p, 'v5-propose-plan').click();
    await expect(id(p, 'v5-state-label')).toHaveText('Usulan penanganan disusun');
    await inspector.close();
  }

  // The same person cannot approve their own plan.
  {
    const { page: p, close } = await staffPage(browser, 'ACC-INSPECT-AS-APPROVER');
    await openCase(p, code);
    await id(p, 'v5-reason').fill('Biaya dan ukuran sudah sesuai.');
    await id(p, 'v5-approve').click();
    await expect(id(p, 'v5-error')).toHaveAttribute('data-rule', 'SOD-2');
    await p.screenshot({ path: `${SHOTS}/penyetuju-2-ditolak.png` });
    await close();
  }
  {
    const { page: p, close } = await staffPage(browser, 'ACC-APPROVE');
    await openCase(p, code);
    await id(p, 'v5-reason').fill('Biaya dan ukuran sudah sesuai.');
    await p.screenshot({ path: `${SHOTS}/penyetuju-1-setujui.png`, fullPage: true });
    await id(p, 'v5-approve').click();
    await expect(id(p, 'v5-state-label')).toHaveText('Penanganan disetujui');
    await close();
  }
  {
    const { page: p, close } = await staffPage(browser, 'ACC-COORD');
    await openCase(p, code);
    await id(p, 'v5-issue-work-order').click();
    await expect(id(p, 'v5-state-label')).toHaveText('Pekerjaan dijadwalkan');
    await close();
  }

  // Crew.
  {
    const { page: p, close } = await staffPage(browser, 'ACC-CREW');
    await openCase(p, code);
    const stage = async (name: string, values: Record<string, string> = {}) => {
      await id(p, `v5-stage-${name}`).click();
      for (const [k, v] of Object.entries(values)) await id(p, `v5-value-${k}`).fill(v);
      await shoot(p);
      await expect(p.locator(`li[data-stage="${name}"]`)).toHaveAttribute('data-done', 'true');
    };
    await stage('BEFORE');
    await stage('CUT_EDGES', { cutLengthCm: '140', cutWidthCm: '120' });
    await id(p, 'v5-start-work').click();
    await expect(id(p, 'v5-state-label')).toHaveText('Sedang diperbaiki');
    await stage('CLEAN_DRY');
    await stage('TACK_COAT', { material: 'CSS-1' });
    await stage('DELIVERY_TICKET', { mixType: 'AC-WC', weightKg: '300' });
    await stage('MIX_TEMP_TRUCK', { temperatureC: '142' });
    await stage('MIX_TEMP_MAT', { temperatureC: '128' });
    await stage('LOOSE_THICKNESS', { thicknessMm: '55' });
    await stage('COMPACTION', { passes: '6' });
    await stage('AFTER');
    await id(p, 'v5-tonnage').fill('300');
    await id(p, 'v5-spend').fill('1200000');
    await p.screenshot({ path: `${SHOTS}/regu-1-daftar-bukti.png`, fullPage: true });
    await id(p, 'v5-submit-work').click();
    await expect(id(p, 'v5-state-label')).toHaveText('Menunggu pemeriksaan hasil');
    await close();
  }

  // Supervisor, then approver.
  {
    const { page: p, close } = await staffPage(browser, 'ACC-SUPERVISE');
    await openCase(p, code);
    await shoot(p);
    await expect(id(p, 'v5-own-photo')).toBeVisible();
    await p.screenshot({ path: `${SHOTS}/pengawas-1-periksa.png`, fullPage: true });
    await id(p, 'v5-verify-work').click();
    await expect(id(p, 'v5-state-label')).toHaveText('Hasil diperiksa pengawas');
    await close();
  }
  {
    const { page: p, close } = await staffPage(browser, 'ACC-APPROVE');
    await openCase(p, code);
    await id(p, 'v5-reason').fill('Pengawas sudah memeriksa semua tahap.');
    await id(p, 'v5-accept-work').click();
    await expect(id(p, 'v5-state-label')).toHaveText('Diperbaiki — dipantau');
    await close();
  }

  // The same citizen: Kawal, public timeline, confirmation.
  await page.goto('/laporanku/');
  await expect(page.locator(`[data-testid=my-report][data-code="${code}"]`)).toBeVisible();
  await page.screenshot({ path: `${SHOTS}/warga-4-kawal.png` });
  await page.goto(`/pantau/${code}/`);
  await expect(id(page, 'v5-state-label')).toHaveText('Diperbaiki — dipantau');
  for (const m of ['M1', 'M3', 'M6', 'HEAVY_RAIN']) await expect(page.locator(`li[data-milestone="${m}"]`)).toBeVisible();
  await id(page, 'v5-still-fixed').click();
  await expect(id(page, 'v5-confirm')).toContainText('Masih bagus: 1');
  await page.screenshot({ path: `${SHOTS}/warga-5-perjalanan.png`, fullPage: true });
  await expect(page.locator('body')).not.toContainText('ACC-');

  // Map pin from the real store.
  await page.goto('/peta/');
  await expect(page.locator('img[src*="/api/v5/evidence/"]').first()).toBeVisible();

  // The Aman tab reads the same real cases.
  await page.goto('/aman/');
  await expect(page.getByText('Rute aman dan area yang Anda pantau.')).toBeVisible();
  await expect(page.getByText('Belum ada laporan')).toHaveCount(0);
  await page.waitForTimeout(4000); // the opening animation
  await page.screenshot({ path: `${SHOTS}/warga-8-aman.png`, fullPage: true });

  // Auditor: PDF, verify, tamper.
  let docId = '';
  {
    const { page: p, close } = await staffPage(browser, 'ACC-AUDIT');
    await openCase(p, code);
    await expect(id(p, 'v5-chain-status')).toContainText('Utuh');
    await id(p, 'v5-issue-report').click();
    await expect(id(p, 'v5-doc-id')).toContainText(`DOC-${code}-v1`);
    docId = (await id(p, 'v5-doc-id').innerText()).trim();
    const sha = (await id(p, 'v5-doc-hash').innerText()).trim();
    await p.screenshot({ path: `${SHOTS}/auditor-1-laporan.png`, fullPage: true });
    const bytes = await (await p.request.get(`/api/v5/documents/${docId}/pdf`)).body();
    expect(bytes.subarray(0, 5).toString()).toBe('%PDF-');
    await p.goto(`/v/${docId}/`);
    await expect(id(p, 'v5-verify-summary')).toContainText('asli dan tidak berubah');
    await expect(id(p, 'v5-verify-hash')).toHaveText(sha);
    await id(p, 'v5-verify-file-input').setInputFiles({ name: 'laporan.pdf', mimeType: 'application/pdf', buffer: bytes });
    await expect(id(p, 'v5-file-result')).toContainText('sama dengan laporan');
    const altered = Buffer.from(bytes);
    altered[altered.length - 20] ^= 1;
    await id(p, 'v5-verify-file-input').setInputFiles({ name: 'diubah.pdf', mimeType: 'application/pdf', buffer: altered });
    await expect(id(p, 'v5-file-result')).toContainText('berbeda dari laporan');
    await p.screenshot({ path: `${SHOTS}/auditor-2-verifikasi.png`, fullPage: true });

    // One changed byte in the stored log makes verification fail; restored right after.
    const log = `${DATA}/v5/events-prod.jsonl`;
    const original = fs.readFileSync(log, 'utf8');
    try {
      fs.writeFileSync(log, original.replace('"type":"case.accepted"', '"type":"case.acceptEd"'));
      await p.reload();
      await expect(id(p, 'v5-verify-summary')).toContainText('Pemeriksaan gagal');
    } finally {
      fs.writeFileSync(log, original);
    }
    await p.reload();
    await expect(id(p, 'v5-verify-summary')).toContainText('asli dan tidak berubah');
    await close();
  }

  expect(errors).toEqual([]);
});

test('Pimpinan and Admin open their own screens with their own accounts', async ({ browser }) => {
  const head = await staffPage(browser, 'ACC-HEAD');
  await expect(id(head.page, 'v5-head')).toContainText('Semua kasus');
  await head.page.screenshot({ path: `${SHOTS}/pimpinan-1-ringkasan.png` });
  await head.close();
  const admin = await staffPage(browser, 'ACC-ADMIN');
  await expect(id(admin.page, 'v5-admin')).toContainText('Peta jalan');
  await admin.page.screenshot({ path: `${SHOTS}/admin-1-data.png` });
  await admin.close();
});

test('a wrong password is refused, staff pages need a sign-in, and sign-out works', async ({ browser, page }) => {
  await page.goto('/kerja/');
  await page.waitForURL(/login/);
  await page.locator('input[type=email]').fill(LOGINS[0].email);
  await page.locator('input[type=password]').fill('salah-sandi');
  await page.locator('button[type=submit]').click();
  await expect(page.locator('body')).toContainText('Email atau kata sandi salah');
  const { page: p, close } = await staffPage(browser, 'ACC-COORD');
  await id(p, 'v5-sign-out').click();
  await p.waitForURL(/login/);
  await close();
});

test('road owner colours are really on the map', async ({ context, page }) => {
  await liveCamera(context);
  await page.goto('/beranda/');
  await page.getByRole('button', { name: 'Laporkan jalan rusak' }).first().click();
  await page.waitForURL(/peta/);
  await page.getByRole('button', { name: 'Tutup' }).first().click();
  await id(page, 'owners-toggle').click();
  await expect(id(page, 'owners-legend')).toContainText('Provinsi');
  await page.waitForTimeout(7000);
  const shot = await page.screenshot({ path: `${SHOTS}/warga-6-peta-pemilik-jalan.png` });
  const orange = await page.evaluate(async (b64) => {
    const img = new Image();
    img.src = `data:image/png;base64,${b64}`;
    await img.decode();
    const c = document.createElement('canvas');
    c.width = img.width;
    c.height = img.height;
    const g = c.getContext('2d')!;
    g.drawImage(img, 0, 0);
    const { data } = g.getImageData(0, Math.round(img.height * 0.32), img.width, Math.round(img.height * 0.36));
    let n = 0;
    for (let i = 0; i < data.length; i += 4) if (data[i] > 200 && data[i + 1] > 70 && data[i + 1] < 140 && data[i + 2] < 90) n++;
    return n;
  }, shot.toString('base64'));
  expect(orange).toBeGreaterThan(150);
});

test('long damage: walking grows the length from GPS, then the live camera opens', async ({ context, page }) => {
  await liveCamera(context);
  await page.goto('/beranda/');
  await page.getByRole('button', { name: 'Laporkan jalan rusak' }).first().click();
  await page.waitForURL(/peta/);
  await id(page, 'long-damage-open-input').click();
  await expect(id(page, 'long-walk-start')).toBeEnabled({ timeout: 20_000 });
  await id(page, 'long-walk-start').click();
  for (let i = 1; i <= 5; i++) {
    await context.setGeolocation({ latitude: -6.2006 + i * 0.00004, longitude: 106.8574, accuracy: 6 });
    await page.waitForTimeout(700);
  }
  await expect(id(page, 'long-walk-length')).not.toHaveText('0 m');
  await page.screenshot({ path: `${SHOTS}/warga-7-kerusakan-panjang.png` });
  await expect(id(page, 'long-walk-end')).toBeEnabled({ timeout: 10_000 });
  await id(page, 'long-walk-end').click();
  await expect(page.locator('video').first()).toBeVisible({ timeout: 20_000 });
  await context.setGeolocation({ latitude: -6.2006, longitude: 106.8574, accuracy: 8 });
});

test('tour and why are public, and every fact names a source', async ({ page }) => {
  await page.goto('/tour/');
  await expect(id(page, 'v5-tour')).toBeVisible();
  await page.screenshot({ path: `${SHOTS}/publik-1-tur.png` });
  for (let i = 0; i < 5; i++) await id(page, 'v5-tour-next').click();
  await expect(id(page, 'v5-tour-end')).toBeVisible();
  await page.goto('/why/');
  await expect(id(page, 'v5-fact').first()).toBeVisible();
  expect(await id(page, 'v5-fact').count()).toBeGreaterThan(10);
  for (const fact of await id(page, 'v5-fact').all()) await expect(fact).toContainText('Sumber:');
  await page.screenshot({ path: `${SHOTS}/publik-2-kenapa.png` });
});

test('no sample photos or demo labels are served', async ({ page, request }) => {
  for (const path of ['photos/surabaya.jpg', 'test-fixtures/test-after.jpg', 'dataset-reference/rdd2022/D00/Czech_000054.jpg']) {
    const res = await request.get(path);
    expect(res.headers()['content-type'] ?? '', path).not.toContain('image/');
  }
  const seen: string[] = [];
  page.on('request', (r) => { if (/\/(photos|test-fixtures|dataset-reference)\/|unsplash/.test(r.url())) seen.push(r.url()); });
  await page.goto('beranda/');
  await expect(page.getByText('9 peran')).toBeVisible();
  await expect(page.getByText(/Wikimedia|DATA DEMO|DATA CONTOH/)).toHaveCount(0);
  await page.waitForTimeout(4000); // the opening animation
  await page.screenshot({ path: 'test-results/screens/beranda.png' });
  await page.goto('lacak/TIDAK-ADA/');
  await expect(page.getByText(/DATA CONTOH/)).toHaveCount(0);
  expect(seen).toEqual([]);
});
