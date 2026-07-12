import { test, expect } from '@playwright/test';
import { smokeTestUserId } from '../../services/stores/memory';

// covers the Document routes: create (id/userId/status minted or forced server-side,
// title defaulting to the attachment's filename), vehicleId + attachmentId ownership
// validation on POST, ?vehicle= list filtering, PUT that edits title/type but pins
// identity + reference + ingest-lifecycle fields, DELETE cascading to the attachment
// record, and 404s for missing ids. The Playwright test server always impersonates a
// single non-admin user (smokeTestUserId), so the cross-user 403/400 paths can only be
// exercised via nonexistent ids (same limitation as ownership.spec.ts).
//
// Per the test-isolation convention everything is created via the API inside each spec
// (never asserted against seeds), with unique-per-run values.

const testVehicle = {
  type: 'motorcycle',
  maker: 'Test Maker',
  model: 'Document Test Model',
  year: 2022,
  mileage: 1000,
  modifications: [],
};

// unique per call so repeated runs against a reused dev server never collide on the
// attachments POST's pathname idempotency lookup
function testAttachment(suffix: string) {
  const filename = `test-${Date.now()}-${Math.random().toString(16).slice(2, 8)}-${suffix}.pdf`;
  return {
    url: `https://example.blob.test/moto/${smokeTestUserId}/${filename}`,
    pathname: `moto/${smokeTestUserId}/${filename}`,
    contentType: 'application/pdf',
    size: 12345,
    filename,
  };
}

async function createVehicle(request: any) {
  const res = await request.post('/api/vehicles', { data: { vehicle: testVehicle } });
  const { vehicle } = await res.json();
  expect(vehicle?.id).toBeTruthy();
  return vehicle;
}

async function createAttachment(request: any, suffix: string) {
  const res = await request.post('/api/attachments', { data: { attachment: testAttachment(suffix) } });
  const { attachment } = await res.json();
  expect(attachment?.id).toBeTruthy();
  return attachment;
}

test('document create mints id/userId, forces status, and defaults title to the filename', async ({ request }) => {
  const vehicle = await createVehicle(request);
  const attachment = await createAttachment(request, 'create');

  const createRes = await request.post('/api/documents', {
    data: {
      document: {
        vehicleId: vehicle.id,
        attachmentId: attachment.id,
        type: 'manual',
        title: 'Owner Manual',
        // all of these must be ignored/forced server-side
        id: 'client-supplied-id',
        status: 'ready',
        error: 'client-supplied error',
        pageCount: 999,
        userId: 'other-user',
      },
    },
  });
  expect(createRes.ok()).toBeTruthy();
  const { document } = await createRes.json();
  // store-minted 8-hex-char short uuid, not the client-supplied id
  expect(document?.id).toMatch(/^[0-9a-f]{8}$/);
  expect(document?.id).not.toBe('client-supplied-id');
  expect(document?.userId).toBe(smokeTestUserId);
  expect(document?.status).toBe('uploaded');
  expect(document?.error).toBeUndefined();
  expect(document?.pageCount).toBeUndefined();
  expect(document?.title).toBe('Owner Manual');
  expect(document?.type).toBe('manual');
  expect(document?.vehicleId).toBe(vehicle.id);
  expect(document?.attachmentId).toBe(attachment.id);

  const getRes = await request.get(`/api/documents/${document.id}`);
  expect(getRes.ok()).toBeTruthy();

  // no title in the payload → the attachment's filename
  const untitledAttachment = await createAttachment(request, 'untitled');
  const untitledRes = await request.post('/api/documents', {
    data: { document: { vehicleId: vehicle.id, attachmentId: untitledAttachment.id, type: 'other' } },
  });
  expect(untitledRes.ok()).toBeTruthy();
  const { document: untitled } = await untitledRes.json();
  expect(untitled?.title).toBe(untitledAttachment.filename);

  await request.delete(`/api/documents/${document.id}`);
  await request.delete(`/api/documents/${untitled.id}`);
  await request.delete(`/api/vehicles/${vehicle.id}`);
});

test('document POST validates vehicle and attachment ownership', async ({ request }) => {
  const vehicle = await createVehicle(request);
  const attachment = await createAttachment(request, 'validation');

  // nonexistent / missing vehicle
  const badVehicleRes = await request.post('/api/documents', {
    data: { document: { vehicleId: 'does-not-exist', attachmentId: attachment.id, type: 'manual' } },
  });
  expect(badVehicleRes.status()).toBe(400);

  const noVehicleRes = await request.post('/api/documents', {
    data: { document: { attachmentId: attachment.id, type: 'manual' } },
  });
  expect(noVehicleRes.status()).toBe(400);

  // nonexistent / missing attachment
  const badAttachmentRes = await request.post('/api/documents', {
    data: { document: { vehicleId: vehicle.id, attachmentId: 'does-not-exist', type: 'manual' } },
  });
  expect(badAttachmentRes.status()).toBe(400);

  const noAttachmentRes = await request.post('/api/documents', {
    data: { document: { vehicleId: vehicle.id, type: 'manual' } },
  });
  expect(noAttachmentRes.status()).toBe(400);

  await request.delete(`/api/attachments/${attachment.id}`);
  await request.delete(`/api/vehicles/${vehicle.id}`);
});

