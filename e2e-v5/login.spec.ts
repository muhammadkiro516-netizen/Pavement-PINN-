import { expect, test, type Page } from '@playwright/test';

/** Every published test login, typed into the real sign-in form. */
async function signIn(page: Page, email: string, password: string) {
  await page.goto('/login/');
  await page.locator('input[type=email]').fill(email);
  await page.locator('input[type=password]').fill(password);
  await page.locator('button[type=submit]').click();
}

const WORKSPACE: [string, string][] = [
  ['koordinator@pavement-pinn.example', 'ACC-COORD'],
  ['petugas@pavement-pinn.example', 'ACC-INSPECT'],
  ['penyetuju@pavement-pinn.example', 'ACC-APPROVE'],
  ['regu@pavement-pinn.example', 'ACC-CREW'],
  ['pengawas@pavement-pinn.example', 'ACC-SUPERVISE'],
  ['auditor@pavement-pinn.example', 'ACC-AUDIT'],
  ['pimpinan@pavement-pinn.example', 'ACC-HEAD'],
  ['admin@pavement-pinn.example', 'ACC-ADMIN']
];

for (const [email, account] of WORKSPACE) {
  test(`form login: ${email} opens its role`, async ({ page }) => {
    await signIn(page, email, 'PinnUji2026!');
    await page.waitForURL(/peran/);
    await expect(page.getByTestId('v5-role-switch')).toHaveValue(account);
  });
}

const ORIGINAL: [string, string, RegExp][] = [
  ['hendra.gunawan@pavement-pinn.example', 'OpsPinn2026!', /Alur kerja koordinator|Sekitar Anda/],
  ['ahmad.subagyo@pavement-pinn.example', 'FieldPinn2026!', /Alur kerja petugas|Sekitar Anda/]
];

for (const [email, password, text] of ORIGINAL) {
  test(`form login: ${email} opens the original screens`, async ({ page }) => {
    await signIn(page, email, password);
    await page.waitForURL((url) => !url.pathname.includes('login'), { timeout: 20_000 });
    await expect(page.locator('body')).toContainText(text);
  });
}

test('a wrong password is refused with a clear message', async ({ page }) => {
  await signIn(page, 'auditor@pavement-pinn.example', 'salah');
  await expect(page.locator('body')).toContainText('Email atau kata sandi salah');
});
