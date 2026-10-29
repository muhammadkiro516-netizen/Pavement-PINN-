// Full user journey on an isolated server (port 3200), real UI + real AI + real Open-Meteo.
// node journey.mjs <outDir> <sim A|B>
import { chromium } from 'playwright';
import { mkdirSync, readFileSync } from 'node:fs';

const BASE = 'http://127.0.0.1:3200';
const [OUT_ROOT, SIM] = process.argv.slice(2);
const CFG = {
  A: { title: 'Lubang · Karawang', at: { latitude: -6.3050, longitude: 107.3002 }, close: 'A_close', far: 'A_far', side: 'A_side', after: 'after_A', notes: 'Lubang di lajur kiri, tepi aspal terkelupas, air menggenang setelah hujan. Belum ada rambu.', ref: [[0.08, 0.88], [0.15, 0.88]], len: [[0.25, 0.55], [0.80, 0.62]], wid: [[0.52, 0.40], [0.55, 0.85]], depth: [[0.50, 0.30], [0.50, 0.40]], sideRef: [[0.08, 0.85], [0.14, 0.85]], severity: null },
  B: { title: 'Retak & tambalan · Jakarta Timur', at: { latitude: -6.2253, longitude: 106.8995 }, close: 'B_close', far: 'B_far', side: 'B_side', after: 'after_B', notes: 'Retak memanjang di jejak roda kiri sepanjang ±3 m, tambalan lama mulai lepas.', ref: [[0.10, 0.88], [0.14, 0.88]], len: [[0.30, 0.12], [0.62, 0.95]], wid: [[0.40, 0.55], [0.46, 0.55]], depth: [[0.45, 0.40], [0.45, 0.43]], sideRef: [[0.10, 0.88], [0.13, 0.88]], severity: 'Sedang' }
}[SIM];
const OUT = `${OUT_ROOT}/sim-${SIM}`;
mkdirSync(OUT, { recursive: true });
const PH = (n) => `.e2e-tmp/photos/${n}.jpg`;
const cred = (v) => { const [email, ...p] = String(process.env[v] ?? '').split(':'); return { email, password: p.join(':') }; };
const KOOR = cred('PP_KOOR');
const PET = cred('PP_PETUGAS');
const WARGA = { email: `warga.sim${SIM.toLowerCase()}@example.com`, name: SIM === 'A' ? 'Rina (warga)' : 'Dimas (warga)', password: 'Simulasi-Warga-2026!' };
let n = 0;
const shot = async (page, name, opts = {}) => {
  n += 1;
  const file = `${OUT}/${String(n).padStart(2, '0')}-${name}.png`;
  await page.screenshot({ path: file, timeout: 90000, animations: 'disabled', ...opts }).catch(async (e) => { console.log('retry shot', name, e.message.slice(0, 60)); await page.waitForTimeout(3000); await page.screenshot({ path: file, timeout: 90000 }); });
  console.log('shot', file);
};

const shotDialog = async (page, name) => {
  const dlg = page.locator('[role=dialog]').last();
  if (await dlg.count()) {
    n += 1;
    const file = `${OUT}/${String(n).padStart(2, '0')}-${name}.png`;
    await dlg.screenshot({ path: file, timeout: 90000 });
    console.log('shot', file);
  } else await shot(page, name);
};
const browser = await chromium.launch({ args: ['--use-fake-ui-for-media-stream', '--use-fake-device-for-media-stream'] });
const PHONE = { width: 390, height: 844 };
const DESK = { width: 1440, height: 900 };
async function open(login, viewport, video = false) {
  const ctx = await browser.newContext({ ...(video ? { recordVideo: { dir: `${OUT}/video-raw`, size: viewport } } : {}), viewport, deviceScaleFactor: viewport.width > 800 ? 1 : 1.5, geolocation: CFG.at, permissions: ['geolocation', 'camera'] });
  await ctx.addInitScript(() => { try { localStorage.setItem('pp-map-coach', '1'); localStorage.setItem('pp-onboarded', '1'); } catch {} });
  const r = await ctx.request.post(`${BASE}/api/auth/login`, { data: login });
  if (!r.ok()) throw new Error(`login ${login.email} ${r.status()}`);
  const token = /=([^;]+)/.exec(r.headers()['set-cookie'] ?? '')?.[1];
  const page = await ctx.newPage();
  page.on('pageerror', (e) => console.log('pageerror', e.message.slice(0, 160)));
  return { ctx, page, me: (await r.json()).actor.id, auth: { Authorization: `Bearer ${token}` } };
}
const settle = (page, ms = 2500) => page.waitForTimeout(ms);
const go = async (page, path, ms) => { await page.goto(BASE + path, { waitUntil: 'networkidle' }).catch(() => undefined); await settle(page, ms); };

