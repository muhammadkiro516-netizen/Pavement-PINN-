import { expect, test, type Page } from '@playwright/test';

const id = (page: Page, testId: string) => page.getByTestId(testId);

async function asRole(page: Page, accountId: string) {
  await id(page, 'v5-role-switch').selectOption(accountId);
  await expect(id(page, 'v5-role-switch')).toHaveValue(accountId);
}

async function openCase(page: Page, code: string) {
  await page.goto('/v5/');
  await id(page, `v5-open-${code}`).click();
  await expect(id(page, 'v5-case-head')).toBeVisible();
}

const sample = (page: Page) => id(page, 'v5-use-sample').click();

async function report(page: Page): Promise<string> {
  await page.goto('/v5/');
  await asRole(page, 'CITIZEN');
  await id(page, 'v5-report-damage').click();
  await id(page, 'v5-mode-single').click();
  await sample(page);
  await expect(id(page, 'v5-detection')).toBeVisible();
  await id(page, 'v5-band-M').click();
  await expect(id(page, 'v5-routing')).toBeVisible();
  await id(page, 'v5-send').click();
  await expect(id(page, 'v5-tracking-code')).toBeVisible();
  return (await id(page, 'v5-tracking-code').innerText()).trim();
}

test('golden path, steps 1 to 9, on a phone viewport', async ({ page, request }) => {
  const consoleErrors: string[] = [];
  page.on('pageerror', (e) => consoleErrors.push(e.message));

  // 1. Citizen, no login: sample photo stamped DEMO, AI box, tracking code.
  await page.goto('/v5/');
  await expect(id(page, 'v5-demo-banner')).toContainText('DEMO MODE');
  await id(page, 'v5-report-damage').click();
  await id(page, 'v5-mode-single').click();
  await expect(id(page, 'v5-capture')).toBeVisible();
  await sample(page);
  await expect(id(page, 'v5-detection')).toContainText('DEMO — not a live capture');
  await id(page, 'v5-band-M').click();

  // 2. Routing: snapped to a road, with the agency in charge.
  await expect(id(page, 'v5-office-name')).toContainText(/Bina Marga/);
  await id(page, 'v5-send').click();
  const code = (await id(page, 'v5-tracking-code').innerText()).trim();
  expect(code).toMatch(/^JKT-/);

  // 3. Coordinator: priority queue with reasons, then assign the inspector.
  await asRole(page, 'ACC-COORD');
  const row = page.locator(`li[data-code="${code}"]`);
  await expect(row.getByTestId('v5-priority-reasons')).toContainText('Pothole');
  await id(page, `v5-open-${code}`).click();
  await id(page, 'v5-reason').fill('Photo shows a pothole on this road.');
  await id(page, 'v5-accept-assign').click();
  await expect(id(page, 'v5-state-label')).toHaveText('Inspection scheduled');

  // 4. Inspector: confirm AI, marker card size, ruler depth.
  await asRole(page, 'ACC-INSPECT');
  await openCase(page, code);
  for (const title of ['1. Overview', '2. Marker card', '3. Ruler at the deepest point']) {
    await expect(id(page, 'v5-capture')).toContainText(title);
    await sample(page);
  }
  await expect(id(page, 'v5-marker-found')).toHaveText('found');
  await id(page, 'v5-length').fill('80');
  await id(page, 'v5-width').fill('60');
  await id(page, 'v5-depth').fill('45');
  await id(page, 'v5-submit-inspection').click();
  await expect(id(page, 'v5-state-label')).toHaveText('Inspection done');
  await expect(id(page, 'v5-measurements')).toContainText('45 mm');
  await expect(id(page, 'v5-measurements')).toContainText('MEASURED');

  await asRole(page, 'ACC-COORD');
  await openCase(page, code);
  await id(page, 'v5-reason').fill('Measurements and photos are complete.');
  await id(page, 'v5-verify-inspection').click();
  await expect(id(page, 'v5-state-label')).toHaveText('Inspection checked');

  // PINN gives a P10 to P90 range, the fair-cost range has a label on every input.
  await asRole(page, 'ACC-INSPECT');
  await openCase(page, code);
  await id(page, 'v5-esal').fill('250000');
  await id(page, 'v5-run-pinn').click();
  await expect(id(page, 'v5-pinn-range')).toContainText('months');
  await expect(id(page, 'v5-pinn')).toContainText('INPUT');
  await expect(id(page, 'v5-pinn')).toContainText('ASSUMED');
  await id(page, 'v5-run-cost').click();
  await expect(id(page, 'v5-cost-range')).toContainText('Rp');
  await id(page, 'v5-cost-inputs-toggle').click();
  for (const label of ['MEASURED', 'OFFICIAL', 'ASSUMED', 'TODO VERIFY']) await expect(id(page, 'v5-cost-inputs')).toContainText(label);
  await id(page, 'v5-rationale').fill('Pothole in the wheel path. Full-depth patch.');
  await id(page, 'v5-propose-plan').click();
  await expect(id(page, 'v5-state-label')).toHaveText('Repair plan proposed');

  // 5. The server blocks approval by the person who recommended the plan.
  await asRole(page, 'ACC-INSPECT-AS-APPROVER');
  await openCase(page, code);
  await id(page, 'v5-reason').fill('Fair cost and measurements look right.');
  await id(page, 'v5-approve').click();
  await expect(id(page, 'v5-error')).toContainText('SOD-2');
  await expect(id(page, 'v5-error')).toContainText('You inspected this case');
  await expect(id(page, 'v5-state-label')).toHaveText('Repair plan proposed');

  await asRole(page, 'ACC-APPROVE');
  await openCase(page, code);
  await id(page, 'v5-reason').fill('Fair cost and measurements look right.');
  await id(page, 'v5-approve').click();
  await expect(id(page, 'v5-state-label')).toHaveText('Repair plan approved');

  await asRole(page, 'ACC-COORD');
  await openCase(page, code);
  await id(page, 'v5-issue-work-order').click();
  await expect(id(page, 'v5-state-label')).toHaveText('Repair scheduled');

  // 6. Crew: before, during and after evidence checklist.
  await asRole(page, 'ACC-CREW');
  await openCase(page, code);
  const stage = async (code_: string, values: Record<string, string> = {}) => {
    await id(page, `v5-stage-${code_}`).click();
    for (const [k, v] of Object.entries(values)) await id(page, `v5-value-${k}`).fill(v);
    await sample(page);
    await expect(page.locator(`li[data-stage="${code_}"]`)).toHaveAttribute('data-done', 'true');
  };
  await stage('BEFORE');
  await stage('CUT_EDGES', { cutLengthCm: '140', cutWidthCm: '120' });
  await id(page, 'v5-start-work').click();
  await expect(id(page, 'v5-state-label')).toHaveText('Being repaired');
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
  await id(page, 'v5-submit-work').click();
  await expect(id(page, 'v5-state-label')).toHaveText('Waiting for repair check');

  // 7. Supervisor checks, Approver accepts, the case goes under watch with its schedule.
  await asRole(page, 'ACC-SUPERVISE');
  await openCase(page, code);
  await sample(page);
  await expect(id(page, 'v5-own-photo')).toBeVisible();
  await id(page, 'v5-verify-work').click();
  await expect(id(page, 'v5-state-label')).toHaveText('Repair checked by supervisor');

  await asRole(page, 'ACC-APPROVE');
  await openCase(page, code);
  await id(page, 'v5-reason').fill('The supervisor checked every stage.');
  await id(page, 'v5-accept-work').click();
  await expect(id(page, 'v5-state-label')).toHaveText('Repaired — under watch');

  // 8. Citizen: public timeline, follow-ups at 1, 3, 6 months and heavy rain, can confirm.
  await asRole(page, 'CITIZEN');
  await page.goto(`/v5/t/${code}`);
  await expect(id(page, 'v5-state-label')).toHaveText('Repaired — under watch');
  for (const step of ['Citizen report received', 'Accepted by the agency', 'Repair plan approved', 'Repair accepted. Under watch']) await expect(id(page, 'v5-timeline')).toContainText(step);
  for (const m of ['M1', 'M3', 'M6', 'HEAVY_RAIN']) await expect(page.locator(`li[data-milestone="${m}"]`)).toBeVisible();
  await id(page, 'v5-still-fixed').click();
  await expect(id(page, 'v5-confirm')).toContainText('Still fixed: 1');
  // No staff or reporter data on the public page.
  await expect(page.locator('body')).not.toContainText('Demo Field Inspector');

  // 9. Auditor: read-only, report PDF, verify page, tamper check.
  await asRole(page, 'ACC-AUDIT');
  await openCase(page, code);
  await expect(id(page, 'v5-chain-status')).toContainText('Intact');
  await id(page, 'v5-tamper').click();
  await expect(id(page, 'v5-tamper-result')).toContainText('verification fails');
  await id(page, 'v5-issue-report').click();
  await expect(id(page, 'v5-doc-id')).toContainText(`DOC-${code}-v1`);
  const sha = (await id(page, 'v5-doc-hash').innerText()).trim();
  const docId = (await id(page, 'v5-doc-id').innerText()).trim();

  const pdf = await request.get(`/api/v5/documents/${docId}/pdf`);
  expect(pdf.ok()).toBeTruthy();
  const bytes = await pdf.body();
  expect(bytes.subarray(0, 5).toString()).toBe('%PDF-');

  await page.goto(`/v/${docId}`);
  await expect(id(page, 'v5-verify-summary')).toContainText('All integrity checks passed');
  await expect(id(page, 'v5-verify-demo')).toContainText('This is a demo document');
  await expect(id(page, 'v5-verify-hash')).toHaveText(sha);
  await id(page, 'v5-verify-file-input').setInputFiles({ name: 'report.pdf', mimeType: 'application/pdf', buffer: bytes });
  await expect(id(page, 'v5-file-result')).toContainText('matches the issued document');
  const altered = Buffer.from(bytes);
  altered[altered.length - 20] ^= 1;
  await id(page, 'v5-verify-file-input').setInputFiles({ name: 'edited.pdf', mimeType: 'application/pdf', buffer: altered });
  await expect(id(page, 'v5-file-result')).toContainText('different from the issued document');

  expect(consoleErrors).toEqual([]);
});

