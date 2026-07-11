import { test, expect } from '@playwright/test';
import { smokeTestUserId } from '../../services/stores/memory';

// covers the Attachment routes: create (id/userId minted, client-supplied id stripped),
// list scoped by ?log=, PUT that sets logId but pins identity + blob fields, the
// `moto/{userId}/` pathname-prefix check, idempotent POST by pathname, and DELETE/404
// behavior. The Playwright test server always impersonates a single non-admin user
// (smokeTestUserId), so records are created under that user's prefix.

// unique per call so repeated runs against a reused dev server never collide on the
// pathname idempotency lookup
function testAttachment(suffix: string) {
  const filename = `test-${Date.now()}-${Math.random().toString(16).slice(2, 8)}-${suffix}.jpg`;
  return {
    url: `https://example.blob.test/moto/${smokeTestUserId}/${filename}`,
    pathname: `moto/${smokeTestUserId}/${filename}`,
    contentType: 'image/jpeg',
    size: 12345,
    filename,
  };
}

test('attachment create mints id/userId and DELETE removes the record', async ({ request }) => {
  const createRes = await request.post('/api/attachments', {
    data: { attachment: { ...testAttachment('crud'), id: 'client-supplied-id' } },
  });
  expect(createRes.ok()).toBeTruthy();
  const { attachment } = await createRes.json();
  expect(attachment?.id).toBeTruthy();
  // client-supplied id is stripped, not honored
  expect(attachment?.id).not.toBe('client-supplied-id');
  expect(attachment?.userId).toBe(smokeTestUserId);

  const getRes = await request.get(`/api/attachments/${attachment.id}`);
  expect(getRes.ok()).toBeTruthy();

  const deleteRes = await request.delete(`/api/attachments/${attachment.id}`);
  expect(deleteRes.status()).toBe(200);

  // deleting the record works even though the blob pathname is fake (blob deletion is
  // best-effort), and the record is really gone afterwards
  const goneRes = await request.get(`/api/attachments/${attachment.id}`);
  expect(goneRes.status()).toBe(404);
});

test('attachments list can be scoped by ?log=', async ({ request }) => {
  const logId = `test-log-${Date.now()}-${Math.random().toString(16).slice(2, 8)}`;

  const createRes = await request.post('/api/attachments', {
    data: { attachment: { ...testAttachment('list'), logId } },
  });
  expect(createRes.ok()).toBeTruthy();
  const { attachment } = await createRes.json();

  const otherRes = await request.post('/api/attachments', {
    data: { attachment: testAttachment('list-other') },
  });
  const { attachment: other } = await otherRes.json();

  const listRes = await request.get(`/api/attachments?log=${logId}`);
  expect(listRes.ok()).toBeTruthy();
  const { attachments } = await listRes.json();
  expect(attachments.map((a: any) => a.id)).toContain(attachment.id);
  expect(attachments.map((a: any) => a.id)).not.toContain(other.id);

  await request.delete(`/api/attachments/${attachment.id}`);
  await request.delete(`/api/attachments/${other.id}`);
});

test('PUT sets logId but pins identity and blob fields', async ({ request }) => {
  const createRes = await request.post('/api/attachments', {
    data: { attachment: testAttachment('put') },
  });
  const { attachment } = await createRes.json();
  expect(attachment?.id).toBeTruthy();
  expect(attachment?.logId).toBeFalsy();

  const logId = `test-log-${Date.now()}-${Math.random().toString(16).slice(2, 8)}`;
  const putRes = await request.put(`/api/attachments/${attachment.id}`, {
    data: {
      attachment: {
        ...attachment,
        logId,
        // attempts to change identity + blob fields must be ignored server-side
        id: 'other-id',
        userId: 'other-user',
        createdAt: 1,
        url: 'https://example.blob.test/other',
        pathname: 'moto/other-user/other.jpg',
        size: 1,
        contentType: 'text/plain',
      },
    },
  });
  expect(putRes.ok()).toBeTruthy();
  const { attachment: updated } = await putRes.json();
  expect(updated?.logId).toBe(logId);
  expect(updated?.id).toBe(attachment.id);
  expect(updated?.userId).toBe(attachment.userId);
  expect(updated?.createdAt).toBe(attachment.createdAt);
  expect(updated?.url).toBe(attachment.url);
  expect(updated?.pathname).toBe(attachment.pathname);
  expect(updated?.size).toBe(attachment.size);
  expect(updated?.contentType).toBe(attachment.contentType);

  // the newly-set logId is queryable via the log lookup
  const listRes = await request.get(`/api/attachments?log=${logId}`);
  const { attachments } = await listRes.json();
  expect(attachments.map((a: any) => a.id)).toContain(attachment.id);

  await request.delete(`/api/attachments/${attachment.id}`);
});

test('POST rejects a pathname outside the caller\'s prefix', async ({ request }) => {
  const badPrefixRes = await request.post('/api/attachments', {
    data: {
      attachment: {
        ...testAttachment('bad-prefix'),
        pathname: `moto/some-other-user/sneaky.jpg`,
      },
    },
  });
  expect(badPrefixRes.status()).toBe(400);

  const noPathnameRes = await request.post('/api/attachments', {
    data: { attachment: { ...testAttachment('no-pathname'), pathname: undefined } },
  });
  expect(noPathnameRes.status()).toBe(400);
});

test('POST is idempotent by pathname', async ({ request }) => {
  const attachmentData = testAttachment('idempotent');

  const firstRes = await request.post('/api/attachments', { data: { attachment: attachmentData } });
  expect(firstRes.ok()).toBeTruthy();
  const { attachment: first } = await firstRes.json();
  expect(first?.id).toBeTruthy();

  const retryRes = await request.post('/api/attachments', { data: { attachment: attachmentData } });
  expect(retryRes.ok()).toBeTruthy();
  const { attachment: retried } = await retryRes.json();
  expect(retried?.id).toBe(first.id);

  const listRes = await request.get(`/api/attachments`);
  const { attachments } = await listRes.json();
  expect(attachments.filter((a: any) => a.pathname == attachmentData.pathname).length).toBe(1);

  await request.delete(`/api/attachments/${first.id}`);
});

test('attachment routes 404 for a missing id', async ({ request }) => {
  const missingGetRes = await request.get('/api/attachments/does-not-exist');
  expect(missingGetRes.status()).toBe(404);

  const missingPutRes = await request.put('/api/attachments/does-not-exist', { data: { attachment: {} } });
  expect(missingPutRes.status()).toBe(404);

  const missingDeleteRes = await request.delete('/api/attachments/does-not-exist');
  expect(missingDeleteRes.status()).toBe(404);
});