// ---------- 1. Warga reports from the spot ----------
const pre = await browser.newContext();
await pre.request.post(`${BASE}/api/auth/register`, { data: WARGA });
await pre.close();
const w = await open({ email: WARGA.email, password: WARGA.password }, PHONE, true);
await go(w.page, '/peta/', 5000);
await shot(w.page, 'warga-peta-sekitar-anda');
await w.page.getByRole('button', { name: 'Lapor' }).first().click();
await settle(w.page, 3500);
await shot(w.page, 'warga-kamera-ai-langsung');
await w.page.locator('[data-testid=report-photo-input]').setInputFiles(PH(CFG.close));
await settle(w.page, 2000);
await shot(w.page, 'warga-foto-dipilih');
await w.page.getByRole('button', { name: 'Lanjutkan' }).click();
await settle(w.page, 900);
await shot(w.page, 'warga-pavi-menganalisis');
await w.page.getByText('Periksa laporan').first().waitFor({ timeout: 120000 });
await settle(w.page, 1500);
await shot(w.page, 'warga-hasil-ai');
await w.page.getByLabel('Foto jauh', { exact: true }).setInputFiles(PH(CFG.far));
await w.page.getByLabel('Foto samping 45°', { exact: true }).setInputFiles(PH(CFG.side));
await w.page.waitForFunction(() => !document.querySelector('.animate-spin'), null, { timeout: 120000 }).catch(() => undefined);
await settle(w.page, 1500);
await w.page.getByText('Foto dari sisi lain').first().scrollIntoViewIfNeeded();
await shot(w.page, 'warga-foto-3-sisi');
if (CFG.severity) await w.page.getByText(CFG.severity, { exact: true }).last().click().catch(() => console.log('no severity button'));
await w.page.getByRole('button', { name: 'Kirim laporan' }).scrollIntoViewIfNeeded();
await w.page.getByRole('button', { name: 'Kirim laporan' }).click();
await settle(w.page, 4000);
await shot(w.page, 'warga-laporan-terkirim');

const wv = w.page.video();
await w.ctx.close();
await wv?.saveAs(`${OUT}/video-warga-melapor.webm`);
// Find the new case.
const k = await open(KOOR, DESK);
const list = await (await k.ctx.request.get(`${BASE}/api/workflow/reports`, { headers: k.auth })).json();
const mine = list.items.map((i) => i.case).filter((c) => c.report.reporterName === WARGA.name).sort((a, b) => String(b.createdAt).localeCompare(String(a.createdAt)))[0];
if (!mine) throw new Error('new citizen case not found');
const ID = mine.id;
console.log('case', ID, mine.state);
const get = async () => (await (await k.ctx.request.get(`${BASE}/api/workflow/reports/${ID}`, { headers: k.auth })).json()).report.case;
const act = async (who, command) => {
  const c = await get();
  const r = await who.ctx.request.post(`${BASE}/api/workflow/reports/${ID}/transitions`, { data: { command, expectedVersion: c.version }, headers: who.auth });
  const b = await r.json();
  console.log(command.action, r.status(), b.report?.case?.state ?? JSON.stringify(b.error));
};

// ---------- 2. Koordinator triages and assigns ----------
const p = await open(PET, PHONE, true);
await go(k.page, '/antrian/', 5000);
await shot(k.page, 'koordinator-pusat-kendali');
await act(k, { action: 'REVIEW_ACCEPT', reason: 'Foto 3 sisi jelas, lokasi di ruas kewenangan kami.' });
await act(k, { action: 'REQUEST_INSPECTION', reason: 'Prioritas: rusak di lajur kendaraan berat.', engineerId: p.me, dueAt: new Date(Date.now() + 2 * 864e5).toISOString(), instructions: 'Foto 3 sisi, ukur dengan meteran, pasang rambu bila perlu.' });