test('live camera path: a real getUserMedia frame goes through nonce, blur and AI', async ({ page }) => {
  await page.goto('/v5/');
  await asRole(page, 'CITIZEN');
  await id(page, 'v5-demo-toggle').uncheck();
  await id(page, 'v5-report-damage').click();
  await id(page, 'v5-mode-single').click();
  await expect(id(page, 'v5-use-sample')).toHaveCount(0);
  await expect(page.locator('input[type=file]')).toHaveCount(0);
  await expect(id(page, 'v5-gps')).toContainText('GPS accuracy 8 m');
  await expect(id(page, 'v5-shutter')).toBeEnabled();
  await id(page, 'v5-shutter').click();
  await expect(id(page, 'v5-detection')).toBeVisible();
  await expect(id(page, 'v5-detection')).not.toContainText('not a live capture');
  await id(page, 'v5-band-S').click();
  await id(page, 'v5-send').click();
  const code = (await id(page, 'v5-tracking-code').innerText()).trim();
  await id(page, 'v5-open-tracking').click();
  await expect(id(page, 'v5-track-code')).toHaveText(code);
  await expect(id(page, 'v5-track-head')).not.toContainText('not a live capture');
  await id(page, 'v5-demo-toggle').check();
});

test('long damage: walk with Start and End, length shown, photos required', async ({ page }) => {
  await page.goto('/v5/');
  await asRole(page, 'CITIZEN');
  await id(page, 'v5-report-damage').click();
  await id(page, 'v5-mode-long').click();
  await id(page, 'v5-trace-sample').click();
  await expect(id(page, 'v5-trace-length')).toContainText('m');
  await sample(page);
  await expect(id(page, 'v5-trace-end')).toBeDisabled();
  for (let i = 0; i < 2; i++) {
    await id(page, 'v5-trace-photo').click();
    await sample(page);
  }
  await id(page, 'v5-trace-end').click();
  await expect(id(page, 'v5-walk-summary')).toContainText('ASSUMED');
  await expect(id(page, 'v5-routing')).toBeVisible();
  await id(page, 'v5-send').click();
  await id(page, 'v5-open-tracking').click();
  await expect(id(page, 'v5-track-head')).toContainText('Length');
});

