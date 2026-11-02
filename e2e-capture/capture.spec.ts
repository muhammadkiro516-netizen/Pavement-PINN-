/**
 * Records the clips of the Capture Kit (docs/v6/FINAL_PLAN_VIDEO_DECK.md, Prompt B1): the real UI through the real
 * API with real codes and PINs. Only the camera picture and the GPS are supplied by the browser.
 */
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { expect, test, type Browser, type BrowserContext, type Page } from '@playwright/test';

const ROOT = '.data/capture';
const ACCESS: Record<string, { code: string; pin: string; name: string }> = JSON.parse(fs.readFileSync(`${ROOT}/access.local.json`, 'utf8'));
const POINTS = JSON.parse(fs.readFileSync(`${ROOT}/points.json`, 'utf8'));
const RAW = `${ROOT}/raw`;
const STILLS = 'capture-kit/stills';
fs.mkdirSync(RAW, { recursive: true });
fs.mkdirSync(STILLS, { recursive: true });

const KRW = 'dpupr-karawang';
const FORBIDDEN = /\b(demo|test|uji|dummy|sample)\b|contoh-data/i;
const scenes: Record<string, Record<string, unknown>> = {};
const issues: string[] = [];
const data: Record<string, unknown> = {};
/** After a failure, the clips already in .data/capture/finished stay; recording goes on from the auditor. */
const RESUME = process.env.CAPTURE_RESUME === '1';
if (RESUME) {
  const before = JSON.parse(fs.readFileSync(`${ROOT}/scenes.raw.json`, 'utf8'));
  Object.assign(scenes, before.scenes);
  Object.assign(data, before.data);
  issues.push(...before.issues);
}

const id = (p: Page, t: string) => p.getByTestId(t);
const dataUrl = (name: string) => `data:image/jpeg;base64,${fs.readFileSync(`${ROOT}/scenes/${name}.jpg`).toString('base64')}`;

/** The browser's camera shows the given pictures in turn: each time the camera opens, the next one. */
async function camera(context: BrowserContext, names: string[]) {
  await context.addInitScript((urls: string[]) => {
    let turn = -1;
    const pictures = urls.map((u) => { const i = new Image(); i.src = u; return i; });
    navigator.mediaDevices.getUserMedia = async () => {
      turn = Math.min(turn + 1, pictures.length - 1);
      const canvas = document.createElement('canvas');
      canvas.width = 1280;
      canvas.height = 960;
      const g = canvas.getContext('2d')!;
      const picture = pictures[turn];
      if (!picture.complete) await picture.decode();
      const paint = () => g.drawImage(picture, 0, 0, 1280, 960);
      paint();
      setInterval(paint, 100);
      return canvas.captureStream(10);
    };
    localStorage.setItem('pp-onboarded', '1');
    localStorage.setItem('pp-map-coach', '1');
  }, names.map(dataUrl));
}

/** A soft cursor and a tap ripple, only in the recording browser. */
async function pointer(context: BrowserContext) {
  await context.addInitScript(() => {
    const add = () => {
      const dot = document.createElement('div');
      dot.style.cssText = 'position:fixed;z-index:2147483647;width:22px;height:22px;margin:-11px 0 0 -11px;border-radius:50%;background:rgba(255,255,255,.35);border:2px solid rgba(255,255,255,.85);pointer-events:none;transition:transform 120ms;left:-40px;top:-40px';
      document.documentElement.appendChild(dot);
      addEventListener('mousemove', (e) => { dot.style.left = `${e.clientX}px`; dot.style.top = `${e.clientY}px`; }, true);
      addEventListener('mousedown', (e) => {
        dot.style.transform = 'scale(.7)';
        const ring = document.createElement('div');
        ring.style.cssText = `position:fixed;z-index:2147483646;left:${e.clientX}px;top:${e.clientY}px;width:16px;height:16px;margin:-8px 0 0 -8px;border-radius:50%;border:2px solid #FFD60A;pointer-events:none;transition:transform 420ms ease-out,opacity 420ms ease-out`;
        document.documentElement.appendChild(ring);
        requestAnimationFrame(() => { ring.style.transform = 'scale(4)'; ring.style.opacity = '0'; });
        setTimeout(() => ring.remove(), 500);
      }, true);
      addEventListener('mouseup', () => { dot.style.transform = 'scale(1)'; }, true);
    };
    if (document.documentElement) add();
    else addEventListener('DOMContentLoaded', add);
  });
}

interface Clip { page: Page; context: BrowserContext; name: string; started: number; marks: Record<string, number>; mark: (k: string) => void; finish: () => Promise<void> }

async function clip(browser: Browser, name: string, kind: 'phone' | 'desktop', opts: { camera?: string[]; at?: { lat: number; lon: number }; storage?: string } = {}): Promise<Clip> {
  const size = kind === 'phone' ? { width: 390, height: 844 } : { width: 1920, height: 1080 };
  const scale = kind === 'phone' ? 3 : 1;
  const context = await browser.newContext({
    viewport: size,
    deviceScaleFactor: scale,
    isMobile: kind === 'phone',
    hasTouch: false,
    locale: 'id-ID',
    timezoneId: 'Asia/Jakarta',
    permissions: ['geolocation', 'camera'],
    geolocation: opts.at ? { latitude: opts.at.lat, longitude: opts.at.lon, accuracy: 6 } : { latitude: POINTS.caseA.lat, longitude: POINTS.caseA.lon, accuracy: 6 },
    storageState: opts.storage
  });
  await pointer(context);
  await camera(context, opts.camera ?? ['hole_main']);
  const page = await context.newPage();
  // A phone's GPS keeps reporting; the browser's stand-in does so only when told.
  const here = opts.at ?? { lat: POINTS.caseA.lat, lon: POINTS.caseA.lon };
  const gps = kind === 'phone' && name !== '01b_long_damage' ? setInterval(() => void context.setGeolocation({ latitude: here.lat, longitude: here.lon, accuracy: 6 }).catch(() => undefined), 1000) : null;
  context.on('close', () => { if (gps) clearInterval(gps); });
  // Chrome's own screencast: real device pixels at @3x, which recordVideo does not give.
  const framesDir = `${RAW}/${name}`;
  fs.mkdirSync(framesDir, { recursive: true });
  const cdp = await context.newCDPSession(page);
  const frames: { file: string; t: number }[] = [];
  cdp.on('Page.screencastFrame', (f: { data: string; sessionId: number; metadata: { timestamp?: number } }) => {
    const file = `${String(frames.length).padStart(6, '0')}.jpg`;
    fs.writeFileSync(`${framesDir}/${file}`, Buffer.from(f.data, 'base64'));
    frames.push({ file, t: Date.now() });
    void cdp.send('Page.screencastFrameAck', { sessionId: f.sessionId }).catch(() => undefined);
  });
  const started = Date.now();
  await cdp.send('Page.startScreencast', { format: 'jpeg', quality: 85, maxWidth: size.width * scale, maxHeight: size.height * scale, everyNthFrame: 1 });
  const marks: Record<string, number> = {};
  const c: Clip = {
    page, context, name, started, marks,
    mark: (k) => { marks[k] = Date.now() - started; },
    finish: async () => {
      await scan(page, name);
      const ended = Date.now();
      await cdp.send('Page.stopScreencast').catch(() => undefined);
      await context.close();
      // Each frame stays on screen until the next one arrived, so time in the clip is real time.
      const list = frames.map((f, i) => `file '${f.file}'
duration ${(((frames[i + 1]?.t ?? ended) - f.t) / 1000).toFixed(3)}`);
      if (frames.length) list.unshift(`file '${frames[0].file}'
duration ${((frames[0].t - started) / 1000).toFixed(3)}`);
      fs.writeFileSync(`${framesDir}/list.txt`, [...list, `file '${frames[frames.length - 1]?.file}'`, ''].join(String.fromCharCode(10)));
      // The disk may be tight: each clip is encoded at once and its raw frames go away.
      fs.mkdirSync(`${ROOT}/finished`, { recursive: true });
      const target = kind === 'phone' ? '1170:2532' : '1920:1080';
      const done = spawnSync(process.env.CAPTURE_FFMPEG!, ['-y', '-loglevel', 'error', '-f', 'concat', '-safe', '0', '-i', `${framesDir}/list.txt`, '-ss', '0.4', '-vf', `scale=${target}:flags=lanczos,fps=30,format=yuv420p`, '-c:v', 'libx264', '-preset', 'fast', '-crf', '20', '-an', `${ROOT}/finished/${name}.mp4`]);
      if (done.status !== 0) throw new Error(`encode ${name}: ${done.stderr}`);
      fs.rmSync(framesDir, { recursive: true, force: true });
      scenes[name] = { ...(scenes[name] ?? {}), kind, marks, recordedAt: new Date(started).toISOString() };
      save();
    }
  };
  return c;
}