// ---------- 3. Petugas: guided inspection with photo measurement ----------
await go(p.page, '/tugas/', 3000);
await shot(p.page, 'petugas-tugas-saya');
await p.page.locator('div').filter({ hasText: ID }).filter({ has: p.page.getByRole('button', { name: /Mulai inspeksi terpandu/ }) }).last().getByRole('button', { name: /Mulai inspeksi terpandu/ }).click();
await settle(p.page, 1200);
for (const [label, file] of [['Foto jauh', CFG.far], ['Foto atas + skala', CFG.close], ['Foto samping 45°', CFG.side]]) {
  await p.page.getByLabel(label, { exact: true }).setInputFiles(PH(file));
  await settle(p.page, 300);
}
await p.page.waitForFunction(() => !document.body.innerText.includes('AI menganalisis…'), null, { timeout: 120000 }).catch(() => undefined);
await settle(p.page, 1500);
await shot(p.page, 'petugas-inspeksi-3-sisi-ai');
async function measure(button, pairs) {
  await p.page.getByRole('button', { name: button }).first().click();
  await settle(p.page, 800);
  const box = await p.page.locator('[role=dialog][aria-label^="Ukur di"] img').boundingBox();
  for (const pair of pairs) {
    for (const [x, y] of pair) await p.page.mouse.click(box.x + x * box.width, box.y + y * box.height);
    await settle(p.page, 250);
  }
}
await measure(/Ukur panjang & lebar di foto/, [CFG.ref, CFG.len, CFG.wid]);
await shot(p.page, 'petugas-ukur-di-foto-atas');
await p.page.getByRole('button', { name: 'Simpan ukuran' }).click();
await measure(/Ukur kedalaman di foto/, [CFG.sideRef, CFG.depth]);
await shot(p.page, 'petugas-ukur-kedalaman-foto-samping');
await p.page.getByRole('button', { name: 'Simpan ukuran' }).click();
await settle(p.page, 600);
await p.page.getByRole('button', { name: 'Pakai ukuran dari foto' }).click();
await p.page.getByPlaceholder(/lubang di lajur kiri/).fill(CFG.notes);
await p.page.getByText('Terukur dari foto').scrollIntoViewIfNeeded();
await shot(p.page, 'petugas-ukuran-dan-catatan');
await p.page.getByRole('button', { name: /Kirim kasus ke Koordinator/ }).click();
await settle(p.page, 3000);
console.log('after inspection', (await get()).state);
if ((await get()).state !== 'INSPECTED') throw new Error('inspection did not reach INSPECTED');

// ---------- 4. Koordinator reads the case summary (AI + measurements + weather) ----------
await go(k.page, '/antrian/', 4000);
await k.page.getByRole('button', { name: /Cek ringkasan kasus Bandingkan/ }).click();
await settle(k.page, 1200);
await k.page.getByRole('button', { name: 'Cek ringkasan kasus dari lapangan' }).first().click();
await settle(k.page, 4000);
await shotDialog(k.page, 'koordinator-ringkasan-kasus');
await k.page.getByText(/Cuaca di lokasi/).scrollIntoViewIfNeeded().catch(() => undefined);
await settle(k.page, 800);
await shotDialog(k.page, 'koordinator-ringkasan-cuaca');
await k.page.getByPlaceholder(/foto dan ukuran lengkap/).fill('Foto 3 sisi, ukuran di foto dan catatan konsisten.');
await k.page.getByRole('button', { name: /Verifikasi Hasil Inspeksi/ }).click();
await settle(k.page, 2500);

