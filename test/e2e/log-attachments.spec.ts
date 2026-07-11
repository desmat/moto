import { test, expect } from '@playwright/test';
import path from 'path';
import { smokeTestUserId } from '../../services/stores/memory';

// covers S4's attach-in-the-log-dialog flow end-to-end under BLOB_MOCK + memory store:
// picking a file uploads immediately (mocked) and creates an Attachment record, an
// attachment alone (no text) makes a journal entry savable, saving links the attachment
// to the new log server-side, and removing a pending attachment deletes its record and
// disables Save again.

const fixtureImage = path.join(__dirname, '../fixtures/odometer.jpg');

// per the test-isolation convention, these specs create their own vehicle via the API
// (the seeded one is a read-only fixture shared by the whole parallel run)
const testVehicle = {
  type: 'motorcycle',
  maker: 'Test Maker',
  model: 'Attachment E2E Model',
  year: 2022,
  mileage: 1000,
  modifications: [],
};

test('a journal entry with a photo and no text can be saved, with the attachment linked', async ({ page }) => {
  // own vehicle first, so the save never races another spec deleting its test vehicle
  const vehicleRes = await page.request.post('/api/vehicles', { data: { vehicle: testVehicle } });
  const { vehicle } = await vehicleRes.json();
  expect(vehicle?.id).toBeTruthy();

  await page.goto('/');
  await page.getByRole('button', { name: 'Journal Entry' }).click();
  await expect(page.getByRole('dialog', { name: 'Journal Entry' })).toBeVisible();
  await page.getByLabel('Vehicle').selectOption(vehicle.id);

  // Save starts disabled: no text, no attachments
  await expect(page.getByRole('button', { name: 'Save' })).toBeDisabled();

  // the attach button is disabled until the internal user record loads (the upload
  // pathname needs its id) -- wait for it so the pick handler can't race the fetch
  await expect(page.getByRole('button', { name: 'Add photo / file' })).toBeEnabled();
  await page.locator('input[type="file"]').setInputFiles(fixtureImage);

  // upload (mocked) + record POST complete: thumbnail rendered, remove button present
  await expect(page.getByAltText('odometer.jpg')).toBeVisible();
  await expect(page.getByRole('button', { name: 'Remove odometer.jpg' })).toBeVisible();

  // the photo alone makes the entry savable -- the entry text stays EMPTY
  await expect(page.getByRole('textbox', { name: 'Entry' })).toHaveValue('');
  await expect(page.getByRole('button', { name: 'Save' })).toBeEnabled();

  const addResponsePromise = page.waitForResponse((res) =>
    res.url().includes('/api/logs') && res.request().method() === 'POST');
  await page.getByRole('button', { name: 'Save' }).click();
  const { log } = await (await addResponsePromise).json();
  expect(log?.id).toBeTruthy();
  expect(log?.type).toBe('journal');
  expect(log?.entry).toBe('');
  expect(log?.vehicleId).toBe(vehicle.id);

  // dialog closes and the new (text-less) entry shows up in the Entries list
  await expect(page.getByRole('dialog')).toHaveCount(0);
  await expect(page.locator(`a[href="/logs/${log.id}"]`)).toBeVisible();

  // the attachment got linked to the log server-side
  const attachmentsRes = await page.request.get(`/api/attachments?log=${log.id}`);
  const { attachments } = await attachmentsRes.json();
  expect(attachments.length).toBe(1);
  expect(attachments[0].filename).toBe('odometer.jpg');
  expect(attachments[0].logId).toBe(log.id);
  expect(attachments[0].vehicleId).toBe(vehicle.id);

  // cleanup so repeated runs against the same long-lived in-memory store don't
  // accumulate records indefinitely
  await page.request.delete(`/api/attachments/${attachments[0].id}`);
  await page.request.delete(`/api/logs/${log.id}`);
  await page.request.delete(`/api/vehicles/${vehicle.id}`);
});