test('escalation: day 2, 7, 14, 30 become visible with the labelled fast-forward', async ({ page }) => {
  const code = await report(page);
  await id(page, 'v5-open-tracking').click();
  await expect(id(page, 'v5-fast-forward')).toContainText('Only in demo mode');
  const reached = () => page.locator('.v5-ladder li[data-reached="true"]');
  await expect(reached()).toHaveCount(0);
  await id(page, 'v5-ff-2').click();
  await expect(reached()).toHaveCount(1);
  await id(page, 'v5-ff-7').click();
  await expect(reached()).toHaveCount(2);
  await id(page, 'v5-ff-7').click();
  await expect(reached()).toHaveCount(3);
  await expect(id(page, 'v5-complaint')).toHaveCount(0);
  await id(page, 'v5-ff-30').click();
  await expect(reached()).toHaveCount(4);
  await expect(id(page, 'v5-complaint')).toBeVisible();
  await expect(id(page, 'v5-timeline')).toContainText('DEMO: time fast-forwarded');
  const draft = await page.request.get(`/api/v5/public/track/${code}/complaint-draft`);
  expect(await draft.text()).toContain('DEMO — BUKAN DATA NYATA');
});

test('routing: low confidence asks the coordinator; a transfer must cite the decree', async ({ page, context }) => {
  // A trunk road in Jakarta: it may be national, so the coordinator is asked.
  await context.setGeolocation({ latitude: -6.2006, longitude: 106.8574, accuracy: 8 });
  const code = await report(page);
  await asRole(page, 'ACC-COORD');
  await openCase(page, code);
  await id(page, 'v5-transfer-toggle').click();
  await id(page, 'v5-reason').fill('This road is on the national list.');
  await id(page, 'v5-transfer').click();
  await expect(id(page, 'v5-error')).toContainText('SK citation required');
  await id(page, 'v5-decree-number').fill('Kepmen PUPR 1688/KPTS/M/2022');
  await id(page, 'v5-decree-date').fill('2022-12-30');
  await id(page, 'v5-transfer').click();
  await expect(id(page, 'v5-transfer-pending')).toContainText('BBPJN');
  // The same person cannot confirm their own cross-level transfer.
  await id(page, 'v5-reason').fill('Confirming the transfer myself.');
  await id(page, 'v5-confirm-transfer').click();
  await expect(id(page, 'v5-error')).toContainText('SOD-7');
  await asRole(page, 'ACC-COORD-2');
  await openCase(page, code);
  await id(page, 'v5-reason').fill('The decree lists this road as national.');
  await id(page, 'v5-confirm-transfer').click();
  await expect(id(page, 'v5-case-routing')).toContainText('BBPJN');
});

