import { test, expect } from '@playwright/test';
import fs from 'fs';
import path from 'path';
import { smokeTestUserId } from '../../services/stores/memory';
import { CANONICAL_COMPONENT_KEYS } from '../../types/MaintenanceSchedule';

// covers the S10 MaintenanceSchedule surface under AI_MOCK + BLOB_MOCK + memory store:
// POST /api/documents/[id]/schedule (extraction → proposed record built from the canned
// manualSchedule mock in test/fixtures/ai-mocks.json), the schedules CRUD routes, and —
// most importantly — the confirmation invariant: services/schedules.ts's
// confirmSchedule is the ONLY path to status "confirmed", and confirming swap-deletes
// any other confirmed schedule for the vehicle, so at most one confirmed schedule ever
// exists per vehicle.
//
// Per the test-isolation convention everything is created via the API inside each spec
// (never asserted against seeds), with unique-per-run values; each test uses its own
// vehicle so parallel specs' schedules can't bleed into ?vehicle=-scoped assertions.

const pdfDataUrl = `data:application/pdf;base64,${
  fs.readFileSync(path.join(__dirname, '../fixtures/mini-manual.pdf')).toString('base64')
}`;

const testVehicle = {
  type: 'motorcycle',
  maker: 'Test Maker',
  model: 'Schedule Test Model',
  year: 2024,
  mileage: 3000,
  modifications: [],
};

// unique pathname per call so repeated runs against a reused dev server never collide
// on the attachments POST's pathname idempotency lookup
function testAttachment(suffix: string) {
  const filename = `test-schedule-${Date.now()}-${Math.random().toString(16).slice(2, 8)}-${suffix}.pdf`;
  return {
    url: pdfDataUrl,
    pathname: `moto/${smokeTestUserId}/${filename}`,
    contentType: 'application/pdf',
    size: pdfDataUrl.length,
    filename,
  };
}

async function createVehicle(request: any) {
  const res = await request.post('/api/vehicles', { data: { vehicle: testVehicle } });
  const { vehicle } = await res.json();
  expect(vehicle?.id).toBeTruthy();
  return vehicle;
}

async function createDocument(request: any, suffix: string, type = 'manual') {
  const vehicle = await createVehicle(request);

  const attachmentRes = await request.post('/api/attachments', {
    data: { attachment: testAttachment(suffix) },
  });
  const { attachment } = await attachmentRes.json();
  expect(attachment?.id).toBeTruthy();

  const documentRes = await request.post('/api/documents', {
    data: { document: { vehicleId: vehicle.id, attachmentId: attachment.id, type } },
  });
  const { document } = await documentRes.json();
  expect(document?.id).toBeTruthy();

  return { vehicle, document };
}

async function extract(request: any, documentId: string) {
  const res = await request.post(`/api/documents/${documentId}/schedule`);
  expect(res.ok()).toBeTruthy();
  const { schedule } = await res.json();
  expect(schedule?.id).toBeTruthy();
  return schedule;
}

async function listSchedules(request: any, vehicleId: string) {
  const res = await request.get(`/api/schedules?vehicle=${vehicleId}`);
  expect(res.ok()).toBeTruthy();
  const { schedules } = await res.json();
  return schedules;
}

async function cleanup(request: any, vehicleId: string, documentId?: string) {
  const schedules = await listSchedules(request, vehicleId);
  for (const schedule of schedules) {
    await request.delete(`/api/schedules/${schedule.id}`);
  }
  if (documentId) await request.delete(`/api/documents/${documentId}`);
  await request.delete(`/api/vehicles/${vehicleId}`);
}

