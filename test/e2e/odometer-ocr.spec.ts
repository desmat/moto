import { test, expect } from '@playwright/test';
import path from 'path';

// covers S6's odometer-photo → mileage-log flow end-to-end under BLOB_MOCK + AI_MOCK +
// memory store: picking a photo in the mileage dialog auto-fires the OCR route, the
// canned reading (12345, see services/ai.ts's MOCKS) pre-fills the odometer field with
// the ✨ hint, and saving updates the vehicle's mileage with the photo linked to the new
// log. A reading below the vehicle's current mileage requires the inline two-tap
// "Save anyway" confirm; a higher reading saves on the first tap.

const fixtureImage = path.join(__dirname, '../fixtures/odometer.jpg');

// per the test-isolation convention, these specs create their own vehicle via the API
// with the exact starting mileage each scenario needs (the seeded one is a read-only
// fixture shared by the whole parallel run)
function testVehicle(mileage: number) {
  return {
    type: 'motorcycle',
    maker: 'Test Maker',
    model: 'Odometer OCR Model',
    year: 2023,
    mileage,
    modifications: [],
  };
}

test('an odometer photo pre-fills the reading; a lower-than-current value needs the two-tap Save anyway', async ({ page }) => {
  // starting mileage ABOVE the canned OCR reading of 12345, so the first Save must warn
  const vehicleRes = await page.request.post('/api/vehicles', { data: { vehicle: testVehicle(18250) } });
  const { vehicle } = await vehicleRes.json();
  expect(vehicle?.id).toBeTruthy();

  await page.goto('/');
  await page.getByRole('button', { name: 'Current Mileage' }).click();
  await expect(page.getByRole('dialog', { name: 'Current Mileage' })).toBeVisible();
  await page.getByLabel('Vehicle').selectOption(vehicle.id);

  // the attach button is disabled until the internal user record loads (the upload
  // pathname needs its id) -- wait for it so the pick handler can't race the fetch
  await expect(page.getByRole('button', { name: 'Add photo / file' })).toBeEnabled();
  await page.locator('input[type="file"]').setInputFiles(fixtureImage);

  // upload (mocked) completes, OCR (mocked) fires automatically and fills the field
  await expect(page.getByRole('spinbutton', { name: 'Odometer' })).toHaveValue('12345');
  await expect(page.getByText('✨ read from photo — check and save')).toBeVisible();

  // 12345 < 18250: the FIRST Save tap must NOT submit -- it arms the inline confirm
  await page.getByRole('button', { name: 'Save', exact: true }).click();
  await expect(page.getByText(/Lower than the current 18,250/)).toBeVisible();
  await expect(page.getByRole('dialog', { name: 'Current Mileage' })).toBeVisible();

  // the SECOND tap (now labeled Save anyway) submits
  const addResponsePromise = page.waitForResponse((res) =>
    res.url().includes('/api/logs') && res.request().method() === 'POST');
  await page.getByRole('button', { name: 'Save anyway' }).click();
  const { log } = await (await addResponsePromise).json();
  expect(log?.id).toBeTruthy();
  expect(log?.type).toBe('mileage');
  expect(log?.entry).toBe('12345');
  expect(log?.vehicleId).toBe(vehicle.id);

  await expect(page.getByRole('dialog')).toHaveCount(0);

  // the mileage log updated the vehicle's odometer server-side...
  const vehicleAfterRes = await page.request.get(`/api/vehicles/${vehicle.id}`);
  const { vehicle: vehicleAfter } = await vehicleAfterRes.json();
  expect(vehicleAfter?.mileage).toBe(12345);

  // ...and the photo got linked to the new log
  const attachmentsRes = await page.request.get(`/api/attachments?log=${log.id}`);
  const { attachments } = await attachmentsRes.json();
  expect(attachments.length).toBe(1);
  expect(attachments[0].filename).toBe('odometer.jpg');
  expect(attachments[0].logId).toBe(log.id);

  // cleanup (deleting the log cascades to its attachment)
  await page.request.delete(`/api/logs/${log.id}`);
  await page.request.delete(`/api/vehicles/${vehicle.id}`);
});

test('a reading above the vehicle\'s current mileage saves on the first tap', async ({ page }) => {
  // starting mileage BELOW the canned OCR reading of 12345: no warning, no second tap
  const vehicleRes = await page.request.post('/api/vehicles', { data: { vehicle: testVehicle(1000) } });
  const { vehicle } = await vehicleRes.json();
  expect(vehicle?.id).toBeTruthy();

  await page.goto('/');
  await page.getByRole('button', { name: 'Current Mileage' }).click();
  await expect(page.getByRole('dialog', { name: 'Current Mileage' })).toBeVisible();
  await page.getByLabel('Vehicle').selectOption(vehicle.id);

  await expect(page.getByRole('button', { name: 'Add photo / file' })).toBeEnabled();
  await page.locator('input[type="file"]').setInputFiles(fixtureImage);

  await expect(page.getByRole('spinbutton', { name: 'Odometer' })).toHaveValue('12345');
  await expect(page.getByText('✨ read from photo — check and save')).toBeVisible();

  // 12345 > 1000: the first Save submits immediately
  const addResponsePromise = page.waitForResponse((res) =>
    res.url().includes('/api/logs') && res.request().method() === 'POST');
  await page.getByRole('button', { name: 'Save', exact: true }).click();
  const { log } = await (await addResponsePromise).json();
  expect(log?.id).toBeTruthy();
  expect(log?.type).toBe('mileage');
  expect(log?.entry).toBe('12345');

  await expect(page.getByRole('dialog')).toHaveCount(0);

  const vehicleAfterRes = await page.request.get(`/api/vehicles/${vehicle.id}`);
  const { vehicle: vehicleAfter } = await vehicleAfterRes.json();
  expect(vehicleAfter?.mileage).toBe(12345);

  await page.request.delete(`/api/logs/${log.id}`);
  await page.request.delete(`/api/vehicles/${vehicle.id}`);
});