test('nine roles are reachable, and auditor and admin have no case actions', async ({ page }) => {
  await page.goto('/v5/');
  const options = await id(page, 'v5-role-switch').locator('option').allTextContents();
  for (const name of ['Citizen', 'Field Inspector', 'Coordinator', 'Approving Officer', 'Repair Crew', 'Supervisor', 'Auditor', 'Agency Head', 'Region Admin']) {
    expect(options.join(' | ')).toContain(name);
  }
  await asRole(page, 'ACC-HEAD');
  await expect(id(page, 'v5-head')).toContainText('All cases');
  await asRole(page, 'ACC-ADMIN');
  await expect(id(page, 'v5-admin')).toContainText('Road registry');
  await asRole(page, 'ACC-AUDIT');
  await expect(id(page, 'v5-queue')).toContainText('You cannot change a case');
});

test('tour runs in six steps inside 60 seconds; why and measurements carry labels', async ({ page }) => {
  const started = Date.now();
  await page.goto('/tour');
  await expect(id(page, 'v5-tour')).toBeVisible();
  for (let i = 0; i < 5; i++) await id(page, 'v5-tour-next').click();
  await expect(id(page, 'v5-tour-caption')).toContainText('Every step is sealed');
  await expect(id(page, 'v5-tour-end')).toBeVisible();
  expect(Date.now() - started).toBeLessThan(60_000);

  await page.goto('/why');
  expect(await id(page, 'v5-fact').count()).toBeGreaterThan(10);
  for (const fact of await id(page, 'v5-fact').all()) await expect(fact).toContainText('Source:');

  await page.goto('/v5/measurements');
  await expect(page.locator('[data-testid=v5-measure-row][data-measured=false]').first()).toContainText('Not measured yet');
  await expect(page.locator('[data-testid=v5-measure-row][data-measured=true]').first()).toContainText('MEASURED');
});

test('map colours roads by owner', async ({ page }) => {
  await page.goto('/v5/map');
  await expect(id(page, 'v5-legend')).toContainText('Provincial road');
  await expect(id(page, 'v5-map-count')).toContainText(/[1-9]\d* road pieces/);
  await expect(page.locator('.v5-map path.leaflet-interactive').first()).toBeVisible();
});

test('reduced motion: animations are effectively off', async ({ browser }) => {
  const context = await browser.newContext({ reducedMotion: 'reduce', baseURL: process.env.V5_BASE_URL ?? 'http://localhost:3100' });
  const page = await context.newPage();
  await page.goto('/v5/');
  await expect(id(page, 'v5-home')).toBeVisible();
  const duration = await id(page, 'v5-home').evaluate((el) => getComputedStyle(el).animationDuration);
  expect(parseFloat(duration)).toBeLessThan(0.01);
  await context.close();
});