const save = () => fs.writeFileSync(`${ROOT}/scenes.raw.json`, JSON.stringify({ scenes, issues, data }, null, 1));

/** Every checkpoint reads the screen: forbidden words and error messages are recorded, never ignored. */
async function scan(p: Page, where: string) {
  const text = await p.evaluate(() => document.body.innerText).catch(() => '');
  const hit = text.match(FORBIDDEN);
  if (hit) issues.push(`${where}: word "${hit[0]}" near "${text.slice(Math.max(0, hit.index! - 30), hit.index! + 30).replace(/\n/g, ' ')}"`);
  if (/Tampilan mengalami galat|Ada yang tidak berjalan/.test(text)) issues.push(`${where}: error on screen`);
}

async function hold(p: Page, ms = 1100) { await p.waitForTimeout(ms); }

async function tap(p: Page, target: ReturnType<Page['locator']>) {
  await target.first().scrollIntoViewIfNeeded();
  await p.waitForTimeout(250);
  const box = await target.first().boundingBox();
  if (box) { await p.mouse.move(box.x + box.width / 2, box.y + box.height / 2, { steps: 12 }); await p.waitForTimeout(120); }
  await target.first().click();
}

async function type(p: Page, target: ReturnType<Page['locator']>, text: string) {
  await tap(p, target);
  await target.first().fill('');
  await target.first().pressSequentially(text, { delay: 35 });
}

/** A smooth look down the page, so what is below is seen at reading pace. */
async function glide(p: Page, to: ReturnType<Page['locator']>) {
  await to.first().evaluate((el) => el.scrollIntoView({ behavior: 'smooth', block: 'center' }));
  await p.waitForTimeout(1400);
}

async function still(p: Page, name: string, fullPage = false) {
  await scan(p, `still ${name}`);
  await p.screenshot({ path: `${STILLS}/${name}.png`, fullPage });
}

async function signIn(p: Page, who: string, link = false) {
  const a = ACCESS[who];
  if (link) {
    await p.goto(`/login/#kode=${a.code}`);
  } else {
    await p.goto('/login/');
    await type(p, id(p, 'v6-code'), a.code);
    await tap(p, id(p, 'v6-code-next'));
  }
  await type(p, id(p, 'v6-pin'), a.pin);
  await hold(p, 500);
  await tap(p, id(p, 'v6-pin-ok'));
  await p.waitForURL(/kerja/);
  await expect(id(p, 'v5-role-name')).toBeVisible();
  await hold(p, 1400);
}

async function confirmPin(p: Page, who: string) {
  await type(p, id(p, 'v6-reauth-pin'), ACCESS[who].pin);
  await tap(p, id(p, 'v6-reauth-ok'));
}

const shoot = async (p: Page) => {
  await expect(id(p, 'v5-shutter')).toBeEnabled();
  await hold(p, 900);
  await tap(p, id(p, 'v5-shutter'));
};

/** The case as the API returns it to this person: what scenes.json reports is what the screen read. */
async function caseOf(p: Page, code: string) {
  return p.evaluate(async (c) => {
    const token = localStorage.getItem('pp-v6-staff-session')!;
    const list = await (await fetch('/api/v5/cases', { headers: { 'x-v5-session': token } })).json();
    return list.data.find((x: { publicCode: string }) => x.publicCode === c);
  }, code);
}

/** A step that must happen but is not part of any clip. */
async function offCamera(browser: Browser, who: string, code: string, run: (p: Page) => Promise<void>) {
  const context = await browser.newContext({ viewport: { width: 1280, height: 900 }, permissions: ['geolocation', 'camera'], geolocation: { latitude: POINTS.caseA.lat, longitude: POINTS.caseA.lon, accuracy: 6 } });
  const p = await context.newPage();
  await p.goto('/login/');
  await id(p, 'v6-code').fill(ACCESS[who].code);
  await id(p, 'v6-code-next').click();
  await id(p, 'v6-pin').fill(ACCESS[who].pin);
  await id(p, 'v6-pin-ok').click();
  await p.waitForURL(/kerja/);
  const c = await caseOf(p, code);
  await p.goto(`/kerja/${c.id}/`);
  await expect(id(p, 'v5-case-head')).toBeVisible();
  await run(p);
  await context.close();
}

async function pickDamage(p: Page, label: string) {
  if (await p.getByText('Dideteksi otomatis').count()) return;
  await p.locator('select').filter({ hasText: 'Retak Buaya' }).first().selectOption({ label });
  await hold(p, 500);
}

