import { test, expect } from '@playwright/test';
import moment from 'moment';

const DATE = 'YYYYMMDD';
const monthsAgo = (months: number) => moment().subtract(months, 'months').format(DATE);

test('full schedule shows every status and both row actions update without reload', async ({ page }) => {
  const stamp = `${Date.now()}${Math.random().toString(16).slice(2, 6)}`;
  const modelName = `Schedule ${stamp}`;
  const overdueName = `Overdue oil ${stamp}`;
  const okayName = `Recent coolant ${stamp}`;
  const unknownName = `Valve history ${stamp}`;

  const vehicleRes = await page.request.post('/api/vehicles', {
    data: { vehicle: { type: 'motorcycle', maker: 'Test', model: modelName, year: 2024, mileage: 12000 } },
  });
  const { vehicle } = await vehicleRes.json();
  expect(vehicle?.id).toBeTruthy();

  const scheduleRes = await page.request.post('/api/schedules', {
    data: {
      schedule: {
        vehicleId: vehicle.id,
        source: 'user',
        items: [
          { key: `overdue-${stamp}`, name: overdueName, action: 'replace', intervalMonths: 12 },
          { key: `okay-${stamp}`, name: okayName, action: 'inspect', intervalMonths: 12 },
          { key: `unknown-${stamp}`, name: unknownName, action: 'inspect', intervalMonths: 12 },
        ],
      },
    },
  });
  const { schedule } = await scheduleRes.json();
  const confirmRes = await page.request.put(`/api/schedules/${schedule.id}`, {
    data: { schedule: { ...schedule, status: 'confirmed' } },
  });
  expect(confirmRes.ok()).toBeTruthy();

  const overdueLogRes = await page.request.post('/api/logs', {
    data: {
      log: {
        vehicleId: vehicle.id,
        type: 'service',
        date: monthsAgo(18),
        mileage: 5000,
        items: [{ key: `overdue-${stamp}`, name: overdueName, action: 'replace' }],
      },
    },
  });
  const { log: overdueLog } = await overdueLogRes.json();

  const okayLogRes = await page.request.post('/api/logs', {
    data: {
      log: {
        vehicleId: vehicle.id,
        type: 'service',
        date: monthsAgo(1),
        mileage: 11500,
        items: [{ key: `okay-${stamp}`, name: okayName, action: 'inspect' }],
      },
    },
  });
  const { log: okayLog } = await okayLogRes.json();

  // Vehicle details surface only this vehicle's due notices and a clear route to its
  // complete schedule.
  await page.goto(`/vehicles/${vehicle.id}`);
  const detailNotice = page.getByRole('button', { name: new RegExp(overdueName) });
  await expect(detailNotice).toBeVisible();
  await expect(page.getByRole('button', { name: 'View schedule' })).toBeVisible();
  await page.getByRole('button', { name: 'View schedule' }).click();
  await expect(page).toHaveURL(`/vehicles/${vehicle.id}/schedule`);

  await expect(page.getByRole('heading', { name: 'Maintenance schedule' })).toBeVisible();
  await expect(page.getByText('Schedule', { exact: true }).last()).toBeVisible();
  await expect(page.getByRole('link', { name: new RegExp(modelName) })).toHaveAttribute('href', `/vehicles/${vehicle.id}`);

  const overdueRow = page.locator(`[data-maintenance-key="overdue-${stamp}"]`);
  const okayRow = page.locator(`[data-maintenance-key="okay-${stamp}"]`);
  const unknownRow = page.locator(`[data-maintenance-key="unknown-${stamp}"]`);
  await expect(overdueRow).toContainText('Overdue');
  await expect(overdueRow).toContainText('5,000 km');
  await expect(okayRow).toContainText('Okay');
  const noHistoryToggle = page.getByRole('button', { name: 'No history (1 items)' });
  await expect(noHistoryToggle).toHaveAttribute('aria-expanded', 'false');
  await expect(unknownRow).toHaveCount(0);
  await noHistoryToggle.click();
  await expect(noHistoryToggle).toHaveAttribute('aria-expanded', 'true');
  await expect(unknownRow).toContainText('Unknown');

  // The last-done cell points to the exact source log.
  await expect(overdueRow.locator(`a[href="/logs/${overdueLog.id}"]`)).toBeVisible();

  // Log the overdue work today: the normal service dialog is pre-filled and the
  // maintenance query invalidation moves the row out of overdue without a reload.
  await overdueRow.getByRole('button', { name: 'Log it' }).click();
  let dialog = page.getByRole('dialog', { name: 'Service / Receipt' });
  await expect(dialog.getByRole('textbox', { name: 'Name' })).toHaveValue(overdueName);
  const currentLogResponse = page.waitForResponse((res) => res.url().includes('/api/logs') && res.request().method() === 'POST');
  await dialog.getByRole('button', { name: 'Save', exact: true }).click();
  const { log: currentLog } = await (await currentLogResponse).json();
  await expect(overdueRow).toContainText('Okay');

  // Capture the unknown item's history with the date field explicitly framed as a
  // remembered date. Saving immediately gives the row a last-done link and status.
  await unknownRow.getByRole('button', { name: 'When did you last do this?' }).click();
  dialog = page.getByRole('dialog', { name: 'Service / Receipt' });
  await expect(dialog.getByLabel('When was it last done?')).toBeVisible();
  await dialog.getByLabel('When was it last done?').fill(moment().subtract(2, 'months').format('YYYY-MM-DD'));
  const historyLogResponse = page.waitForResponse((res) => res.url().includes('/api/logs') && res.request().method() === 'POST');
  await dialog.getByRole('button', { name: 'Save', exact: true }).click();
  const { log: historyLog } = await (await historyLogResponse).json();
  await expect(unknownRow).toContainText('Okay');
  await expect(unknownRow.locator(`a[href="/logs/${historyLog.id}"]`)).toBeVisible();

  await page.request.delete(`/api/logs/${historyLog.id}`);
  await page.request.delete(`/api/logs/${currentLog.id}`);
  await page.request.delete(`/api/logs/${okayLog.id}`);
  await page.request.delete(`/api/logs/${overdueLog.id}`);
  await page.request.delete(`/api/schedules/${schedule.id}`);
  await page.request.delete(`/api/vehicles/${vehicle.id}`);
});

