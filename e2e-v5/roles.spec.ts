import { expect, test, type APIRequestContext, type Page } from '@playwright/test';

/**
 * Golden path through the role workspaces, on a phone: report, route, assign, measure, life range and
 * fair cost, approval with the SoD block, repair evidence, supervisor, public timeline, audit PDF, verify.
 */
const id = (page: Page, testId: string) => page.getByTestId(testId);
const SHOTS = 'test-results/restore/roles';

async function asRole(page: Page, accountId: string) {
  await id(page, 'v5-role-switch').selectOption(accountId);
  await expect(id(page, 'v5-role-switch')).toHaveValue(accountId);
}

async function openCase(page: Page, code: string) {
  await page.goto('/peran/');
  await id(page, `v5-open-${code}`).click();
  await expect(id(page, 'v5-case-head')).toBeVisible();
}

const sample = (page: Page) => id(page, 'v5-use-sample').click();

/** A citizen report through the v5 API. The original report screen joins this store in Prompt 3. */
async function newCase(request: APIRequestContext): Promise<string> {
  const headers = (token: string) => ({ 'x-v5-session': token });
  const { data: { token } } = await (await request.post('/api/v5/session/device', { data: {} })).json();
  const { data: { nonce } } = await (await request.post('/api/v5/capture/nonce', { headers: headers(token), data: { purpose: 'REPORT' } })).json();
  const gps = { lat: -6.2006, lon: 106.8574, accuracyM: 8, speedMps: 0 };
  const { data: evidence } = await (await request.post('/api/v5/evidence', { headers: headers(token), data: { nonce, sampleId: 'pothole', kind: 'OVERVIEW', gps, motionSamples: 1 } })).json();
  const { data } = await (await request.post('/api/v5/cases', { headers: headers(token), data: { mode: 'SINGLE', evidenceIds: [evidence.id], lat: gps.lat, lon: gps.lon, accuracyM: 8, sizeBand: 'M', classGuess: 'POTHOLE' } })).json();
  return data.publicCode as string;
}