test('extraction creates a proposed schedule with the canned items', async ({ request }) => {
  const { vehicle, document } = await createDocument(request, 'happy');

  const schedule = await extract(request, document.id);

  // store-minted id + identity/provenance fields set server-side
  expect(schedule.id).toMatch(/^[0-9a-f]{8}$/);
  expect(schedule.userId).toBe(smokeTestUserId);
  expect(schedule.vehicleId).toBe(vehicle.id);
  expect(schedule.documentId).toBe(document.id);
  expect(schedule.source).toBe('manual');
  expect(schedule.status).toBe('proposed');

  // the canned manualSchedule mock: 6 items, canonical keys, normalized fields
  expect(schedule.items).toHaveLength(6);
  for (const item of schedule.items) {
    expect(CANONICAL_COMPONENT_KEYS).toContain(item.key);
    expect(item.name).toBeTruthy();
    expect(['replace', 'inspect', 'adjust', 'lubricate', 'clean', 'other']).toContain(item.action);
  }
  const engineOil = schedule.items.find((item: any) => item.key == 'engine-oil');
  expect(engineOil).toMatchObject({ action: 'replace', intervalKm: 8000, intervalMonths: 12, firstAtKm: 1000 });
  // nulls from the extraction are normalized away, not stored
  const brakeFluid = schedule.items.find((item: any) => item.key == 'brake-fluid');
  expect(brakeFluid.intervalKm).toBeUndefined();
  expect(brakeFluid.intervalMonths).toBe(24);

  // ...and it's retrievable via the vehicle-scoped list
  const schedules = await listSchedules(request, vehicle.id);
  expect(schedules.map((s: any) => s.id)).toContain(schedule.id);

  await cleanup(request, vehicle.id, document.id);
});

test('PUT applies item edits and confirming flips status via the service path', async ({ request }) => {
  const { vehicle, document } = await createDocument(request, 'confirm');
  const schedule = await extract(request, document.id);

  // edit one item and confirm in the same PUT
  const editedItems = schedule.items.map((item: any) =>
    item.key == 'engine-oil' ? { ...item, intervalKm: 6000 } : item);
  const putRes = await request.put(`/api/schedules/${schedule.id}`, {
    data: { schedule: { ...schedule, items: editedItems, status: 'confirmed' } },
  });
  expect(putRes.ok()).toBeTruthy();
  const { schedule: confirmed } = await putRes.json();
  expect(confirmed.status).toBe('confirmed');
  expect(confirmed.items.find((item: any) => item.key == 'engine-oil').intervalKm).toBe(6000);

  // stuck on the record
  const getRes = await request.get(`/api/schedules/${schedule.id}`);
  const { schedule: fetched } = await getRes.json();
  expect(fetched.status).toBe('confirmed');
  expect(fetched.items.find((item: any) => item.key == 'engine-oil').intervalKm).toBe(6000);

  // re-confirm is an idempotent no-op — still confirmed, still exactly one schedule
  const reconfirmRes = await request.put(`/api/schedules/${schedule.id}`, {
    data: { schedule: { ...fetched, status: 'confirmed' } },
  });
  expect(reconfirmRes.ok()).toBeTruthy();
  const { schedule: reconfirmed } = await reconfirmRes.json();
  expect(reconfirmed.status).toBe('confirmed');
  const schedules = await listSchedules(request, vehicle.id);
  expect(schedules).toHaveLength(1);

  await cleanup(request, vehicle.id, document.id);
});

test('re-extraction proposes alongside the confirmed schedule; confirming swaps', async ({ request }) => {
  const { vehicle, document } = await createDocument(request, 'swap');

  const first = await extract(request, document.id);
  await request.put(`/api/schedules/${first.id}`, {
    data: { schedule: { ...first, status: 'confirmed' } },
  });

  // extract again: a NEW proposed exists alongside the confirmed one
  const second = await extract(request, document.id);
  expect(second.id).not.toBe(first.id);
  expect(second.status).toBe('proposed');

  let schedules = await listSchedules(request, vehicle.id);
  expect(schedules).toHaveLength(2);
  expect(schedules.filter((s: any) => s.status == 'confirmed').map((s: any) => s.id)).toEqual([first.id]);

  // confirming the new one swap-deletes the old confirmed record
  const confirmRes = await request.put(`/api/schedules/${second.id}`, {
    data: { schedule: { ...second, status: 'confirmed' } },
  });
  expect(confirmRes.ok()).toBeTruthy();

  schedules = await listSchedules(request, vehicle.id);
  expect(schedules).toHaveLength(1);
  expect(schedules[0].id).toBe(second.id);
  expect(schedules[0].status).toBe('confirmed');

  // the old confirmed schedule is really gone (hardDelete)
  const goneRes = await request.get(`/api/schedules/${first.id}`);
  expect(goneRes.status()).toBe(404);

  await cleanup(request, vehicle.id, document.id);
});

