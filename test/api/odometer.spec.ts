import { test, expect } from '@playwright/test';
import { smokeTestUserId } from '../../services/stores/memory';

// covers POST /api/ai/odometer against AI_MOCK=true (playwright.config.ts): a canned,
// deterministic reading for an owned image attachment, 404 for a missing attachment,
// and 400 for a non-image one. (The test server always impersonates a single
// authenticated non-admin user, so the 403 paths are design-review-only, per
// ownership.spec.ts's standing note.)

// unique per call so repeated runs against a reused dev server never collide on the
// attachments POST's pathname idempotency lookup
function testAttachment(suffix: string, contentType = 'image/jpeg') {
  const filename = `test-${Date.now()}-${Math.random().toString(16).slice(2, 8)}-${suffix}.jpg`;
  return {
    url: `https://example.blob.test/moto/${smokeTestUserId}/${filename}`,
    pathname: `moto/${smokeTestUserId}/${filename}`,
    contentType,
    size: 12345,
    filename,
  };
}

test('POST /api/ai/odometer returns the canned mock reading for an owned image attachment', async ({ request }) => {
  const createRes = await request.post('/api/attachments', {
    data: { attachment: testAttachment('ocr') },
  });
  expect(createRes.ok()).toBeTruthy();
  const { attachment } = await createRes.json();
  expect(attachment?.id).toBeTruthy();

  const ocrRes = await request.post('/api/ai/odometer', {
    data: { attachmentId: attachment.id },
  });
  expect(ocrRes.ok()).toBeTruthy();
  const { result } = await ocrRes.json();
  // the AI_MOCK canned response registered in services/ai.ts's MOCKS
  expect(result).toEqual({ odometer_digits_clearly_visible: true, reading: 12345, unit: 'km', confidence: 'high' });

  await request.delete(`/api/attachments/${attachment.id}`);
});

test('POST /api/ai/odometer 404s for a missing attachment', async ({ request }) => {
  const missingRes = await request.post('/api/ai/odometer', {
    data: { attachmentId: 'does-not-exist' },
  });
  expect(missingRes.status()).toBe(404);

  // no attachmentId at all is also "not found", not a 500
  const noIdRes = await request.post('/api/ai/odometer', { data: {} });
  expect(noIdRes.status()).toBe(404);
});

test('POST /api/ai/odometer 400s for a non-image attachment', async ({ request }) => {
  const createRes = await request.post('/api/attachments', {
    data: { attachment: testAttachment('ocr-pdf', 'application/pdf') },
  });
  expect(createRes.ok()).toBeTruthy();
  const { attachment } = await createRes.json();
  expect(attachment?.id).toBeTruthy();

  const ocrRes = await request.post('/api/ai/odometer', {
    data: { attachmentId: attachment.id },
  });
  expect(ocrRes.status()).toBe(400);

  await request.delete(`/api/attachments/${attachment.id}`);
});
