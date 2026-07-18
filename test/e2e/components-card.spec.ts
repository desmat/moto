import { test, expect } from '@playwright/test';

// covers S12's "Current setup" card on the vehicle page: service logs with structured
// items[] produce vehicle.components rows (name + installed detail + last-touched line),
// and the row's date links to the source log. Per the test-isolation convention this
// spec creates its own vehicle + logs via the API (the seeded records are read-only
// fixtures shared by the whole parallel run) rather than asserting on the seeded
// vehicle's out-of-the-box card.

function testVehicle() {
  return {
    type: 'motorcycle',
    maker: 'Test Maker',
    model: `Components E2E Model ${Date.now()}-${Math.random().toString(16).slice(2, 8)}`,
    year: 2024,
    mileage: 100,
    modifications: [],
  };
}

test('service logs produce a Current setup card on the vehicle page; the date links to the log', async ({ page }) => {
  const vehicleRes = await page.request.post('/api/vehicles', { data: { vehicle: testVehicle() } });
  const { vehicle } = await vehicleRes.json();
  expect(vehicle?.id).toBeTruthy();

  // two service logs → three component rows (front-tire / rear-tire / engine-oil)
  const tiresRes = await page.request.post('/api/logs', {
    data: {
      log: {
        vehicleId: vehicle.id,
        type: 'service',
        date: '20260410',
        entry: 'new tires',
        items: [
          { key: 'front-tire', name: 'Front tire', action: 'replace', note: 'Michelin Anakee Adventure' },
          { key: 'rear-tire', name: 'Rear tire', action: 'replace', note: 'Michelin Anakee Adventure' },
        ],
        mileage: 4200,
      },
    },
  });
  const { log: tiresLog } = await tiresRes.json();
  expect(tiresLog?.id).toBeTruthy();

  const oilRes = await page.request.post('/api/logs', {
    data: {
      log: {
        vehicleId: vehicle.id,
        type: 'service',
        date: '20260501',
        entry: 'oil change',
        items: [{ key: 'engine-oil', name: 'Engine oil', action: 'replace', note: 'Full synthetic 10W-30' }],
        mileage: 4800,
      },
    },
  });
  const { log: oilLog } = await oilRes.json();
  expect(oilLog?.id).toBeTruthy();

  await page.goto(`/vehicles/${vehicle.id}`);

  // exact matches: the page's JSON editor textarea also contains these strings as JSON
  await expect(page.getByText('Current setup', { exact: true })).toBeVisible();
  await expect(page.getByText('Front tire', { exact: true })).toBeVisible();
  await expect(page.getByText('Rear tire', { exact: true })).toBeVisible();
  await expect(page.getByText('Engine oil', { exact: true })).toBeVisible();
  // installed detail shows on the tire rows
  await expect(page.getByText('Michelin Anakee Adventure', { exact: true }).first()).toBeVisible();
  // last-touched line carries action + mileage
  await expect(page.getByText('last: replace · ').first()).toBeVisible();
  await expect(page.getByText('4800 km')).toBeVisible();

  // the row's date links to the source log; both source logs are linked
  await expect(page.locator(`a[href="/logs/${tiresLog.id}"]`).first()).toBeVisible();
  const oilLink = page.locator(`a[href="/logs/${oilLog.id}"]`);
  await expect(oilLink).toBeVisible();
  await oilLink.click();
  await expect(page).toHaveURL(`/logs/${oilLog.id}`);
  // the log page's JSON editor shows the source log
  await expect(page.locator('textarea')).toHaveValue(/oil change/);

  // cleanup
  for (const id of [tiresLog.id, oilLog.id]) await page.request.delete(`/api/logs/${id}`);
  await page.request.delete(`/api/vehicles/${vehicle.id}`);
});