test('POST arriving with status confirmed lands confirmed via the swap path', async ({ request }) => {
  const vehicle = await createVehicle(request);

  const items = [{ key: 'engine-oil', name: 'Engine oil', action: 'replace', intervalKm: 10000 }];
  const firstRes = await request.post('/api/schedules', {
    data: { schedule: { vehicleId: vehicle.id, source: 'user', status: 'confirmed', items, id: 'client-supplied-id', userId: 'other-user' } },
  });
  expect(firstRes.ok()).toBeTruthy();
  const { schedule: first } = await firstRes.json();
  // created as proposed then promoted through confirmSchedule — arrives confirmed
  expect(first.status).toBe('confirmed');
  expect(first.id).toMatch(/^[0-9a-f]{8}$/);
  expect(first.id).not.toBe('client-supplied-id');
  expect(first.userId).toBe(smokeTestUserId);
  expect(first.source).toBe('user');

  // a second confirmed POST proves the swap runs on this entrance too
  const secondRes = await request.post('/api/schedules', {
    data: { schedule: { vehicleId: vehicle.id, source: 'user', status: 'confirmed', items } },
  });
  const { schedule: second } = await secondRes.json();
  expect(second.status).toBe('confirmed');

  const schedules = await listSchedules(request, vehicle.id);
  expect(schedules).toHaveLength(1);
  expect(schedules[0].id).toBe(second.id);

  const goneRes = await request.get(`/api/schedules/${first.id}`);
  expect(goneRes.status()).toBe(404);

  // ...while a plain POST (no status) lands proposed
  const proposedRes = await request.post('/api/schedules', {
    data: { schedule: { vehicleId: vehicle.id, source: 'user', items } },
  });
  const { schedule: proposed } = await proposedRes.json();
  expect(proposed.status).toBe('proposed');

  await cleanup(request, vehicle.id);
});

test('POST validates vehicle ownership', async ({ request }) => {
  const badVehicleRes = await request.post('/api/schedules', {
    data: { schedule: { vehicleId: 'does-not-exist', items: [] } },
  });
  expect(badVehicleRes.status()).toBe(400);

  const noVehicleRes = await request.post('/api/schedules', {
    data: { schedule: { items: [] } },
  });
  expect(noVehicleRes.status()).toBe(400);
});

test('extraction 400s for a non-manual document and 404s for a missing one', async ({ request }) => {
  const { vehicle, document } = await createDocument(request, 'nonmanual', 'other');

  const res = await request.post(`/api/documents/${document.id}/schedule`);
  expect(res.status()).toBe(400);

  const missingRes = await request.post('/api/documents/does-not-exist/schedule');
  expect(missingRes.status()).toBe(404);

  await cleanup(request, vehicle.id, document.id);
});

test('hostile PUT cannot change identity, references, or provenance', async ({ request }) => {
  const { vehicle, document } = await createDocument(request, 'hostile');
  const schedule = await extract(request, document.id);

  const putRes = await request.put(`/api/schedules/${schedule.id}`, {
    data: {
      schedule: {
        ...schedule,
        items: [],
        // hostile payload: attempts to change pinned fields must be ignored server-side
        id: 'other-id',
        userId: 'other-user',
        createdAt: 1,
        vehicleId: 'other-vehicle',
        documentId: 'other-document',
        source: 'generic',
      },
    },
  });
  expect(putRes.ok()).toBeTruthy();
  const { schedule: updated } = await putRes.json();
  expect(updated.items).toHaveLength(0);
  expect(updated.id).toBe(schedule.id);
  expect(updated.userId).toBe(schedule.userId);
  expect(updated.createdAt).toBe(schedule.createdAt);
  expect(updated.vehicleId).toBe(vehicle.id);
  expect(updated.documentId).toBe(document.id);
  expect(updated.source).toBe('manual');
  expect(updated.status).toBe('proposed');

  await cleanup(request, vehicle.id, document.id);
});

test('schedule routes 404 for a missing id', async ({ request }) => {
  const missingGetRes = await request.get('/api/schedules/does-not-exist');
  expect(missingGetRes.status()).toBe(404);

  const missingPutRes = await request.put('/api/schedules/does-not-exist', { data: { schedule: {} } });
  expect(missingPutRes.status()).toBe(404);

  const missingDeleteRes = await request.delete('/api/schedules/does-not-exist');
  expect(missingDeleteRes.status()).toBe(404);
});