/** Report through the citizen screens. Returns the tracking code. */
async function citizenReport(p: Page, c: Clip | null, severity = 'Sedang') {
  await p.goto('/beranda/');
  await p.waitForTimeout(3600);
  c?.mark('landing');
  await tap(p, p.getByRole('button', { name: 'Laporkan jalan rusak' }));
  await p.waitForURL(/peta/);
  await hold(p);
  await tap(p, id(p, 'report-open-camera'));
  await hold(p, 1800);
  c?.mark('camera_live');
  await tap(p, p.getByRole('button', { name: /ambil foto|potret/i }));
  await p.getByRole('button', { name: /gunakan|lanjut|pakai foto/i }).first().click({ timeout: 15_000 }).catch(() => undefined);
  await expect(id(p, 'road-owner')).toBeVisible({ timeout: 120_000 });
  c?.mark('ai_result');
  await hold(p, 2200);
  await glide(p, id(p, 'road-owner'));
  c?.mark('handled_by_preview');
  await hold(p, 1500);
  // Only where the detector did not already choose: the person picks, as on any phone.
  await pickDamage(p, '🕳 Lubang');
  await tap(p, p.getByRole('radio', { name: severity }).or(p.getByRole('button', { name: severity })));
  await hold(p, 500);
  await tap(p, p.getByRole('button', { name: 'Kirim laporan' }));
  await expect(id(p, 'report-code')).toBeVisible({ timeout: 120_000 });
  c?.mark('sent_tracking_code');
  await hold(p, 2500);
  return (await id(p, 'report-code').innerText()).trim();
}

test.afterEach(async ({ browser }, info) => {
  if (info.status === 'passed') return;
  let n = 0;
  for (const context of browser.contexts()) for (const p of context.pages()) {
    await p.screenshot({ path: `${ROOT}/fail-${n}.png` }).catch(() => undefined);
    fs.writeFileSync(`${ROOT}/fail-${n++}.txt`, await p.evaluate(() => document.body.innerText).catch(() => ''));
  }
});

