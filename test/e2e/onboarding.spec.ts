import { test, expect } from '@playwright/test';

// covers S13's onboarding interview end-to-end against the scripted AI_MOCK
// conversation (the "onboarding" array in test/fixtures/ai-mocks.json): the dashboard's
// finish-setup card opens the interview, three free-text answers walk the script to the
// review table, Confirm creates the proposed backdated service log + current-mileage
// log through the normal /api/logs flow, and the card disappears once the vehicle has
// logs. The FRESH-USER forced-dialog entry point can't run here (the seeded store's
// user always has vehicles), so the spec enters via the card — the interview component
// is the same either way. Per the test-isolation convention the vehicle is created via
// the API with a unique name; the card is per-vehicle, so parallel specs' vehicles
// don't interfere.

function testVehicle() {
  return {
    type: 'motorcycle',
    maker: 'Test Maker',
    model: `Onboarding E2E Model ${Date.now()}-${Math.random().toString(16).slice(2, 8)}`,
    year: 2023,
    mileage: 100,
    modifications: [],
  };
}

test('finish-setup card opens the scripted interview; confirm creates the proposed logs and the card disappears', async ({ page }) => {
  const vehicleRes = await page.request.post('/api/vehicles', { data: { vehicle: testVehicle() } });
  const { vehicle } = await vehicleRes.json();
  expect(vehicle?.id).toBeTruthy();
  const name = `${vehicle.year} ${vehicle.maker} ${vehicle.model}`;

  await page.goto('/');

  // the zero-log vehicle gets its own finish-setup card
  const card = page.getByRole('button', { name: `Finish setting up your ${name} — 2 min` });
  await expect(card).toBeVisible();
  await card.click();

  // the interview opens and asks the scripted first question by itself
  const dialog = page.getByRole('dialog');
  await expect(dialog.getByText(`Set up your ${name}`)).toBeVisible();
  await expect(dialog.getByText('current mileage on the odometer')).toBeVisible();

  const answer = async (text: string) => {
    await dialog.getByRole('textbox', { name: 'Answer' }).fill(text);
    await dialog.getByRole('button', { name: 'Send' }).click();
  };

  await answer('about 12800 km');
  await expect(dialog.getByText('last change the engine oil')).toBeVisible();

  await answer('oil was done maybe 2000 km ago at the dealer');
  await expect(dialog.getByText('Anything else recent')).toBeVisible();
  // the manual-upload turn renders the S8 upload affordance inline
  await expect(dialog.getByRole('button', { name: 'Upload manual / document' })).toBeVisible();

  await answer('nothing else');

  // done → the review table of proposed logs (backdated service row first, est. badge on)
  await expect(dialog.getByText('Review & confirm')).toBeVisible();
  await expect(dialog.getByRole('textbox', { name: 'Entry' }).first()).toHaveValue(/Oil change/);
  await expect(dialog.getByText('est.', { exact: true })).toBeVisible();

  await dialog.getByRole('button', { name: 'Confirm' }).click();
  await expect(page.getByRole('dialog')).toHaveCount(0);

  // both proposed logs exist, with the canned dates/values (fetch the user's logs and
  // filter — multi-lookup store queries aren't exercised anywhere, keep it simple)
  const logsRes = await page.request.get('/api/logs');
  const logs = (await logsRes.json()).logs.filter((log: any) => log.vehicleId == vehicle.id);
  const serviceLog = logs.find((log: any) => log.type == 'service');
  expect(serviceLog).toBeTruthy();
  expect(serviceLog.date).toBe('20260315');
  expect(serviceLog.mileage).toBe(10800);
  expect(serviceLog.items?.[0]?.key).toBe('engine-oil');
  const mileageLog = logs.find((log: any) => log.type == 'mileage');
  expect(mileageLog).toBeTruthy();
  expect(mileageLog.entry).toBe('12800');

  // the mileage-type log (POSTed last) overwrite-set the vehicle's mileage
  const updatedVehicleRes = await page.request.get(`/api/vehicles/${vehicle.id}`);
  const { vehicle: updatedVehicle } = await updatedVehicleRes.json();
  expect(updatedVehicle?.mileage).toBe(12800);

  // the vehicle has logs now, so its finish-setup card is gone
  await expect(card).toHaveCount(0);
});

test('skipping the interview creates nothing and dismissing the card hides it', async ({ page }) => {
  const vehicleRes = await page.request.post('/api/vehicles', { data: { vehicle: testVehicle() } });
  const { vehicle } = await vehicleRes.json();
  expect(vehicle?.id).toBeTruthy();
  const name = `${vehicle.year} ${vehicle.maker} ${vehicle.model}`;

  await page.goto('/');

  const card = page.getByRole('button', { name: `Finish setting up your ${name} — 2 min` });
  await expect(card).toBeVisible();
  await card.click();

  const dialog = page.getByRole('dialog');
  await expect(dialog.getByText('current mileage on the odometer')).toBeVisible();

  // Skip mid-interview → no records
  await dialog.getByRole('button', { name: 'Skip' }).click();
  await expect(page.getByRole('dialog')).toHaveCount(0);

  const logsRes = await page.request.get('/api/logs');
  const logs = (await logsRes.json()).logs.filter((log: any) => log.vehicleId == vehicle.id);
  expect(logs).toHaveLength(0);

  // the card survives a skip (still no logs) until dismissed explicitly
  await expect(card).toBeVisible();
  await page.getByRole('button', { name: `Dismiss setup for ${name}` }).click();
  await expect(card).toHaveCount(0);

  // dismissal is remembered (localStorage) across reloads
  await page.reload();
  await expect(page.getByText('Record', { exact: true })).toBeVisible();
  await expect(card).toHaveCount(0);
});