test('golden path on the original look, in everyday words', async ({ page, request }) => {
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));
  const code = await newCase(request);
  expect(code).toMatch(/^JKT-/);

  await page.goto('/peran/');
  await expect(id(page, 'v5-roles')).toContainText('Koordinator Pemeliharaan');
  await page.waitForTimeout(2500); // The app's own splash plays first.
  await page.screenshot({ path: `${SHOTS}/peran.png` });

  // Coordinator: priority with reasons, then assign.
  await asRole(page, 'ACC-COORD');
  await expect(page.locator(`li[data-code="${code}"]`).getByTestId('v5-priority-reasons')).toContainText('Lubang');
  await page.screenshot({ path: `${SHOTS}/koordinator-antrian.png` });
  await id(page, `v5-open-${code}`).click();
  await id(page, 'v5-reason').fill('Foto menunjukkan lubang di jalan ini.');
  await page.screenshot({ path: `${SHOTS}/koordinator-kasus.png` });
  await id(page, 'v5-accept-assign').click();
  await expect(id(page, 'v5-state-label')).toHaveText('Inspeksi dijadwalkan');

  // Inspector: overview, marker card, ruler; size and depth.
  await asRole(page, 'ACC-INSPECT');
  await openCase(page, code);
  for (const title of ['1. Foto keseluruhan', '2. Kartu penanda', '3. Penggaris di titik terdalam']) {
    await expect(id(page, 'v5-capture')).toContainText(title);
    await sample(page);
  }
  await expect(id(page, 'v5-marker-found')).toHaveText('terdeteksi');
  await id(page, 'v5-length').fill('80');
  await id(page, 'v5-width').fill('60');
  await id(page, 'v5-depth').fill('45');
  await page.screenshot({ path: `${SHOTS}/petugas-ukur.png` });
  await id(page, 'v5-submit-inspection').click();
  await expect(id(page, 'v5-state-label')).toHaveText('Inspeksi selesai');
  await expect(id(page, 'v5-measurements')).toContainText('45 mm');

  await asRole(page, 'ACC-COORD');
  await openCase(page, code);
  await id(page, 'v5-reason').fill('Ukuran dan foto sudah lengkap.');
  await id(page, 'v5-verify-inspection').click();
  await expect(id(page, 'v5-state-label')).toHaveText('Hasil inspeksi diperiksa');

  // Life range and fair cost, with no technical words on the main view.
  await asRole(page, 'ACC-INSPECT');
  await openCase(page, code);
  await id(page, 'v5-esal').fill('250000');
  await id(page, 'v5-run-pinn').click();
  await expect(id(page, 'v5-pinn-range')).toContainText('bulan');
  await expect(id(page, 'v5-pinn-range')).not.toContainText('P10');
  await id(page, 'v5-run-cost').click();
  await expect(id(page, 'v5-cost-range')).toContainText('Rp');
  await expect(id(page, 'v5-cost').locator('> p').first()).not.toContainText('AHSP');
  await page.screenshot({ path: `${SHOTS}/petugas-umur-biaya.png`, fullPage: true });
  await id(page, 'v5-rationale').fill('Lubang di jalur roda. Tambal sampai dasar.');
  await id(page, 'v5-propose-plan').click();
  await expect(id(page, 'v5-state-label')).toHaveText('Usulan penanganan disusun');

  // The server blocks approval by the person who recommended the plan.
  await asRole(page, 'ACC-INSPECT-AS-APPROVER');
  await openCase(page, code);
  await id(page, 'v5-reason').fill('Biaya dan ukuran sudah sesuai.');
  await id(page, 'v5-approve').click();
  await expect(id(page, 'v5-error')).toContainText('tidak boleh menyetujuinya');
  await expect(id(page, 'v5-error')).toHaveAttribute('data-rule', 'SOD-2');
  await page.screenshot({ path: `${SHOTS}/penyetuju-ditolak.png` });
  await expect(id(page, 'v5-state-label')).toHaveText('Usulan penanganan disusun');

  await asRole(page, 'ACC-APPROVE');
  await openCase(page, code);
  await id(page, 'v5-reason').fill('Biaya dan ukuran sudah sesuai.');
  await id(page, 'v5-approve').click();
  await expect(id(page, 'v5-state-label')).toHaveText('Penanganan disetujui');

  await asRole(page, 'ACC-COORD');
  await openCase(page, code);
  await id(page, 'v5-issue-work-order').click();
  await expect(id(page, 'v5-state-label')).toHaveText('Pekerjaan dijadwalkan');

  // Crew: the evidence checklist.
  await asRole(page, 'ACC-CREW');
  await openCase(page, code);
  const stage = async (name: string, values: Record<string, string> = {}) => {
    await id(page, `v5-stage-${name}`).click();
    for (const [k, v] of Object.entries(values)) await id(page, `v5-value-${k}`).fill(v);
    await sample(page);
    await expect(page.locator(`li[data-stage="${name}"]`)).toHaveAttribute('data-done', 'true');
  };
  await stage('BEFORE');
  await stage('CUT_EDGES', { cutLengthCm: '140', cutWidthCm: '120' });
  await id(page, 'v5-start-work').click();
  await expect(id(page, 'v5-state-label')).toHaveText('Sedang diperbaiki');
  await stage('CLEAN_DRY');
  await stage('TACK_COAT', { material: 'CSS-1' });
  await stage('DELIVERY_TICKET', { mixType: 'AC-WC', weightKg: '300' });
  await stage('MIX_TEMP_TRUCK', { temperatureC: '142' });
  await stage('MIX_TEMP_MAT', { temperatureC: '128' });
  await stage('LOOSE_THICKNESS', { thicknessMm: '55' });
  await stage('COMPACTION', { passes: '6' });
  await stage('AFTER');
  await id(page, 'v5-tonnage').fill('300');
  await id(page, 'v5-spend').fill('1200000');
  await page.screenshot({ path: `${SHOTS}/regu-daftar-bukti.png` });
  await id(page, 'v5-submit-work').click();
  await expect(id(page, 'v5-state-label')).toHaveText('Menunggu pemeriksaan hasil');

  // Supervisor, then approver: repaired, under watch.
  await asRole(page, 'ACC-SUPERVISE');
  await openCase(page, code);
  await sample(page);
  await expect(id(page, 'v5-own-photo')).toBeVisible();
  await page.screenshot({ path: `${SHOTS}/pengawas.png` });
  await id(page, 'v5-verify-work').click();
  await expect(id(page, 'v5-state-label')).toHaveText('Hasil diperiksa pengawas');

  await asRole(page, 'ACC-APPROVE');
  await openCase(page, code);
  await id(page, 'v5-reason').fill('Pengawas sudah memeriksa semua tahap.');
  await id(page, 'v5-accept-work').click();
  await expect(id(page, 'v5-state-label')).toHaveText('Diperbaiki — dipantau');

  // Citizen: public timeline, follow-ups, confirmation.
  await asRole(page, 'CITIZEN');
  await page.goto(`/pantau/${code}/`);
  await expect(id(page, 'v5-state-label')).toHaveText('Diperbaiki — dipantau');
  for (const step of ['Laporan warga diterima', 'Diterima instansi', 'Rencana disetujui', 'Perbaikan diterima, mulai dipantau']) await expect(id(page, 'v5-timeline')).toContainText(step);
  for (const m of ['M1', 'M3', 'M6', 'HEAVY_RAIN']) await expect(page.locator(`li[data-milestone="${m}"]`)).toBeVisible();
  await id(page, 'v5-still-fixed').click();
  await expect(id(page, 'v5-confirm')).toContainText('Masih bagus: 1');
  await page.screenshot({ path: `${SHOTS}/warga-perjalanan.png`, fullPage: true });

  // Auditor: PDF, verify, tamper check.
  await asRole(page, 'ACC-AUDIT');
  await openCase(page, code);
  await expect(id(page, 'v5-chain-status')).toContainText('Utuh');
  await id(page, 'v5-tamper').click();
  await expect(id(page, 'v5-tamper-result')).toContainText('pemeriksaan gagal');
  await id(page, 'v5-issue-report').click();
  await expect(id(page, 'v5-doc-id')).toContainText(`DOC-${code}-v1`);
  await page.screenshot({ path: `${SHOTS}/auditor.png` });
  const sha = (await id(page, 'v5-doc-hash').innerText()).trim();
  const docId = (await id(page, 'v5-doc-id').innerText()).trim();
  const bytes = await (await request.get(`/api/v5/documents/${docId}/pdf`)).body();
  expect(bytes.subarray(0, 5).toString()).toBe('%PDF-');
  await page.goto(`/v/${docId}/`);
  await expect(id(page, 'v5-verify-summary')).toContainText('asli dan tidak berubah');
  await expect(id(page, 'v5-verify-hash')).toHaveText(sha);
  await id(page, 'v5-verify-file-input').setInputFiles({ name: 'laporan.pdf', mimeType: 'application/pdf', buffer: bytes });
  await expect(id(page, 'v5-file-result')).toContainText('sama dengan laporan');
  const altered = Buffer.from(bytes);
  altered[altered.length - 20] ^= 1;
  await id(page, 'v5-verify-file-input').setInputFiles({ name: 'diubah.pdf', mimeType: 'application/pdf', buffer: altered });
  await expect(id(page, 'v5-file-result')).toContainText('berbeda dari laporan');
  await page.screenshot({ path: `${SHOTS}/verifikasi.png`, fullPage: true });

  expect(errors).toEqual([]);
});