test('document PUT edits title/type but pins identity, references, and lifecycle fields', async ({ request }) => {
  const vehicle = await createVehicle(request);
  const attachment = await createAttachment(request, 'put');

  const createRes = await request.post('/api/documents', {
    data: { document: { vehicleId: vehicle.id, attachmentId: attachment.id, type: 'manual', title: 'Before' } },
  });
  const { document } = await createRes.json();
  expect(document?.id).toBeTruthy();

  const putRes = await request.put(`/api/documents/${document.id}`, {
    data: {
      document: {
        ...document,
        title: 'After',
        type: 'other',
        // hostile payload: attempts to change pinned fields must be ignored server-side
        id: 'other-id',
        userId: 'other-user',
        createdAt: 1,
        vehicleId: 'other-vehicle',
        attachmentId: 'other-attachment',
        status: 'ready',
        error: 'hostile error',
        pageCount: 999,
      },
    },
  });
  expect(putRes.ok()).toBeTruthy();
  const { document: updated } = await putRes.json();
  expect(updated?.title).toBe('After');
  expect(updated?.type).toBe('other');
  expect(updated?.id).toBe(document.id);
  expect(updated?.userId).toBe(document.userId);
  expect(updated?.createdAt).toBe(document.createdAt);
  expect(updated?.vehicleId).toBe(vehicle.id);
  expect(updated?.attachmentId).toBe(attachment.id);
  expect(updated?.status).toBe('uploaded');
  expect(updated?.error).toBeUndefined();
  expect(updated?.pageCount).toBeUndefined();

  await request.delete(`/api/documents/${document.id}`);
  await request.delete(`/api/vehicles/${vehicle.id}`);
});

test('documents list can be scoped by ?vehicle=', async ({ request }) => {
  const vehicle = await createVehicle(request);
  const otherVehicle = await createVehicle(request);

  const attachment = await createAttachment(request, 'list');
  const otherAttachment = await createAttachment(request, 'list-other');

  const createRes = await request.post('/api/documents', {
    data: { document: { vehicleId: vehicle.id, attachmentId: attachment.id, type: 'manual' } },
  });
  const { document } = await createRes.json();
  const otherRes = await request.post('/api/documents', {
    data: { document: { vehicleId: otherVehicle.id, attachmentId: otherAttachment.id, type: 'manual' } },
  });
  const { document: other } = await otherRes.json();
  expect(document?.id).toBeTruthy();
  expect(other?.id).toBeTruthy();

  const listRes = await request.get(`/api/documents?vehicle=${vehicle.id}`);
  expect(listRes.ok()).toBeTruthy();
  const { documents } = await listRes.json();
  expect(documents.map((d: any) => d.id)).toContain(document.id);
  expect(documents.map((d: any) => d.id)).not.toContain(other.id);

  // the unscoped list has both
  const allRes = await request.get('/api/documents');
  const { documents: all } = await allRes.json();
  expect(all.map((d: any) => d.id)).toContain(document.id);
  expect(all.map((d: any) => d.id)).toContain(other.id);

  await request.delete(`/api/documents/${document.id}`);
  await request.delete(`/api/documents/${other.id}`);
  await request.delete(`/api/vehicles/${vehicle.id}`);
  await request.delete(`/api/vehicles/${otherVehicle.id}`);
});

test('document DELETE cascades to its attachment record', async ({ request }) => {
  const vehicle = await createVehicle(request);
  const attachment = await createAttachment(request, 'cascade');

  const createRes = await request.post('/api/documents', {
    data: { document: { vehicleId: vehicle.id, attachmentId: attachment.id, type: 'manual' } },
  });
  const { document } = await createRes.json();
  expect(document?.id).toBeTruthy();

  // record deletion works even though the blob pathname is fake (blob deletion is
  // best-effort), and both the document and its attachment are really gone afterwards
  const deleteRes = await request.delete(`/api/documents/${document.id}`);
  expect(deleteRes.status()).toBe(200);

  const goneRes = await request.get(`/api/documents/${document.id}`);
  expect(goneRes.status()).toBe(404);

  const attachmentGoneRes = await request.get(`/api/attachments/${attachment.id}`);
  expect(attachmentGoneRes.status()).toBe(404);

  await request.delete(`/api/vehicles/${vehicle.id}`);
});

test('document routes 404 for a missing id', async ({ request }) => {
  const missingGetRes = await request.get('/api/documents/does-not-exist');
  expect(missingGetRes.status()).toBe(404);

  const missingPutRes = await request.put('/api/documents/does-not-exist', { data: { document: {} } });
  expect(missingPutRes.status()).toBe(404);

  const missingDeleteRes = await request.delete('/api/documents/does-not-exist');
  expect(missingDeleteRes.status()).toBe(404);
});
