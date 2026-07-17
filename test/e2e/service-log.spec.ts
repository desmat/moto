import { test, expect } from '@playwright/test';
import path from 'path';

// covers S11's receipt → structured service log flow end-to-end under BLOB_MOCK +
// AI_MOCK + memory store: picking a receipt photo in the Service / Receipt dialog
// auto-fires the receipt route, the canned extraction (see test/fixtures/ai-mocks.json's
// "receipt" entry) pre-fills vendor/date/mileage/total/line items, the user corrects a
// line, and saving creates a `service` log with structured items and the photo linked.

const fixtureImage = path.join(__dirname, '../fixtures/receipt.jpg');

// per the test-isolation convention, this spec creates its own vehicle via the API
// (the seeded ones are read-only fixtures shared by the whole parallel run). Starting
// mileage BELOW the canned extraction's 17200 so no "save anyway" tap is needed.
function testVehicle() {
  return {
    type: 'motorcycle',
    maker: 'Test Maker',
    model: `Service E2E Model ${Date.now()}-${Math.random().toString(16).slice(2, 8)}`,
    year: 2024,
    mileage: 100,
    modifications: [],
  };
}

test('a receipt photo pre-fills the service form; an edited line item saves into the structured log', async ({ page }) => {
  const vehicleRes = await page.request.post('/api/vehicles', { data: { vehicle: testVehicle() } });
  const { vehicle } = await vehicleRes.json();
  expect(vehicle?.id).toBeTruthy();

  await page.goto('/');
  await page.getByRole('button', { name: 'Service / Receipt' }).click();
  await expect(page.getByRole('dialog', { name: 'Service / Receipt' })).toBeVisible();
  // the smoke user has several seeded vehicles, so the picker is always rendered
  await page.getByLabel('Vehicle').selectOption(vehicle.id);

  // the attach button is disabled until the internal user record loads (the upload
  // pathname needs its id) -- wait for it so the pick handler can't race the fetch
  await expect(page.getByRole('button', { name: 'Add receipt photo / file' })).toBeEnabled();
  await page.locator('input[type="file"]').setInputFiles(fixtureImage);

  // upload (mocked) completes, OCR (mocked) fires automatically and pre-fills the form
  await expect(page.getByRole('textbox', { name: 'Vendor' })).toHaveValue('Moto Garage TestShop');
  await expect(page.getByLabel('Date')).toHaveValue('2026-03-15');
  await expect(page.getByRole('spinbutton', { name: 'Mileage (optional)' })).toHaveValue('17200');
  await expect(page.getByRole('spinbutton', { name: 'Total' })).toHaveValue('612.45');
  await expect(page.getByText('✨ pre-filled from the receipt — check and save')).toBeVisible();

  // three canned line items; the user corrects the first one's name
  const nameCells = page.getByRole('dialog').getByRole('textbox', { name: 'Name' });
  await expect(nameCells).toHaveCount(3);
  await expect(nameCells.nth(0)).toHaveValue('Front tire');
  await nameCells.nth(0).fill('Front tire (Anakee)');

  // 17200 > 100: the first Save submits immediately (no two-tap warn)
  const addResponsePromise = page.waitForResponse((res) =>
    res.url().includes('/api/logs') && res.request().method() === 'POST');
  await page.getByRole('button', { name: 'Save', exact: true }).click();
  const { log } = await (await addResponsePromise).json();
  expect(log?.id).toBeTruthy();
  expect(log?.type).toBe('service');
  expect(log?.vehicleId).toBe(vehicle.id);
  expect(log?.vendor).toBe('Moto Garage TestShop');
  expect(log?.date).toBe('20260315');
  expect(log?.mileage).toBe(17200);
  expect(log?.totalCost).toBe(612.45);
  expect(log?.items?.length).toBe(3);
  expect(log?.items?.[0]).toEqual({
    key: 'front-tire',
    name: 'Front tire (Anakee)',
    action: 'replace',
    note: 'Michelin Anakee Adventure',
    cost: 289.99,
  });

  await expect(page.getByRole('dialog')).toHaveCount(0);

  // the new entry shows up in the dashboard's Entries list (by its unique href, so
  // parallel specs shifting positions can't break this)
  await expect(page.locator(`a[href="/logs/${log.id}"]`)).toBeVisible();

  // the service log's mileage (17200 > 100) updated the vehicle server-side...
  const vehicleAfterRes = await page.request.get(`/api/vehicles/${vehicle.id}`);
  const { vehicle: vehicleAfter } = await vehicleAfterRes.json();
  expect(vehicleAfter?.mileage).toBe(17200);

  // ...and the photo got linked to the new log
  const attachmentsRes = await page.request.get(`/api/attachments?log=${log.id}`);
  const { attachments } = await attachmentsRes.json();
  expect(attachments.length).toBe(1);
  expect(attachments[0].filename).toBe('receipt.jpg');
  expect(attachments[0].logId).toBe(log.id);

  // cleanup (deleting the log cascades to its attachment)
  await page.request.delete(`/api/logs/${log.id}`);
  await page.request.delete(`/api/vehicles/${vehicle.id}`);
});
