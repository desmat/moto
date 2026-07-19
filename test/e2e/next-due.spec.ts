import { test, expect } from '@playwright/test';
import moment from 'moment';

// S16: the "next due" dashboard card. Per the test-isolation convention BOTH specs
// create their own fixtures via the API and assert only on lines naming their own
// unique vehicle/item — the card aggregates the whole garage, so rows and funnel lines
// from seeds and parallel specs coexist (assert the line, never the card's entirety).
//
// Every record created here is deleted at the end (logs → schedules → vehicle, the
// maintenance.spec.ts convention): leftover logs would displace the seeded entries the
// smoke spec asserts on the createdAt-sorted dashboard list.

const DATE = 'YYYYMMDD';
const daysAgo = (days: number) => moment().subtract(days, 'days').format(DATE);

test('overdue item: card row → pre-filled service dialog → save clears it without reload', async ({ page }) => {
  const stamp = `${Date.now()}${Math.random().toString(16).slice(2, 6)}`;
  const modelName = `NextDue ${stamp}`;
  const itemName = `Chain Lube ${stamp}`;

  // vehicle at 100,000 km with a 100 km chain interval last done at 1,000 km →
  // overdue by 98,900 km, normalized severity ~989 — deliberately extreme so this row
  // outranks anything the seeds or parallel specs put on the shared card's top 3
  const vehicleRes = await page.request.post('/api/vehicles', {
    data: { vehicle: { type: 'motorcycle', maker: 'Test', model: modelName, year: 2024, mileage: 100000 } },
  });
  const { vehicle } = await vehicleRes.json();
  expect(vehicle?.id).toBeTruthy();

  // the sanctioned path to a confirmed schedule: POST proposed, PUT back confirmed
  const scheduleRes = await page.request.post('/api/schedules', {
    data: {
      schedule: {
        vehicleId: vehicle.id,
        source: 'user',
        items: [{ key: 'chain', name: itemName, action: 'lubricate', intervalKm: 100 }],
      },
    },
  });
  const { schedule } = await scheduleRes.json();
  expect(schedule?.status).toBe('proposed');
  const confirmRes = await page.request.put(`/api/schedules/${schedule.id}`, {
    data: { schedule: { ...schedule, status: 'confirmed' } },
  });
  expect(confirmRes.ok()).toBeTruthy();

  // backdated keyed service log anchoring the overdue math
  const logRes = await page.request.post('/api/logs', {
    data: {
      log: {
        vehicleId: vehicle.id,
        type: 'service',
        date: daysAgo(30),
        entry: 'chain serviced',
        mileage: 1000,
        items: [{ key: 'chain', name: itemName, action: 'lubricate' }],
      },
    },
  });
  const { log: seedLog } = await logRes.json();
  expect(seedLog?.id).toBeTruthy();

  await page.goto('/');

  // the card shows OUR item's row: status phrasing + muted vehicle name
  const row = page.getByRole('button', { name: new RegExp(itemName) });
  await expect(row).toBeVisible();
  await expect(row).toContainText('overdue by');
  await expect(row).toContainText(modelName);

  // Dashboard More is the garage-wide schedule, not whichever vehicle happens to own
  // the most urgent item. Our isolated fixture appears in its own vehicle section.
  await page.getByRole('link', { name: '(More)' }).click();
  await expect(page).toHaveURL('/vehicles/schedule');
  const aggregateSection = page.locator(`[data-maintenance-vehicle="${vehicle.id}"]`);
  await expect(aggregateSection.getByRole('heading', { name: new RegExp(modelName) })).toBeVisible();
  await expect(aggregateSection.locator(`[data-maintenance-key="chain"]`)).toContainText(itemName);
  await page.goto('/');

  // clicking the row opens the service dialog pre-filled with vehicle + item
  await page.getByRole('button', { name: new RegExp(itemName) }).click();
  const dialog = page.getByRole('dialog', { name: 'Service / Receipt' });
  await expect(dialog).toBeVisible();
  await expect(dialog.locator('#service-vehicle')).toHaveValue(vehicle.id);
  await expect(dialog.getByRole('textbox', { name: 'Name' })).toHaveValue(itemName);
  await expect(dialog.getByRole('textbox', { name: 'Key' })).toHaveValue('chain');

  // save through the normal path; the react-query invalidation must clear the row
  // WITHOUT a reload
  const addResponsePromise = page.waitForResponse((res) =>
    res.url().includes('/api/logs') && res.request().method() === 'POST');
  await dialog.getByRole('button', { name: 'Save' }).click();
  const { log: savedLog } = await (await addResponsePromise).json();
  expect(savedLog?.id).toBeTruthy();
  expect(savedLog?.items?.[0]?.key).toBe('chain');

  await expect(page.getByRole('dialog')).toHaveCount(0);
  await expect(page.getByRole('button', { name: new RegExp(itemName) })).toHaveCount(0);

  // cleanup (logs → schedule → vehicle)
  await page.request.delete(`/api/logs/${savedLog.id}`);
  await page.request.delete(`/api/logs/${seedLog.id}`);
  await page.request.delete(`/api/schedules/${schedule.id}`);
  await page.request.delete(`/api/vehicles/${vehicle.id}`);
});

test('a vehicle with no confirmed schedule gets the upload-manual funnel line', async ({ page }) => {
  const modelName = `NoSchedule ${Date.now()}${Math.random().toString(16).slice(2, 6)}`;
  const vehicleRes = await page.request.post('/api/vehicles', {
    data: { vehicle: { type: 'motorcycle', maker: 'Test', model: modelName, year: 2024, mileage: 5000 } },
  });
  const { vehicle } = await vehicleRes.json();
  expect(vehicle?.id).toBeTruthy();

  await page.goto('/');

  // the additive funnel line names OUR vehicle (other vehicles' lines coexist)
  await expect(page.getByText(new RegExp(`Upload the owner.s manual for your .*${modelName}`)))
    .toBeVisible();

  await page.request.delete(`/api/vehicles/${vehicle.id}`);
});
