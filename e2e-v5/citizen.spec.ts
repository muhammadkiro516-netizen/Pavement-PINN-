import { expect, test, type Page } from '@playwright/test';

/** Citizen on the original screens: Prompt 2. Screenshots go to test-results/restore/citizen. */
const OUT = 'test-results/restore/citizen';

async function enterAsCitizen(page: Page) {
  // First-visit coach screens are covered by the original UI; these tests start after them.
  await page.addInitScript(() => {
    localStorage.setItem('pp-onboarded', '1');
    localStorage.setItem('pp-map-coach', '1');
  });
  await page.goto('/beranda/');
  await page.getByRole('button', { name: 'Laporkan jalan rusak' }).first().click();
  await page.waitForURL(/peta/, { timeout: 30_000 });
}

test('road owner colours on the map, with a plain legend', async ({ page }) => {
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await enterAsCitizen(page);
  await page.getByRole('button', { name: 'Tutup' }).first().click(); // The report sheet opens first.
  await expect(page.getByTestId('owners-toggle')).toBeVisible();
  await page.getByTestId('owners-toggle').click();
  await expect(page.getByTestId('owners-legend')).toContainText('Provinsi');
  await page.waitForTimeout(7000);
  const shot = await page.screenshot({ path: `${OUT}/peta-pemilik-jalan.png` });
  await expect(page.getByTestId('owners-legend')).toContainText('Ketuk jalan');
  // The roads must really be coloured: count provincial-orange pixels below the legend.
  const orange = await page.evaluate(async (b64) => {
    const img = new Image();
    img.src = `data:image/png;base64,${b64}`;
    await img.decode();
    const canvas = document.createElement('canvas');
    canvas.width = img.width;
    canvas.height = img.height;
    const g = canvas.getContext('2d')!;
    g.drawImage(img, 0, 0);
    const top = Math.round(img.height * 0.32);
    const bottom = Math.round(img.height * 0.68);
    const { data } = g.getImageData(0, top, img.width, bottom - top);
    let n = 0;
    for (let i = 0; i < data.length; i += 4) if (data[i] > 200 && data[i + 1] > 70 && data[i + 1] < 140 && data[i + 2] < 90) n++;
    return n;
  }, shot.toString('base64'));
  expect(orange).toBeGreaterThan(150);
  expect(errors).toEqual([]);
});

test('routing service answers in everyday words for the report screens', async ({ page, request }) => {
  const reply = await request.get('/api/v5/routing/resolve?lat=-6.2006&lon=106.8574&accuracy=8');
  expect((await reply.json()).data.officeName).toContain('Bina Marga');
  await page.goto('/beranda/');
  await expect(page.locator('body')).not.toContainText('P10');
});

test('long damage: walk first, length grows from real GPS fixes, end opens at 10 m', async ({ page, context }) => {
  await enterAsCitizen(page);
  await expect(page.getByTestId('long-damage-open-input')).toBeVisible();
  await page.screenshot({ path: `${OUT}/lapor-pilihan-panjang.png` });
  await page.getByTestId('long-damage-open-input').click();
  await expect(page.getByTestId('long-walk')).toBeVisible();
  await expect(page.getByTestId('long-walk-start')).toBeEnabled({ timeout: 20_000 });
  await page.screenshot({ path: `${OUT}/panjang-mulai.png` });
  await page.getByTestId('long-walk-start').click();
  for (let i = 1; i <= 5; i++) {
    await context.setGeolocation({ latitude: -6.2006 + i * 0.00004, longitude: 106.8574, accuracy: 6 });
    await page.waitForTimeout(700);
  }
  await expect(page.getByTestId('long-walk-length')).not.toHaveText('0 m');
  await page.screenshot({ path: `${OUT}/panjang-berjalan.png` });
  await expect(page.getByTestId('long-walk-end')).toBeEnabled({ timeout: 10_000 });
  await page.getByTestId('long-walk-end').click();
  // The walk hands over to the live camera, with the original detection effect.
  await expect(page.getByTestId('long-walk')).toHaveCount(0);
  await expect(page.locator('video').first()).toBeVisible({ timeout: 20_000 });
});
