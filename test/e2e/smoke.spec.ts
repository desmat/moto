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

  // app shell is up (mock auth renders the signed-in dashboard, not the marketing page).
  // "Record" is the dashboard-rendered sentinel; the former "Charts" section is
  // deliberately disabled until real reporting lands (see app/page.tsx).
  await expect(page).toHaveTitle(/MotoGPT/);
  await expect(page.getByText('Record', { exact: true })).toBeVisible();
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

test('recent custom log types show as shortcut buttons that prefill the dialog', async ({ page }) => {
  // Per the test-isolation convention, create our OWN custom-typed log rather than
  // asserting on a seeded one: the shortcut row derives from the dashboard's newest
  // entries, and under fullyParallel other specs flood the store with newer logs —
  // seed-derived shortcuts get displaced from that window mid-run (which is exactly
  // how the old seed-based version of this test went flaky after S11's seed retype).
  // A just-created custom type is the newest custom type at assert time; built-in
  // types (journal/mileage/service) created by parallel specs are excluded from the
  // row, so only the 10-newest window matters — and a fresh log sits safely inside it.
  const customType = `smoke shortcut ${Date.now()}`;
  const vehicleRes = await page.request.post('/api/vehicles', {
    data: { vehicle: { type: 'motorcycle', maker: 'Smoke', model: `Shortcut ${Date.now()}`, year: 2024 } },
  });
  const { vehicle } = await vehicleRes.json();
  expect(vehicle?.id).toBeTruthy();

  // Even a just-created log can lose the race when a parallel spec bursts >9 logs
  // between our POST and the page render, so seed-and-check in a loop: each retry
  // re-inserts a log of our type at the top of the window. Converges in one or two
  // attempts in practice.
  const seedLogIds: string[] = [];
  const shortcutButton = page.getByRole('button', { name: customType });
  for (let attempt = 0; attempt < 4; attempt++) {
    const seedRes = await page.request.post('/api/logs', {
      data: { log: { vehicleId: vehicle.id, type: customType, entry: `seed for shortcut test #${attempt}` } },
    });
    const { log: seedLog } = await seedRes.json();
    expect(seedLog?.id).toBeTruthy();
    seedLogIds.push(seedLog.id);

    await page.goto('/');
    if (await shortcutButton.isVisible({ timeout: 3000 }).catch(() => false)) break;
  }
  await expect(shortcutButton).toBeVisible();
  await pause(page);

  // clicking it opens the custom-entry dialog with the type prefilled
  await page.getByRole('button', { name: customType }).click();
  await expect(page.getByRole('dialog', { name: 'Custom Entry' })).toBeVisible();
  await expect(page.getByRole('textbox', { name: 'Type' })).toHaveValue(customType);
  await pause(page);

  // record through the prefilled dialog end-to-end
  const entryText = `smoke test shortcut entry ${Date.now()}`;
  await page.getByRole('textbox', { name: 'Entry' }).fill(entryText);
  const addResponsePromise = page.waitForResponse((res) =>
    res.url().includes('/api/logs') && res.request().method() === 'POST');
  await page.getByRole('button', { name: 'Save' }).click();
  const { log } = await (await addResponsePromise).json();
  expect(log?.type).toBe(customType);
  expect(log?.entry).toBe(entryText);
  await pause(page);

  // cleanup (same reasoning as the journal-entry test above)
  await page.request.delete(`/api/logs/${log.id}`);
  for (const id of seedLogIds) await page.request.delete(`/api/logs/${id}`);
  await page.request.delete(`/api/vehicles/${vehicle.id}`);
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

test('desktop sidebar renders at its configured width', async ({ page }) => {
  // Regression guard for the Tailwind v4 migration: v3's CSS-variable shorthand in
  // arbitrary values (w-[--sidebar-width]) is silently ignored by v4 (the new syntax
  // is w-(--sidebar-width)), which collapsed the sidebar and its layout spacer and
  // slid the page content underneath the fixed sidebar on md+ viewports.
  await page.goto('/');
  await expect(page.getByText('Record', { exact: true })).toBeVisible();

  // the desktop (non-mobile) sidebar panel -- SIDEBAR_WIDTH in components/ui/sidebar.tsx
  const sidebar = page.locator('[data-sidebar="sidebar"]');
  const box = await sidebar.boundingBox();
  // 12rem = 192px, minus the container's 1px border; when the regression hits, the
  // width falls back to the widest nav item (~175px at these font metrics)
  expect(box?.width).toBeGreaterThanOrEqual(190);
  expect(box?.width).toBeLessThanOrEqual(192);

  // and the main content starts to the right of it rather than underneath
  const record = await page.getByText('Record', { exact: true }).boundingBox();
  expect(record!.x).toBeGreaterThan(192);
});

test('a failed query surfaces a sonner toast', async ({ page }) => {
  await page.goto('/');
  await expect(page.getByText('Record', { exact: true })).toBeVisible();

  // app/signed-in-page.tsx wires react-query's QueryCache onError straight to
  // sonner's toast.error() -- a vehicle id that doesn't exist 404s and should
  // surface a toast, not just a silent console error. React Query retries failed
  // queries a few times with backoff before onError fires, so this needs a longer
  // timeout than the default 5s.
  await page.goto('/vehicles/does-not-exist');
  await expect(page.locator('[data-sonner-toast]')).toBeVisible({ timeout: 15_000 });
  await expect(page.locator('[data-sonner-toast]')).toContainText('An error occured');
});