test('schedule remains usable at phone width', async ({ page }) => {
  const stamp = `${Date.now()}${Math.random().toString(16).slice(2, 6)}`;
  const vehicleRes = await page.request.post('/api/vehicles', {
    data: { vehicle: { type: 'motorcycle', maker: 'Test', model: `Phone ${stamp}`, year: 2024, mileage: 1000 } },
  });
  const { vehicle } = await vehicleRes.json();
  const scheduleRes = await page.request.post('/api/schedules', {
    data: { schedule: { vehicleId: vehicle.id, source: 'user', items: [{ key: `phone-${stamp}`, name: `Phone item ${stamp}`, action: 'inspect', firstAtKm: 2000 }] } },
  });
  const { schedule } = await scheduleRes.json();
  await page.request.put(`/api/schedules/${schedule.id}`, { data: { schedule: { ...schedule, status: 'confirmed' } } });

  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto(`/vehicles/${vehicle.id}/schedule`);
  const row = page.locator(`[data-maintenance-key="phone-${stamp}"]`);
  await expect(row).toBeVisible();
  await expect(row.getByRole('button', { name: 'Log it' })).toBeVisible();
  const box = await row.boundingBox();
  expect(box?.x).toBeGreaterThanOrEqual(0);
  expect((box?.x || 0) + (box?.width || 0)).toBeLessThanOrEqual(390);

  await page.request.delete(`/api/schedules/${schedule.id}`);
  await page.request.delete(`/api/vehicles/${vehicle.id}`);
});
