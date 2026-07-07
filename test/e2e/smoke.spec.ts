import { test, expect, type Page } from '@playwright/test';

// brief pause after each test so a slowed-down run is easy to observe (skipped when SLOWMO unset)
test.afterEach(async ({ page }) => {
  if (process.env.SLOWMO) {
    await page.waitForTimeout(2000);
  }
});

// Playwright's slowMo launch option (set via SLOWMO, see playwright.config.ts) only delays
// real browser input actions (click, fill, ...) -- it has no effect on page.request.*
// calls, since those go straight over HTTP without touching the browser at all. Gated the
// same way so headless/CI runs stay fast.
const pause = (page: Page) => process.env.SLOWMO ? page.waitForTimeout(1000) : Promise.resolve();

test('front page loads, shows seeded entries, and records a journal entry', async ({ page }) => {
  await page.goto('/');

  // app shell is up (mock auth renders the signed-in dashboard, not the marketing page)
  await expect(page).toHaveTitle(/MotoGPT/);
  await expect(page.getByText('Charts', { exact: true })).toBeVisible();

  // each chart (DailyGauge, HourlyPatternChart, DailySummaryChart) mounts an echarts
  // <canvas> inside a .Chart div
  const charts = page.locator('.Chart canvas');
  await expect(charts.first()).toBeVisible({ timeout: 15_000 });
  expect(await charts.count()).toBeGreaterThanOrEqual(3);
  await pause(page);

  // the Entries section is backed by services/stores/memory.ts's seeded Log history for
  // the impersonated smoke-test user
  await expect(page.getByText('Chain cleaned and lubed after the weekend ride.')).toBeVisible();
  await pause(page);

  // record a journal entry through the real dialog flow, not a direct API call
  const entryText = `smoke test entry ${Date.now()}`;
  await page.getByRole('button', { name: 'Journal Entry' }).click();
  // getByRole (not getByLabel) -- the dialog's own accessible name "Journal Entry"
  // substring-matches "Entry" too
  await page.getByRole('textbox', { name: 'Entry' }).fill(entryText);
  await pause(page);

  const addResponsePromise = page.waitForResponse((res) =>
    res.url().includes('/api/logs') && res.request().method() === 'POST');
  await page.getByRole('button', { name: 'Save' }).click();
  const { log } = await (await addResponsePromise).json();
  expect(log?.type).toBe('journal');
  expect(log?.entry).toBe(entryText);
  await pause(page);

  // wait for the dialog to finish closing first -- until it unmounts, its textarea also
  // matches the entry text and getByText would fail on a strict-mode violation
  await expect(page.getByRole('dialog')).toHaveCount(0);

  // the new entry shows up in the dashboard's Entries section
  await expect(page.getByText(entryText)).toBeVisible();
  await pause(page);

  // cleanup so repeated runs against the same long-lived in-memory store don't accumulate
  // entries indefinitely
  await page.request.delete(`/api/logs/${log.id}`);
});

test('Tailwind theme utilities are actually compiled into the page', async ({ page }) => {
  // Regression guard for the Tailwind v4 migration (JS config -> CSS-first @theme in
  // app/globals.css): if the @theme block's --color-* tokens ever stop generating
  // utilities (or the @plugin "tailwindcss-animate" line stops loading), buttons would
  // silently fall back to unstyled browser defaults -- a transparent background here
  // would mean the CSS pipeline produced no styles at all, not just a wrong color.
  await page.goto('/');
  const button = page.getByRole('button', { name: 'Journal Entry' });
  await expect(button).toBeVisible();

  const backgroundColor = await button.evaluate((el) => getComputedStyle(el).backgroundColor);
  expect(backgroundColor).not.toBe('rgba(0, 0, 0, 0)');
  expect(backgroundColor).not.toBe('');

  const borderRadius = await button.evaluate((el) => getComputedStyle(el).borderRadius);
  expect(borderRadius).not.toBe('0px');
});

test('a failed query surfaces a sonner toast', async ({ page }) => {
  await page.goto('/');
  await expect(page.getByText('Charts', { exact: true })).toBeVisible();

  // app/signed-in-page.tsx wires react-query's QueryCache onError straight to
  // sonner's toast.error() -- a vehicle id that doesn't exist 404s and should
  // surface a toast, not just a silent console error. React Query retries failed
  // queries a few times with backoff before onError fires, so this needs a longer
  // timeout than the default 5s.
  await page.goto('/vehicles/does-not-exist');
  await expect(page.locator('[data-sonner-toast]')).toBeVisible({ timeout: 15_000 });
  await expect(page.locator('[data-sonner-toast]')).toContainText('An error occured');
});