// S5: list indicator + detail-page thumbnail. The spec creates ALL of its own data via
// the API (vehicle → two logs → one attachment linked to one of them) rather than
// asserting on the memory-store seeds -- seed ids/ordering are dev conveniences, not a
// test contract, and rows created here have unique hrefs so the assertions don't care
// where the rows sit or what parallel specs are doing. The attachment url is a tiny
// data-URL so nothing depends on a real Blob store.
test('a log with an attachment shows a paperclip in the logs list and a thumbnail on the detail page', async ({ page }) => {
  const vehicleRes = await page.request.post('/api/vehicles', { data: { vehicle: testVehicle } });
  const { vehicle } = await vehicleRes.json();
  expect(vehicle?.id).toBeTruthy();

  const withLogRes = await page.request.post('/api/logs', {
    data: { log: { vehicleId: vehicle.id, type: 'journal', entry: 'entry with an indicator' } },
  });
  const { log: withLog } = await withLogRes.json();
  const withoutLogRes = await page.request.post('/api/logs', {
    data: { log: { vehicleId: vehicle.id, type: 'journal', entry: 'entry without one' } },
  });
  const { log: withoutLog } = await withoutLogRes.json();
  expect(withLog?.id).toBeTruthy();
  expect(withoutLog?.id).toBeTruthy();

  // 1x1 PNG data-URL; unique pathname per run to dodge the POST's pathname idempotency
  const filename = `indicator-${Date.now()}-${Math.random().toString(16).slice(2, 8)}.png`;
  const attachmentRes = await page.request.post('/api/attachments', {
    data: {
      attachment: {
        logId: withLog.id,
        url: 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==',
        pathname: `moto/${smokeTestUserId}/${filename}`,
        contentType: 'image/png',
        size: 68,
        filename,
      },
    },
  });
  const { attachment } = await attachmentRes.json();
  expect(attachment?.id).toBeTruthy();

  await page.goto('/logs');

  // the linked row carries the attachment indicator...
  const rowWithAttachment = page.locator(`a[href="/logs/${withLog.id}"]`);
  await expect(rowWithAttachment).toBeVisible();
  await expect(rowWithAttachment.getByLabel('Has attachments')).toBeVisible();

  // ...and the attachment-less row doesn't
  const rowWithout = page.locator(`a[href="/logs/${withoutLog.id}"]`);
  await expect(rowWithout).toBeVisible();
  await expect(rowWithout.getByLabel('Has attachments')).toHaveCount(0);

  // the detail page renders the image as a thumbnail wrapped in a new-tab link to the
  // full-size url
  await page.goto(`/logs/${withLog.id}`);
  const thumbnail = page.getByAltText(filename);
  await expect(thumbnail).toBeVisible();
  await expect(thumbnail).toHaveAttribute('src', /^data:image\/png/);

  const link = page.locator('a[target="_blank"]', { has: thumbnail });
  await expect(link).toHaveAttribute('href', /^data:image\/png/);

  // cleanup (deleting withLog cascades to the attachment)
  await page.request.delete(`/api/logs/${withLog.id}`);
  await page.request.delete(`/api/logs/${withoutLog.id}`);
  await page.request.delete(`/api/vehicles/${vehicle.id}`);
});

test('removing a pending attachment deletes its record and disables Save again', async ({ page }) => {
  const vehicleRes = await page.request.post('/api/vehicles', { data: { vehicle: testVehicle } });
  const { vehicle } = await vehicleRes.json();
  expect(vehicle?.id).toBeTruthy();

  await page.goto('/');
  await page.getByRole('button', { name: 'Journal Entry' }).click();
  await expect(page.getByRole('dialog', { name: 'Journal Entry' })).toBeVisible();
  await page.getByLabel('Vehicle').selectOption(vehicle.id);

  await expect(page.getByRole('button', { name: 'Add photo / file' })).toBeEnabled();
  await page.locator('input[type="file"]').setInputFiles(fixtureImage);
  await expect(page.getByAltText('odometer.jpg')).toBeVisible();
  await expect(page.getByRole('button', { name: 'Save' })).toBeEnabled();

  // removing the pending thumbnail DELETEs the attachment record (and, in real mode,
  // its blob) and Save goes back to disabled since the text is still empty
  const deleteResponsePromise = page.waitForResponse((res) =>
    res.url().includes('/api/attachments/') && res.request().method() === 'DELETE');
  await page.getByRole('button', { name: 'Remove odometer.jpg' }).click();
  const deleteResponse = await deleteResponsePromise;
  expect(deleteResponse.ok()).toBeTruthy();

  await expect(page.getByAltText('odometer.jpg')).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'Save' })).toBeDisabled();

  // Escape rather than the footer's Close button: radix's built-in corner X is also
  // accessibly named "Close", so getByRole would hit a strict-mode violation
  await page.keyboard.press('Escape');
  await expect(page.getByRole('dialog')).toHaveCount(0);
  await page.request.delete(`/api/vehicles/${vehicle.id}`);
});