test('capture kit', async ({ browser }) => {
  const A = POINTS.caseA;
  let codeA = (data.caseA as { code: string } | undefined)?.code ?? '';
  const citizenState = `${ROOT}/citizen-a.json`;
  let guestCode = '';
  let codeDup = '';
  if (!RESUME) {
  // ---- Measured engine numbers, read from the running services
  {
    const health = await (await fetch('http://127.0.0.1:8100/v1/health')).json();
    const t0 = Date.now();
    const analysis = await (await fetch('http://127.0.0.1:8100/v1/cv/analyze-image', { method: 'POST', headers: { 'content-type': 'image/jpeg' }, body: fs.readFileSync(`${ROOT}/scenes/hole_main.jpg`) })).json();
    const wall = Date.now() - t0;
    data.engine = { openvinoVersion: health.openvino_version, devices: health.available_devices, models: health.models_loaded, engineVersion: health.engine_version };
    data.detection = { label: analysis.detections[0]?.label ?? null, confidence: analysis.detections[0]?.confidence ?? null, modelId: analysis.model?.detector?.modelId ?? null, device: analysis.model?.detector?.device ?? null, wallMs: wall, reportedTimings: analysis.timingsMs ?? analysis.timings ?? null };
    save();
  }

  // ---- 01 Citizen report (Case A)
  const a1 = await clip(browser, '01_citizen_report', 'phone', { camera: ['hole_main'], at: A });
  a1.page.on('response', async (r) => {
    if (r.url().endsWith('/api/v5/cases') && r.request().method() === 'POST' && r.ok()) {
      const b = (await r.json()).data;
      scenes['01_citizen_report'] = { ...(scenes['01_citizen_report'] ?? {}), routing: { road: b.routing?.segment?.name, status: b.routing?.status, agency: b.handledBy?.name, confidence: b.routing?.confidence, reason: b.handledBy?.reason, ruleIds: b.routing?.ruleIds }, screening: b.screening };
    }
  });
  codeA = await citizenReport(a1.page, a1);
  await still(a1.page, 'citizen-sent');
  data.caseA = { code: codeA, ...A };
  await a1.context.storageState({ path: citizenState });
  await a1.finish();

  // A second citizen reports the same hole (not a clip): this is the duplicate the OM merges.
  const second = await browser.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, permissions: ['geolocation', 'camera'], geolocation: { latitude: A.lat + 0.00005, longitude: A.lon, accuracy: 6 } });
  await camera(second, ['hole_second']);
  const secondPage = await second.newPage();
  codeDup = await citizenReport(secondPage, null);
  await second.close();
  data.caseDuplicate = { code: codeDup };

  // ---- 01b Long damage (Case B)
  {
    const c = await clip(browser, '01b_long_damage', 'phone', { camera: ['other_0', 'other_1', 'other_2', 'hole_0', 'hole_1'], at: { lat: A.lat + 0.002, lon: A.lon + 0.002 } });
    const p = c.page;
    await p.goto('/beranda/');
    await p.waitForTimeout(3600);
    await tap(p, p.getByRole('button', { name: 'Laporkan jalan rusak' }));
    await p.waitForURL(/peta/);
    await hold(p);
    await tap(p, id(p, 'long-damage-open-input'));
    await expect(id(p, 'long-walk')).toBeVisible();
    await hold(p);
    await expect(id(p, 'long-walk-start')).toBeEnabled();
    await tap(p, id(p, 'long-walk-start'));
    c.mark('walk_started');
    let lat = A.lat + 0.002;
    const step = async (n: number) => {
      for (let i = 0; i < n; i++) {
        lat += 0.000036; // about 4 m, a walking pace
        await c.context.setGeolocation({ latitude: lat, longitude: A.lon + 0.002, accuracy: 6 });
        await p.waitForTimeout(2200);
      }
    };
    const feed = setInterval(() => void c.context.setGeolocation({ latitude: lat, longitude: A.lon + 0.002, accuracy: 6 }).catch(() => undefined), 1000);
    await step(5);
    await expect(id(p, 'long-walk-photo')).toBeVisible();
    c.mark('photo_due_15m');
    await tap(p, id(p, 'long-walk-photo'));
    await shoot(p);
    await expect(id(p, 'long-walk-photos')).toContainText('1 foto');
    c.mark('photo_1_taken');
    await step(5);
    await tap(p, id(p, 'long-walk-photo'));
    await shoot(p);
    await expect(id(p, 'long-walk-photos')).toContainText('2 foto');
    c.mark('photo_2_taken');
    await hold(p);
    await tap(p, id(p, 'long-walk-end'));
    c.mark('walk_done');
    clearInterval(feed);
    await hold(p, 1800);
    await tap(p, p.getByRole('button', { name: /ambil foto|potret/i }));
    await p.getByRole('button', { name: /gunakan|lanjut|pakai foto/i }).first().click({ timeout: 15_000 }).catch(() => undefined);
    await expect(id(p, 'road-owner')).toBeVisible({ timeout: 120_000 });
    await hold(p, 1800);
    await glide(p, id(p, 'long-summary'));
    await hold(p, 1500);
    await pickDamage(p, '〰 Retak Permukaan');
    await tap(p, p.getByRole('radio', { name: 'Sedang' }).or(p.getByRole('button', { name: 'Sedang' })));
    await tap(p, p.getByRole('button', { name: 'Kirim laporan' }));
    await expect(id(p, 'report-code')).toBeVisible({ timeout: 120_000 });
    c.mark('sent');
    await hold(p, 2200);
    data.caseB = { code: (await id(p, 'report-code').innerText()).trim() };
    await still(p, 'citizen-long-damage');
    await c.finish();
  }

  // ---- 01c Low confidence, in the Jakarta Timur inbox (Case C)
  const cAt = POINTS.caseC;
  {
    const report = await browser.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, permissions: ['geolocation', 'camera'], geolocation: { latitude: cAt.lat, longitude: cAt.lon, accuracy: 6 } });
    await camera(report, ['hole_2']);
    const rp = await report.newPage();
    data.caseC = { code: await citizenReport(rp, null), ...cAt };
    await report.close();
    const c = await clip(browser, '01c_low_confidence', 'desktop');
    await signIn(c.page, 'sudin-bm-jaktim-om1');
    await expect(c.page.getByTestId('v6-confirm-owner-label').first()).toBeVisible();
    c.mark('confirm_ownership_label');
    await hold(c.page, 2500);
    await tap(c.page, id(c.page, `v5-open-${(data.caseC as { code: string }).code}`));
    await expect(id(c.page, 'v5-coordinator-confirm')).toBeVisible();
    await glide(c.page, id(c.page, 'v5-coordinator-confirm'));
    c.mark('confirm_ownership_panel');
    await hold(c.page, 3000);
    await still(c.page, 'om-confirm-ownership');
    await c.finish();
  }

  // ---- 01d Agency not connected (Case D)
  {
    const c = await clip(browser, '01d_not_onboarded', 'phone', { camera: ['hole_3'], at: POINTS.caseD });
    const code = await citizenReport(c.page, c);
    await glide(c.page, id(c.page, 'road-owner-not-connected'));
    c.mark('not_connected_card');
    await hold(c.page, 2200);
    await c.page.goto(`/pantau/${code}/`);
    await expect(id(c.page, 'v6-not-connected')).toBeVisible();
    await glide(c.page, id(c.page, 'v5-complaint'));
    c.mark('lapor_draft');
    await hold(c.page, 2500);
    await still(c.page, 'citizen-not-connected');
    data.caseD = { code, ...POINTS.caseD };
    scenes['01d_not_onboarded'] = { handledBy: await c.page.evaluate(async (k) => (await (await fetch(`/api/v5/public/track/${k}`)).json()).data.handledBy, code) };
    await c.finish();
  }

  // ---- 02 Agency login
  {
    const c = await clip(browser, '02_agency_login', 'phone');
    await signIn(c.page, `${KRW}-om1`, true);
    c.mark('workspace_open');
    await hold(c.page, 2000);
    await still(c.page, 'om-phone-today');
    await c.finish();
  }

  // ---- 02b Team & Codes
  {
    const c = await clip(browser, '02b_team_codes', 'desktop');
    const p = c.page;
    await signIn(p, `${KRW}-om1`);
    await tap(p, id(p, 'v6-side-team'));
    await expect(id(p, 'v6-team')).toBeVisible();
    await hold(p);
    await type(p, id(p, 'v6-staff-name'), 'Fajar Nugroho');
    await type(p, id(p, 'v6-staff-title'), 'Petugas Inspeksi Jalan');
    await tap(p, id(p, 'v6-staff-add'));
    await confirmPin(p, `${KRW}-om1`);
    await expect(id(p, 'v6-badge-code')).toBeVisible();
    c.mark('code_and_qr');
    await hold(p, 2500);
    await still(p, 'om-team-codes');
    const row = p.locator('[data-testid^="v6-member-"]', { hasText: 'Fajar Nugroho' }).last();
    await glide(p, row);
    await tap(p, row.locator('[data-testid^="v6-revoke-"]'));
    await confirmPin(p, `${KRW}-om1`);
    await expect(row).toContainText('Dicabut');
    c.mark('revoked');
    await hold(p, 1500);
    await glide(p, id(p, 'v6-login-log'));
    c.mark('device_log');
    await hold(p, 2500);
    await tap(p, id(p, 'v6-lock'));
    await p.waitForURL(/login/);
    await expect(id(p, 'v6-pin')).toBeVisible();
    c.mark('locked_back_to_pin');
    await hold(p, 1800);
    await c.finish();
  }

  // ---- 03 OM: today, inbox, duplicate, assign, AC-WC line
  {
    const c = await clip(browser, '03_om_today_inbox', 'desktop');
    const p = c.page;
    const today = p.waitForResponse((r) => r.url().endsWith('/api/v6/today'));
    await signIn(p, `${KRW}-om1`);
    const t = (await (await today).json()).data;
    await expect(id(p, 'v6-actions')).toBeVisible();
    c.mark('today_actions');
    await hold(p, 3500);
    await still(p, 'om-today');
    await tap(p, id(p, 'v6-ai-briefing-run'));
    await expect(id(p, 'v6-ai-briefing')).toBeVisible({ timeout: 130_000 });
    const briefing = await id(p, 'v6-ai-briefing').innerText();
    c.mark('ai_briefing');
    await hold(p, 2500);
    await tap(p, id(p, 'v6-side-inbox'));
    await expect(id(p, 'v6-inbox-map')).toBeVisible();
    await p.waitForTimeout(3500);
    c.mark('inbox_map');
    await still(p, 'om-inbox');
    await glide(p, id(p, `v5-open-${codeA}`));
    await hold(p, 2000);
    const row = p.locator(`li[data-code="${codeA}"]`).getByTestId('v5-priority-reasons');
    const reasons = await row.innerText();
    c.mark('priority_reasons');
    await tap(p, id(p, `v5-open-${codeDup}`));
    await expect(id(p, 'v6-duplicates')).toBeVisible();
    await glide(p, id(p, 'v6-duplicates'));
    const dupText = await id(p, 'v6-duplicates').innerText();
    c.mark('duplicate_similarity');
    await hold(p, 2500);
    await id(p, 'v5-reason').fill('Foto dan lokasinya sama.').catch(() => undefined);
    await tap(p, id(p, `v6-merge-${codeA}`));
    await p.waitForTimeout(2000);
    c.mark('merged');
    await tap(p, id(p, 'v6-side-inbox'));
    await expect(id(p, `v5-open-${codeA}`)).toBeVisible();
    await tap(p, id(p, `v5-open-${codeA}`));
    await expect(id(p, 'v5-case-head')).toBeVisible();
    await hold(p, 1500);
    const ca = await caseOf(p, codeA);
    await type(p, id(p, 'v5-reason'), 'Foto menunjukkan lubang di jalur roda.');
    await p.locator('select[data-testid="v5-inspector"]').selectOption(`${KRW}-fe1`);
    await tap(p, id(p, 'v5-accept-assign'));
    await expect(id(p, 'v5-state-label')).toHaveText('Inspeksi dijadwalkan');
    c.mark('assigned');
    await hold(p, 2000);
    await tap(p, id(p, 'v6-side-cost'));
    await expect(id(p, 'v6-acwc-choice')).toBeVisible();
    await hold(p, 2500);
    await tap(p, id(p, 'v6-acwc-pick-REG-003'));
    await confirmPin(p, `${KRW}-om1`);
    await expect(id(p, 'v6-acwc-chosen')).toBeVisible();
    c.mark('ac_wc_line_chosen');
    await hold(p, 2000);
    scenes['03_om_today_inbox'] = {
      numbers: t.numbers, actions: t.actions, rain: t.rain, genaiBriefing: briefing, priorityReasons: reasons, priority: ca.priority, duplicates: dupText,
      escalationDates: ca.ladder?.steps?.map((s: { day: number; label: string }) => ({ day: s.day, label: s.label, date: new Date(Date.parse(ca.ladderStartAt) + s.day * 86_400_000).toISOString().slice(0, 10) })) ?? null
    };
    await c.finish();
  }

  // ---- 03b Transfer, citing the road decree (Case C)
  {
    const code = (data.caseC as { code: string }).code;
    const c = await clip(browser, '03b_transfer', 'desktop');
    const p = c.page;
    await signIn(p, 'sudin-bm-jaktim-om1');
    await tap(p, id(p, `v5-open-${code}`));
    await expect(id(p, 'v5-case-head')).toBeVisible();
    await hold(p);
    await type(p, id(p, 'v5-reason'), 'Ruas ini jalan nasional menurut Kepmen PUPR.');
    await tap(p, id(p, 'v5-transfer-toggle'));
    await p.locator('select[data-testid="v5-transfer-target"]').selectOption({ label: 'BBPJN DKI Jakarta - Jawa Barat' });
    await type(p, id(p, 'v5-decree-number'), 'Kepmen PUPR 1688/KPTS/M/2022');
    await hold(p, 1200);
    await tap(p, id(p, 'v5-transfer'));
    await expect(id(p, 'v5-transfer-pending')).toBeVisible();
    c.mark('transfer_sent');
    await hold(p, 2500);
    await c.finish();
    const d = await clip(browser, '03b_transfer_confirm', 'desktop');
    await signIn(d.page, 'bbpjn-dki-jabar-om1');
    await tap(d.page, id(d.page, `v5-open-${code}`));
    await expect(id(d.page, 'v5-transfer-pending')).toBeVisible();
    await type(d.page, id(d.page, 'v5-reason'), 'Benar, ruas ini ditangani balai.');
    await tap(d.page, id(d.page, 'v5-confirm-transfer'));
    await expect(id(d.page, 'v5-state-label')).toBeVisible();
    await d.page.waitForTimeout(1500);
    d.mark('moved_with_evidence');
    await hold(d.page, 2500);
    scenes['03b_transfer'] = { decree: 'Kepmen PUPR 1688/KPTS/M/2022', caseCode: code, card: await d.page.evaluate(async (k) => (await (await fetch(`/api/v5/public/track/${k}`)).json()).data.handledBy, code) };
    await d.finish();
  }

  // ---- 04 Field Engineer
  let compared: { options: { key: string; totalIdr: { low: number; mid: number; high: number } | null }[] } | null = null;
  {
    const c = await clip(browser, '04_fe_field_pinn_cost', 'phone', { camera: ['hole_4', 'marker', 'hole_5'], at: A });
    const p = c.page;
    await signIn(p, `${KRW}-fe1`);
    await tap(p, id(p, 'v6-tab-field'));
    await hold(p, 1800);
    c.mark('route_list');
    await still(p, 'fe-field');
    await tap(p, id(p, `v5-open-${codeA}`));
    await expect(id(p, 'v5-capture')).toBeVisible();
    await hold(p);
    await shoot(p);
    await expect(id(p, 'v5-capture')).toContainText('2. Kartu penanda');
    c.mark('inspect_side_1');
    await shoot(p);
    await expect(id(p, 'v5-capture')).toContainText('3. Penggaris');
    c.mark('marker_card_read');
    await shoot(p);
    await hold(p);
    await type(p, id(p, 'v5-length'), '80');
    await type(p, id(p, 'v5-width'), '60');
    await type(p, id(p, 'v5-depth'), '45');
    await hold(p);
    await still(p, 'fe-measure');
    await tap(p, id(p, 'v5-submit-inspection'));
    await expect(id(p, 'v5-state-label')).toHaveText('Inspeksi selesai');
    c.mark('inspection_sent');
    await hold(p);
    await offCamera(browser, `${KRW}-om1`, codeA, async (o) => {
      await id(o, 'v5-reason').fill('Ukuran dan foto sudah lengkap.');
      await id(o, 'v5-verify-inspection').click();
      await expect(id(o, 'v5-state-label')).toHaveText('Hasil inspeksi diperiksa');
    });
    await p.reload();
    await expect(id(p, 'v5-esal')).toBeVisible();
    c.mark('after_om_review');
    await hold(p);
    await type(p, id(p, 'v5-esal'), '250000');
    const t0 = Date.now();
    await tap(p, id(p, 'v5-run-pinn'));
    await expect(id(p, 'v5-pinn-range')).toContainText('bulan');
    const pinnRoundTripMs = Date.now() - t0;
    c.mark('pinn_result');
    await glide(p, id(p, 'v5-pinn-range'));
    await hold(p, 2500);
    await still(p, 'fe-pinn');
    await tap(p, id(p, 'v5-run-cost'));
    await expect(id(p, 'v5-cost-range')).toContainText('Rp');
    await hold(p);
    const compare = p.waitForResponse((r) => /compare-options$/.test(r.url()));
    await tap(p, id(p, 'v6-compare-run'));
    compared = (await (await compare).json()).data;
    await expect(id(p, 'v6-option-year-AC_WC_OVERLAY')).toContainText('per tahun');
    c.mark('options_side_by_side');
    for (const key of ['HOT_MIX_PATCH', 'COLD_MIX_PATCH', 'FAST_TRACK_CONCRETE', 'CONCRETE_K350', 'AC_WC_OVERLAY']) {
      await glide(p, id(p, `v6-option-${key}`));
      await hold(p, 1500);
    }
    await still(p, 'fe-cost-compare');
    const hot = compared!.options.find((o) => o.key === 'HOT_MIX_PATCH')!;
    await type(p, id(p, 'v6-submitted'), String(Math.round(hot.totalIdr!.high * 1.35)));
    await p.locator('select[data-testid="v6-submitted-option"]').selectOption('HOT_MIX_PATCH');
    await tap(p, id(p, 'v6-submitted-send'));
    await expect(id(p, 'v6-audit-result')).toContainText('Perlu klarifikasi');
    c.mark('over_20_percent');
    await hold(p, 2000);
    await glide(p, id(p, 'v6-ai-detection'));
    await hold(p, 1200);
    await tap(p, id(p, 'v6-ai-accept-detection'));
    await expect(id(p, 'v6-ai-decided-detection')).toBeVisible();
    c.mark('ai_accept');
    await hold(p, 1500);
    await glide(p, id(p, 'v5-rationale'));
    await type(p, id(p, 'v5-rationale'), 'Lubang di jalur roda. Tambal sampai dasar.');
    await tap(p, id(p, 'v5-propose-plan'));
    await expect(id(p, 'v5-state-label')).toHaveText('Usulan penanganan disusun');
    c.mark('proposed');
    await hold(p, 2000);
    const ca = await caseOf(p, codeA);
    scenes['04_fe_field_pinn_cost'] = {
      pinnRoundTripMs, pinn: ca.pinnRun, marker: true,
      comparison: ca.costComparison,
      submitted: ca.costComparison?.audit ?? null
    };
    await c.finish();
    await p.context().close().catch(() => undefined);
    const qa = await clip(browser, '04c_quality_tests', 'desktop');
    await signIn(qa.page, `${KRW}-fe1`);
    await tap(qa.page, id(qa.page, 'v6-side-cost'));
    await glide(qa.page, id(qa.page, 'v6-price-book'));
    await hold(qa.page, 2200);
    await glide(qa.page, id(qa.page, 'v6-qa-panel'));
    qa.mark('quality_tests');
    await hold(qa.page, 2500);
    await still(qa.page, 'fe-quality-tests');
    await qa.finish();
  }

  // ---- 04b Offline queue (Case B assigned to the same FE)
  {
    const codeB = (data.caseB as { code: string }).code;
    await offCamera(browser, `${KRW}-om1`, codeB, async (o) => {
      await id(o, 'v5-reason').fill('Kerusakan panjang di jalur ini.');
      await o.locator('select[data-testid="v5-inspector"]').selectOption(`${KRW}-fe1`);
      await id(o, 'v5-accept-assign').click();
      await expect(id(o, 'v5-state-label')).toHaveText('Inspeksi dijadwalkan');
    });
    const c = await clip(browser, '04b_offline_queue', 'phone', { camera: ['repair_9'], at: { lat: A.lat + 0.002, lon: A.lon + 0.002 } });
    const p = c.page;
    await signIn(p, `${KRW}-fe1`);
    await tap(p, id(p, `v5-open-${codeB}`));
    await expect(id(p, 'v5-shutter')).toBeEnabled();
    await hold(p);
    await c.context.setOffline(true);
    c.mark('signal_lost');
    await shoot(p);
    await expect(id(p, 'v6-queued')).toBeVisible();
    c.mark('saved_on_phone');
    await hold(p, 3000);
    await still(p, 'fe-offline-queue');
    await c.context.setOffline(false);
    await expect(id(p, 'v6-queued')).toHaveCount(0);
    c.mark('sent_when_signal_returns');
    await hold(p, 2000);
    await c.finish();
  }

  // ---- 05 Approval: self-approval refused, then the second OM
  {
    const c = await clip(browser, '05a_self_approval_refused', 'desktop');
    const p = c.page;
    await signIn(p, `${KRW}-fe1`);
    const ca = await caseOf(p, codeA);
    await p.goto(`/kerja/${ca.id}/`);
    await expect(id(p, 'v6-self-approve')).toBeVisible();
    await hold(p, 1500);
    await type(p, id(p, 'v6-self-reason'), 'Biaya dan ukuran sudah sesuai.');
    await tap(p, id(p, 'v6-self-approve'));
    await confirmPin(p, `${KRW}-fe1`);
    await expect(id(p, 'v5-error')).toBeVisible();
    const refusal = await id(p, 'v5-error').innerText();
    c.mark('server_refused');
    await hold(p, 3000);
    await still(p, 'fe-self-approval-refused');
    await c.finish();
    const d = await clip(browser, '05b_second_om_approves', 'desktop');
    const q = d.page;
    await signIn(q, `${KRW}-om2`);
    await tap(q, id(q, `v5-open-${codeA}`));
    await expect(id(q, 'v5-approve')).toBeVisible();
    await hold(q);
    await glide(q, id(q, 'v5-approve'));
    await type(q, id(q, 'v5-reason'), 'Biaya dan ukuran sudah sesuai.');
    await tap(q, id(q, 'v5-approve'));
    await confirmPin(q, `${KRW}-om2`);
    await expect(id(q, 'v5-state-label')).toHaveText('Penanganan disetujui');
    d.mark('approved_with_pin');
    await hold(q, 1800);
    await q.locator('select[data-testid="v6-executor-type"]').selectOption('CONTRACT');
    await type(q, id(q, 'v6-executor-name'), 'CV Karya Marga');
    await type(q, id(q, 'v6-package-id'), 'PKT-PJL-2026-014');
    await q.locator('select[data-testid="v5-supervisor"]').selectOption(`${KRW}-fe2`);
    await tap(q, id(q, 'v5-issue-work-order'));
    await expect(id(q, 'v6-badge-code')).toBeVisible();
    guestCode = (await id(q, 'v6-badge-code').innerText()).trim();
    d.mark('guest_code_qr');
    await glide(q, id(q, 'v6-badge'));
    await hold(q, 3000);
    await still(q, 'om-guest-code');
    scenes['05_approval_sod'] = { refusalText: refusal, guestCodeExpiry: 'Berakhir saat perbaikan diverifikasi; paling lama 180 hari', workOrder: (await caseOf(q, codeA)).workOrder };
    await d.finish();
  }

  // ---- 06 Contractor, then the other FE
  {
    const c = await clip(browser, '06a_contractor', 'phone', { camera: ['repair_0', 'repair_1', 'repair_2', 'repair_3', 'repair_4', 'repair_5', 'repair_6', 'repair_7', 'repair_8', 'repair_10'], at: A });
    const p = c.page;
    await p.goto('/login/');
    await type(p, id(p, 'v6-code'), guestCode);
    await tap(p, id(p, 'v6-code-next'));
    await p.waitForURL(/kerja/);
    await hold(p, 1800);
    c.mark('one_work_order');
    await still(p, 'contractor-home');
    await tap(p, id(p, `v5-open-${codeA}`));
    await expect(id(p, 'v5-case-head')).toBeVisible();
    await hold(p);
    const stage = async (name: string, values: Record<string, string> = {}, wait = 300) => {
      await tap(p, id(p, `v5-stage-${name}`));
      for (const [k, v] of Object.entries(values)) await type(p, id(p, `v5-value-${k}`), v);
      await shoot(p);
      await expect(p.locator(`li[data-stage="${name}"]`)).toHaveAttribute('data-done', 'true');
      c.mark(`stage_${name}`);
      await hold(p, wait);
    };
    await stage('BEFORE');
    await stage('CUT_EDGES', { cutLengthCm: '140', cutWidthCm: '120' });
    await tap(p, id(p, 'v5-start-work'));
    await expect(id(p, 'v5-state-label')).toHaveText('Sedang diperbaiki');
    await stage('CLEAN_DRY');
    await stage('TACK_COAT', { material: 'CSS-1' });
    await stage('DELIVERY_TICKET', { mixType: 'AC-WC', weightKg: '300' });
    await stage('MIX_TEMP_TRUCK', { temperatureC: '142' });
    await stage('MIX_TEMP_MAT', { temperatureC: '128' });
    await stage('LOOSE_THICKNESS', { thicknessMm: '55' });
    await stage('COMPACTION', { passes: '6' });
    await stage('AFTER');
    await type(p, id(p, 'v5-tonnage'), '300');
    await type(p, id(p, 'v5-spend'), '1200000');
    await hold(p);
    await still(p, 'contractor-evidence', true);
    await tap(p, id(p, 'v5-submit-work'));
    await expect(id(p, 'v5-state-label')).toHaveText('Menunggu pemeriksaan hasil');
    c.mark('evidence_submitted');
    await hold(p, 2000);
    await c.finish();

    const d = await clip(browser, '06b_fe_verify', 'phone', { camera: ['repair_11'], at: A });
    const q = d.page;
    await signIn(q, `${KRW}-fe2`);
    await tap(q, id(q, 'v6-tab-work'));
    await tap(q, id(q, `v5-open-${codeA}`));
    await expect(id(q, 'v5-shutter')).toBeEnabled();
    await shoot(q);
    await expect(id(q, 'v5-own-photo')).toBeVisible();
    d.mark('own_photo');
    await hold(q, 1800);
    await tap(q, id(q, 'v5-verify-work'));
    await expect(id(q, 'v5-state-label')).toHaveText('Hasil diperiksa pengawas');
    d.mark('verified');
    await hold(q, 1500);
    await glide(q, id(q, 'v6-ai-before-after'));
    const ba = await id(q, 'v6-ai-before-after').innerText();
    d.mark('before_after_location');
    await hold(q, 2500);
    await d.finish();

    await offCamera(browser, `${KRW}-om2`, codeA, async (o) => {
      await id(o, 'v5-reason').fill('Pengawas sudah memeriksa semua tahap.');
      await id(o, 'v6-pho-date').fill(new Date().toISOString().slice(0, 10));
      await id(o, 'v5-accept-work').click();
      await expect(id(o, 'v5-state-label')).toHaveText('Diperbaiki — dipantau');
    });

    const e = await clip(browser, '06c_guest_code_ended_followups', 'phone', { storage: citizenState });
    await e.page.goto('/login/');
    await type(e.page, id(e.page, 'v6-code'), guestCode);
    await tap(e.page, id(e.page, 'v6-code-next'));
    await expect(id(e.page, 'v6-login-error')).toContainText('tidak berlaku');
    e.mark('guest_code_ended');
    await hold(e.page, 2200);
    await e.page.goto(`/pantau/${codeA}/`);
    await expect(id(e.page, 'v5-state-label')).toHaveText('Diperbaiki — dipantau');
    await glide(e.page, e.page.locator('li[data-milestone="M1"]'));
    e.mark('followup_schedule');
    await hold(e.page, 3000);
    const track = await e.page.evaluate(async (k) => (await (await fetch(`/api/v5/public/track/${k}`)).json()).data, codeA);
    scenes['06_contractor_verify'] = { beforeAfter: ba, followUps: track.followUps };
    await e.finish();
  }

  }

  // ---- 07 Auditor
  let docId = '';
  let pdfBytes: Buffer | null = null;
  {
    const c = await clip(browser, '07_auditor_verify', 'desktop');
    const p = c.page;
    await signIn(p, `${KRW}-auditor`);
    await tap(p, id(p, 'v6-side-audit'));
    await expect(id(p, 'v6-chain-status')).toContainText('Utuh');
    c.mark('chain_intact');
    await hold(p, 2500);
    await glide(p, id(p, 'v6-anomalies'));
    c.mark('findings');
    await hold(p, 2800);
    await still(p, 'auditor-findings');
    const ca = await caseOf(p, codeA);
    await p.goto(`/kerja/${ca.id}/`);
    await expect(id(p, 'v5-issue-report')).toBeVisible();
    await glide(p, id(p, 'v5-issue-report'));
    await tap(p, id(p, 'v5-issue-report'));
    await confirmPin(p, `${KRW}-auditor`);
    await expect(id(p, 'v5-doc-id')).toContainText(`DOC-${codeA}-v`);
    docId = (await id(p, 'v5-doc-id').innerText()).trim();
    const sha = (await id(p, 'v5-doc-hash').innerText()).trim();
    c.mark('pdf_issued');
    await hold(p, 2500);
    const pdf = await (await p.request.get(`/api/v5/documents/${docId}/pdf`)).body();
    pdfBytes = Buffer.from(pdf);
    await tap(p, id(p, 'v5-doc-verify'));
    await p.waitForURL(/\/v\//);
    await expect(id(p, 'v5-verify-hash')).toBeVisible();
    c.mark('verify_page');
    await hold(p, 2500);
    await p.goto('/kerja/m/report/');
    await expect(id(p, 'v6-report-card')).toBeVisible();
    await hold(p, 1500);
    c.mark('report_card');
    await still(p, 'auditor-report-card');
    await glide(p, id(p, 'v6-rank-executor'));
    await hold(p, 2500);
    const verify = await p.evaluate(async () => (await (await fetch('/api/v5/public/chain/prod/verify')).json()).data);
    scenes['07_auditor_verify'] = { docId, sha256: sha, shortHash: sha.slice(0, 12), chain: verify };
    await c.finish();
  }

  // ---- 07b Price import
  {
    const c = await clip(browser, '07b_price_import', 'desktop');
    const p = c.page;
    await signIn(p, `${KRW}-om1`);
    await tap(p, id(p, 'v6-side-cost'));
    await glide(p, id(p, 'v6-price-import'));
    const lines = fs.readFileSync('docs/v6/data/prices/price_book_regional_2026.csv', 'utf8').split(/\r?\n/);
    const real = [lines[0], ...lines.filter((l) => l.startsWith('3215,') && /,paving,/.test(l))].join('\n');
    await id(p, 'v6-import-file').setInputFiles({ name: 'hspk-karawang-paving-2026.csv', mimeType: 'text/csv', buffer: Buffer.from(real) });
    await hold(p, 1200);
    await tap(p, id(p, 'v6-import-send'));
    await confirmPin(p, `${KRW}-om1`);
    await expect(id(p, 'v6-import-result')).toBeVisible();
    c.mark('imported');
    await hold(p, 2800);
    await still(p, 'om-price-import');
    scenes['07b_price_import'] = { rows: await id(p, 'v6-import-result').innerText(), source: 'Baris paving Karawang yang sama persis dari Perbup Karawang 28/2025' };
    await c.finish();
  }

  // ---- 07c The real report and a byte-modified copy
  {
    const good = pdfBytes!;
    const bad = Buffer.from(good);
    bad[Math.floor(bad.length / 2)] ^= 0xff;
    const left = await clip(browser, '07c_verify_original', 'phone');
    await left.page.goto(`/v/${docId}/`);
    await expect(id(left.page, 'v5-verify-file-input')).toBeAttached();
    await glide(left.page, id(left.page, 'v5-verify-file'));
    await hold(left.page, 1200);
    await id(left.page, 'v5-verify-file-input').setInputFiles({ name: 'laporan-audit.pdf', mimeType: 'application/pdf', buffer: good });
    await expect(id(left.page, 'v5-file-result')).toContainText('✓');
    left.mark('result');
    const leftText = await id(left.page, 'v5-file-result').innerText();
    await hold(left.page, 3500);
    await left.finish();
    const right = await clip(browser, '07c_verify_modified', 'phone');
    await right.page.goto(`/v/${docId}/`);
    await glide(right.page, id(right.page, 'v5-verify-file'));
    await hold(right.page, 1200);
    await id(right.page, 'v5-verify-file-input').setInputFiles({ name: 'laporan-audit-salinan.pdf', mimeType: 'application/pdf', buffer: bad });
    await expect(id(right.page, 'v5-file-result')).not.toContainText('✓');
    right.mark('result');
    const rightText = await id(right.page, 'v5-file-result').innerText();
    await hold(right.page, 3500);
    await right.finish();
    scenes['07c_verify_tampered'] = { original: leftText, modified: rightText, bytesChanged: 1 };
  }

  // ---- 07d Neutral wording
  {
    const c = await clip(browser, '07d_neutral_copilot', 'desktop');
    const p = c.page;
    await signIn(p, `${KRW}-auditor`);
    const ca = await caseOf(p, codeA);
    await p.goto(`/kerja/${ca.id}/`);
    await glide(p, id(p, 'v5-flag-note'));
    const typed = 'Harga ini mark-up dan kontraktor curang';
    await type(p, id(p, 'v5-flag-note'), typed);
    await hold(p, 1500);
    await tap(p, id(p, 'v6-neutralize'));
    await expect(id(p, 'v6-neutral-done')).toBeVisible();
    const rewritten = await id(p, 'v5-flag-note').inputValue();
    c.mark('rewritten');
    await hold(p, 3000);
    await tap(p, id(p, 'v5-add-flag'));
    await p.waitForTimeout(1500);
    c.mark('saved');
    scenes['07d_neutral_copilot'] = { typed, rewritten, engine: 'Aturan daftar kata (config/wording), bukan GenAI' };
    await c.finish();
  }

  // ---- 08 Citizen again
  {
    const c = await clip(browser, '08_citizen_confirm', 'phone', { storage: citizenState, at: A });
    const p = c.page;
    await p.goto('/notifikasi/');
    await hold(p, 3500);
    c.mark('notifications');
    await still(p, 'citizen-notifications');
    await p.goto(`/pantau/${codeA}/`);
    await expect(id(p, 'v5-state-label')).toBeVisible();
    c.mark('timeline');
    await hold(p, 2000);
    await glide(p, id(p, 'v5-still-fixed'));
    await tap(p, id(p, 'v5-still-fixed'));
    await expect(id(p, 'v5-confirm')).toContainText('Masih bagus: 1');
    c.mark('still_good');
    await hold(p, 2200);
    await still(p, 'citizen-timeline', true);
    await p.goto('/laporanku/');
    await hold(p, 2500);
    await glide(p, id(p, 'v6-contribution-count'));
    await type(p, id(p, 'v6-certificate-name'), 'Ayu Lestari');
    await tap(p, id(p, 'v6-certificate-make'));
    await expect(id(p, 'v6-certificate')).toBeVisible();
    c.mark('certificate');
    await hold(p, 2500);
    await glide(p, id(p, 'v6-public-rankings'));
    c.mark('public_service_ranking');
    await hold(p, 3000);
    await still(p, 'citizen-contribution', true);
    await c.finish();
  }

  // ---- Owner colours on the map, and the citizen's own screens
  {
    const c = await clip(browser, '03c_owner_map', 'phone', { at: A, storage: citizenState });
    const p = c.page;
    await p.goto('/peta/');
    await hold(p, 5000);
    await p.getByRole('button', { name: 'Tutup' }).first().click({ timeout: 4000 }).catch(() => undefined);
    await tap(p, id(p, 'owners-toggle'));
    await expect(id(p, 'owners-legend')).toBeVisible();
    await p.waitForTimeout(7000);
    c.mark('owner_colours');
    await still(p, 'citizen-owner-map');
    await hold(p, 2000);
    await c.finish();
  }

  // ---- Full-page stills of every main screen per role, 2x
  for (const [who, modules] of Object.entries({ [`${KRW}-om1`]: ['', 'inbox', 'work', 'cost', 'monitor', 'report', 'audit', 'team', 'settings'], [`${KRW}-fe1`]: ['', 'inbox', 'field', 'work', 'cost', 'monitor', 'report'], [`${KRW}-auditor`]: ['', 'inbox', 'work', 'cost', 'monitor', 'report', 'audit', 'team', 'settings'] })) {
    const context = await browser.newContext({ viewport: { width: 1440, height: 900 }, deviceScaleFactor: 2, locale: 'id-ID' });
    const p = await context.newPage();
    await p.goto('/login/');
    await id(p, 'v6-code').fill(ACCESS[who].code);
    await id(p, 'v6-code-next').click();
    await id(p, 'v6-pin').fill(ACCESS[who].pin);
    await id(p, 'v6-pin-ok').click();
    await p.waitForURL(/kerja/);
    const role = who.split('-').pop();
    for (const m of modules) {
      await p.goto(m ? `/kerja/m/${m}/` : '/kerja/');
      await p.waitForTimeout(m === 'inbox' ? 4000 : 1800);
      await still(p, `full-${role}-${m || 'today'}`, true);
    }
    await context.close();
  }

  // ---- UI assets read from the running pages
  {
    const context = await browser.newContext({ viewport: { width: 1280, height: 900 } });
    const p = await context.newPage();
    fs.mkdirSync('capture-kit/ui-assets', { recursive: true });
    await p.goto('/login/');
    await p.waitForTimeout(1500);
    const svgs = await p.locator('svg').evaluateAll((list) => list.map((s) => { const c = s.cloneNode(true) as SVGElement; c.setAttribute('xmlns', 'http://www.w3.org/2000/svg'); return c.outerHTML; }));
    svgs.forEach((svg, i) => fs.writeFileSync(`capture-kit/ui-assets/login-svg-${i}.svg`, svg));
    await context.close();
  }

  save();
});