// ---------- 5. Petugas: structure + PINN analysis ----------
const pv = p.page.video();
await p.page.close();
await pv?.saveAs(`${OUT}/video-petugas-inspeksi.webm`);
p.page = await p.ctx.newPage();
const pd = await open(PET, DESK);
const LAYERS = [['layers.0.thicknessMm.value', 100], ['layers.0.modulusMPa.value', 3000], ['layers.1.thicknessMm.value', 250], ['layers.1.modulusMPa.value', 300], ['layers.2.thicknessMm.value', 200], ['layers.2.modulusMPa.value', 150], ['layers.3.modulusMPa.value', 50]];
for (const [field, value] of LAYERS) {
  const r = await pd.ctx.request.post(`${BASE}/api/v3/reports/${ID}/corrections`, { data: { kind: 'layers', field, newValue: value, reason: 'Hasil core drill & DCP di lokasi (simulasi)', evidence: ['core-01.jpg'] }, headers: pd.auth });
  console.log('layer', field, r.status());
}
await settle(pd.page, 8000);
for (const tab of ['overview', 'structure', 'pinn']) {
  await go(pd.page, `/analisis/${ID}/?tab=${tab}`, tab === 'pinn' ? 9000 : 5000);
  await shot(pd.page, `petugas-analisis-${tab}`);
  if (tab === 'pinn') {
    const hit = pd.page.getByRole('button', { name: /^Hitung/ }).first();
    if (await hit.count()) { await hit.click(); await settle(pd.page, 9000); await shot(pd.page, 'petugas-analisis-pinn-hasil'); }
    await pd.page.mouse.wheel(0, 900);
    await settle(pd.page, 2500);
    await shot(pd.page, 'petugas-analisis-pinn-keputusan');
  }
}
await act(p, { action: 'RECOMMEND_ACTION', treatment: 'Tambal dalam (full-depth patching) AC-WC 5 cm + perbaikan drainase', urgency: 'PRIORITY', rationale: 'Terkonfirmasi 3 sisi; PINN: sisa umur pendek pada musim hujan; genangan mempercepat kerusakan.', assessmentId: null });

// ---------- 6. Koordinator approves and issues the work order ----------
await act(k, { action: 'APPROVE_ACTION', reason: 'Rekomendasi sesuai temuan dan anggaran pemeliharaan rutin.' });
await act(k, { action: 'START_WORK', reason: 'SPK diterbitkan.', contractorNote: 'Pemeliharaan rutin', contractor: 'CV Mitra Jalan (contoh)', contractValueIdr: 18500000, targetDate: new Date(Date.now() + 7 * 864e5).toISOString(), supervisor: 'Petugas Lapangan Uji', maintenanceMonths: 6 });
await go(k.page, '/antrian/', 3500);
await shot(k.page, 'koordinator-spk-terbit');

// ---------- 7. Petugas sends the repair evidence (server runs AI on the after photo) ----------
const after = `data:image/jpeg;base64,${readFileSync(PH(CFG.after)).toString('base64')}`;
await act(p, { action: 'COMPLETE_WORK_ORDER', reason: 'Pekerjaan selesai sesuai SPK.', completionPhotoUrl: after, repair: { method: 'PATCHING_DALAM', materialId: 'AC-WC', thicknessCm: 5, areaM2: 1.2, compactor: 'STAMPER', category: 'PERMANEN', valueIdr: 18500000 } });

// ---------- 8. Koordinator verifies the repair and closes ----------
await go(k.page, '/antrian/', 4000);
await k.page.getByRole('button', { name: /Cek hasil perbaikan Bandingkan/ }).click();
await settle(k.page, 1200);
await k.page.getByRole('button', { name: /^Verifikasi$/ }).first().click().catch(() => console.log('no verify button'));
await settle(k.page, 3000);
await shotDialog(k.page, 'koordinator-verifikasi-perbaikan');
await k.page.keyboard.press('Escape');
await act(k, { action: 'RESOLVE', reason: 'Foto sesudah dan cek AI: tidak ada kerusakan tersisa.' });

// ---------- 9. Warga sees the outcome ----------
await pd.ctx.close();
const w2 = await open({ email: WARGA.email, password: WARGA.password }, PHONE);
w.page = w2.page;
await go(w.page, '/laporanku/', 3500);
await shot(w.page, 'warga-kawal-selesai');
await go(w.page, '/notifikasi/', 2500);
await shot(w.page, 'warga-notifikasi');
console.log('final', (await get()).state);
await browser.close();
