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

// per the test-isolation convention these specs create their own vehicle rather than
// mutating/depending on the seeded one
const testVehicle = {
  type: 'motorcycle',
  maker: 'Test Maker',
  model: 'Attachment Test Model',
  year: 2021,
  mileage: 1000,
  modifications: [],
};

test('POST /api/logs with attachmentIds links the attachments to the new log', async ({ request }) => {
  const vehicleRes = await request.post('/api/vehicles', { data: { vehicle: testVehicle } });
  const { vehicle } = await vehicleRes.json();
  expect(vehicle?.id).toBeTruthy();

  const firstRes = await request.post('/api/attachments', {
    data: { attachment: testAttachment('log-link-1') },
  });
  const { attachment: first } = await firstRes.json();
  const secondRes = await request.post('/api/attachments', {
    data: { attachment: testAttachment('log-link-2') },
  });
  const { attachment: second } = await secondRes.json();
  expect(first?.id).toBeTruthy();
  expect(second?.id).toBeTruthy();
  expect(first?.logId).toBeFalsy();

  const logRes = await request.post('/api/logs', {
    data: {
      log: { vehicleId: vehicle.id, type: 'journal', entry: 'entry with attachments' },
      // a bogus id must be skipped without failing the save
      attachmentIds: [first.id, second.id, 'does-not-exist'],
    },
  });
  expect(logRes.ok()).toBeTruthy();
  // response is still just the log, exactly as before
  const { log } = await logRes.json();
  expect(log?.id).toBeTruthy();
  expect(log?.entry).toBe('entry with attachments');
  expect(log?.attachmentIds).toBeUndefined();

  // both attachments now carry the log's id and (denormalized) vehicle id
  const listRes = await request.get(`/api/attachments?log=${log.id}`);
  const { attachments } = await listRes.json();
  expect(attachments.map((a: any) => a.id).sort()).toEqual([first.id, second.id].sort());
  for (const linked of attachments) {
    expect(linked.logId).toBe(log.id);
    expect(linked.vehicleId).toBe(vehicle.id);
  }

  await request.delete(`/api/attachments/${first.id}`);
  await request.delete(`/api/attachments/${second.id}`);
  await request.delete(`/api/logs/${log.id}`);
  await request.delete(`/api/vehicles/${vehicle.id}`);
});

test('POST /api/logs never re-links an attachment already linked to another log', async ({ request }) => {
  const vehicleRes = await request.post('/api/vehicles', { data: { vehicle: testVehicle } });
  const { vehicle } = await vehicleRes.json();
  expect(vehicle?.id).toBeTruthy();

  const otherLogId = `test-log-${Date.now()}-${Math.random().toString(16).slice(2, 8)}`;
  const takenRes = await request.post('/api/attachments', {
    data: { attachment: { ...testAttachment('log-taken'), logId: otherLogId } },
  });
  const { attachment: taken } = await takenRes.json();
  expect(taken?.logId).toBe(otherLogId);

  const logRes = await request.post('/api/logs', {
    data: {
      log: { vehicleId: vehicle.id, type: 'journal', entry: 'entry trying to steal an attachment' },
      attachmentIds: [taken.id],
    },
  });
  expect(logRes.ok()).toBeTruthy();
  const { log } = await logRes.json();
  expect(log?.id).toBeTruthy();

  // the attachment stays with its original log, untouched
  const getRes = await request.get(`/api/attachments/${taken.id}`);
  const { attachment: after } = await getRes.json();
  expect(after?.logId).toBe(otherLogId);
  expect(after?.vehicleId).toBeFalsy();

  const listRes = await request.get(`/api/attachments?log=${log.id}`);
  const { attachments } = await listRes.json();
  expect(attachments.map((a: any) => a.id)).not.toContain(taken.id);

  await request.delete(`/api/attachments/${taken.id}`);
  await request.delete(`/api/logs/${log.id}`);
  await request.delete(`/api/vehicles/${vehicle.id}`);
});

test('attachment routes 404 for a missing id', async ({ request }) => {
  const missingGetRes = await request.get('/api/attachments/does-not-exist');
  expect(missingGetRes.status()).toBe(404);

  const missingPutRes = await request.put('/api/attachments/does-not-exist', { data: { attachment: {} } });
  expect(missingPutRes.status()).toBe(404);

  const missingDeleteRes = await request.delete('/api/attachments/does-not-exist');
  expect(missingDeleteRes.status()).toBe(404);
});