test('escalation days become visible; a transfer must cite the decree and a second person confirms', async ({ page, request }) => {
  const code = await newCase(request);
  await page.goto(`/pantau/${code}/`);
  const reached = () => page.locator('.v5-ladder li[data-reached="true"]');
  await expect(reached()).toHaveCount(0);
  await id(page, 'v5-ff-2').click();
  await expect(reached()).toHaveCount(1);
  await id(page, 'v5-ff-7').click();
  await expect(reached()).toHaveCount(2);
  await id(page, 'v5-ff-7').click();
  await expect(reached()).toHaveCount(3);
  await id(page, 'v5-ff-30').click();
  await expect(reached()).toHaveCount(4);
  await expect(id(page, 'v5-complaint')).toBeVisible();
  await page.screenshot({ path: `${SHOTS}/warga-eskalasi.png`, fullPage: true });

  await page.goto('/peran/');
  await asRole(page, 'ACC-COORD');
  await openCase(page, code);
  await id(page, 'v5-transfer-toggle').click();
  await id(page, 'v5-reason').fill('Ruas ini ada di daftar jalan nasional.');
  await id(page, 'v5-transfer').click();
  await expect(id(page, 'v5-error')).toContainText('SK');
  await id(page, 'v5-decree-number').fill('Kepmen PUPR 1688/KPTS/M/2022');
  await id(page, 'v5-decree-date').fill('2022-12-30');
  await id(page, 'v5-transfer').click();
  await expect(id(page, 'v5-transfer-pending')).toContainText('BBPJN');
  await id(page, 'v5-reason').fill('Saya konfirmasi sendiri pengalihan ini.');
  await id(page, 'v5-confirm-transfer').click();
  await expect(id(page, 'v5-error')).toHaveAttribute('data-rule', 'SOD-7');
  await asRole(page, 'ACC-COORD-2');
  await openCase(page, code);
  await id(page, 'v5-reason').fill('SK mencantumkan ruas ini sebagai jalan nasional.');
  await id(page, 'v5-confirm-transfer').click();
  await expect(id(page, 'v5-case-routing')).toContainText('BBPJN');
});

test('every role opens its own screen; auditor and admin cannot change a case', async ({ page }) => {
  await page.goto('/peran/');
  await expect(id(page, 'v5-role-switch').locator('option')).toHaveCount(11);
  await asRole(page, 'ACC-HEAD');
  await expect(id(page, 'v5-head')).toContainText('Semua kasus');
  await page.screenshot({ path: `${SHOTS}/pimpinan.png` });
  await asRole(page, 'ACC-ADMIN');
  await expect(id(page, 'v5-admin')).toContainText('Peta jalan');
  await page.screenshot({ path: `${SHOTS}/admin.png` });
  await asRole(page, 'ACC-AUDIT');
  await expect(id(page, 'v5-queue')).toContainText('tidak bisa mengubah kasus');
});

test('tour runs inside 60 seconds; why cites a source for every fact', async ({ page }) => {
  const started = Date.now();
  await page.goto('/tour/');
  await expect(id(page, 'v5-tour')).toBeVisible();
  await page.screenshot({ path: `${SHOTS}/tur.png` });
  for (let i = 0; i < 5; i++) await id(page, 'v5-tour-next').click();
  await expect(id(page, 'v5-tour-caption')).toContainText('tersegel');
  await expect(id(page, 'v5-tour-end')).toBeVisible();
  expect(Date.now() - started).toBeLessThan(60_000);
  await page.goto('/why/');
  await expect(id(page, 'v5-fact').first()).toBeVisible();
  expect(await id(page, 'v5-fact').count()).toBeGreaterThan(10);
  for (const fact of await id(page, 'v5-fact').all()) await expect(fact).toContainText('Sumber:');
  await page.screenshot({ path: `${SHOTS}/kenapa.png` });
});
