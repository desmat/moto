import { test, expect } from '@playwright/test';
import { smokeTestUserId } from '../../services/stores/memory';

// covers S11's receipt route + service-log mileage semantics against AI_MOCK=true
// (playwright.config.ts): POST /api/ai/receipt returns the canned, normalized
// extraction for an owned image attachment (404 missing / 400 non-image), and saveLog's
// per-type vehicle-mileage rules — mileage-type logs overwrite always, service logs
// update monotonically (a backdated receipt must never clobber a newer reading).
// Per the test-isolation convention, every record is created here via the API with
// unique-per-run values; nothing asserts against the memory-store seeds.

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

function testVehicle(mileage: number) {
  return {
    type: 'motorcycle',
    maker: 'Test Maker',
    model: `Receipt API Model ${Date.now()}-${Math.random().toString(16).slice(2, 8)}`,
    year: 2023,
    mileage,
    modifications: [],
  };
}

async function vehicleMileage(request: any, vehicleId: string): Promise<number> {
  const res = await request.get(`/api/vehicles/${vehicleId}`);
  const { vehicle } = await res.json();
  return vehicle?.mileage;
}

test('POST /api/ai/receipt returns the canned, normalized mock extraction for an owned image attachment', async ({ request }) => {
  const createRes = await request.post('/api/attachments', {
    data: { attachment: testAttachment('receipt') },
  });
  expect(createRes.ok()).toBeTruthy();
  const { attachment } = await createRes.json();
  expect(attachment?.id).toBeTruthy();

  const ocrRes = await request.post('/api/ai/receipt', {
    data: { attachmentId: attachment.id },
  });
  expect(ocrRes.ok()).toBeTruthy();
  const { result } = await ocrRes.json();

  // the canned "receipt" mock from test/fixtures/ai-mocks.json, after
  // services/receipt.ts's normalization (null note dropped, keys slugified)
  expect(result).toEqual({
    receipt_clearly_visible: true,
    date: '20260315',
    vendor: 'Moto Garage TestShop',
    mileage: 17200,
    totalCost: 612.45,
    items: [
      { key: 'front-tire', name: 'Front tire', action: 'replace', note: 'Michelin Anakee Adventure', cost: 289.99 },
      { key: 'engine-oil', name: 'Engine oil', action: 'replace', note: '10W-30 full synthetic', cost: 89.5 },
      { key: 'chain', name: 'Drive chain', action: 'lubricate', cost: 25 },
    ],
  });

  await request.delete(`/api/attachments/${attachment.id}`);
});

test('POST /api/ai/receipt 404s for a missing attachment', async ({ request }) => {
  const missingRes = await request.post('/api/ai/receipt', {
    data: { attachmentId: 'does-not-exist' },
  });
  expect(missingRes.status()).toBe(404);

  // no attachmentId at all is also "not found", not a 500
  const noIdRes = await request.post('/api/ai/receipt', { data: {} });
  expect(noIdRes.status()).toBe(404);
});

test('POST /api/ai/receipt 400s for a non-image attachment', async ({ request }) => {
  const createRes = await request.post('/api/attachments', {
    data: { attachment: testAttachment('receipt-pdf', 'application/pdf') },
  });
  expect(createRes.ok()).toBeTruthy();
  const { attachment } = await createRes.json();
  expect(attachment?.id).toBeTruthy();

  const ocrRes = await request.post('/api/ai/receipt', {
    data: { attachmentId: attachment.id },
  });
  expect(ocrRes.status()).toBe(400);

  await request.delete(`/api/attachments/${attachment.id}`);
});

test('POST /api/ai/receipt accepts multiple pages (attachmentIds) and validates each', async ({ request }) => {
  // a receipt photographed page by page (S11b) goes up as attachmentIds: [...]
  const pages = [];
  for (const suffix of ['page1', 'page2']) {
    const res = await request.post('/api/attachments', { data: { attachment: testAttachment(suffix) } });
    const { attachment } = await res.json();
    expect(attachment?.id).toBeTruthy();
    pages.push(attachment);
  }

  // both pages readable → one combined (canned) result
  const ocrRes = await request.post('/api/ai/receipt', {
    data: { attachmentIds: pages.map((p) => p.id) },
  });
  expect(ocrRes.ok()).toBeTruthy();
  const { result } = await ocrRes.json();
  expect(result?.receipt_clearly_visible).toBe(true);
  expect(result?.vendor).toBe('Moto Garage TestShop');

  // one bad id in the batch → 404 for the whole call
  const missingRes = await request.post('/api/ai/receipt', {
    data: { attachmentIds: [pages[0].id, 'does-not-exist'] },
  });
  expect(missingRes.status()).toBe(404);

  // one non-image in the batch → 400 for the whole call
  const pdfRes = await request.post('/api/attachments', {
    data: { attachment: testAttachment('page-pdf', 'application/pdf') },
  });
  const { attachment: pdf } = await pdfRes.json();
  const mixedRes = await request.post('/api/ai/receipt', {
    data: { attachmentIds: [pages[0].id, pdf.id] },
  });
  expect(mixedRes.status()).toBe(400);

  // an empty list is "nothing to read", not a 500
  const emptyRes = await request.post('/api/ai/receipt', { data: { attachmentIds: [] } });
  expect(emptyRes.status()).toBe(404);

  for (const p of pages) await request.delete(`/api/attachments/${p.id}`);
  await request.delete(`/api/attachments/${pdf.id}`);
});

test('a service log saved without notes gets an entry composed from its items + vendor', async ({ request }) => {
  const vehicleRes = await request.post('/api/vehicles', { data: { vehicle: testVehicle(500) } });
  const { vehicle } = await vehicleRes.json();
  expect(vehicle?.id).toBeTruthy();

  // no entry text → composed from item names + vendor
  const res = await request.post('/api/logs', {
    data: {
      log: {
        vehicleId: vehicle.id,
        type: 'service',
        items: [
          { key: 'front-tire', name: 'Front tire', action: 'replace' },
          { key: 'engine-oil', name: 'Engine oil', action: 'replace' },
        ],
        vendor: 'Entry TestShop',
      },
    },
  });
  expect(res.ok()).toBeTruthy();
  const { log } = await res.json();
  expect(log?.entry).toBe('Front tire, Engine oil — Entry TestShop');

  // no vendor → just the item names
  const noVendorRes = await request.post('/api/logs', {
    data: {
      log: {
        vehicleId: vehicle.id,
        type: 'service',
        items: [{ key: 'chain', name: 'Drive chain', action: 'lubricate' }],
      },
    },
  });
  const { log: noVendorLog } = await noVendorRes.json();
  expect(noVendorLog?.entry).toBe('Drive chain');

  // a real 25-line invoice must not flood the entry: capped names + "+N more"
  const manyItems = Array.from({ length: 25 }, (_, i) => ({
    key: `part-${i}`, name: `Replacement part number ${i}`, action: 'replace',
  }));
  const manyRes = await request.post('/api/logs', {
    data: {
      log: { vehicleId: vehicle.id, type: 'service', items: manyItems, vendor: 'Big Invoice Shop' },
    },
  });
  const { log: manyLog } = await manyRes.json();
  expect(manyLog?.entry).toMatch(/\+\d+ more — Big Invoice Shop$/);
  expect(manyLog?.entry.length).toBeLessThan(200);

  // user-typed notes always win
  const typedRes = await request.post('/api/logs', {
    data: {
      log: {
        vehicleId: vehicle.id,
        type: 'service',
        entry: 'my own words',
        items: [{ key: 'chain', name: 'Drive chain', action: 'lubricate' }],
        vendor: 'Entry TestShop',
      },
    },
  });
  const { log: typedLog } = await typedRes.json();
  expect(typedLog?.entry).toBe('my own words');

  for (const l of [log, noVendorLog, manyLog, typedLog]) await request.delete(`/api/logs/${l.id}`);
  await request.delete(`/api/vehicles/${vehicle.id}`);
});

test('service-log mileage updates the vehicle monotonically; mileage logs keep overwrite-always', async ({ request }) => {
  // fresh vehicle owned by this run, starting at 1000
  const vehicleRes = await request.post('/api/vehicles', { data: { vehicle: testVehicle(1000) } });
  const { vehicle } = await vehicleRes.json();
  expect(vehicle?.id).toBeTruthy();
  const createdLogIds: string[] = [];

  // 1) a service log carrying mileage 5000 (> 1000) raises the vehicle to 5000
  const serviceRes = await request.post('/api/logs', {
    data: {
      log: {
        vehicleId: vehicle.id,
        type: 'service',
        date: '20260601',
        entry: 'front tire replaced',
        items: [{ key: 'front-tire', name: 'Front tire', action: 'replace', cost: 250 }],
        mileage: 5000,
        vendor: 'Monotonic TestShop',
        totalCost: 250,
      },
    },
  });
  expect(serviceRes.ok()).toBeTruthy();
  const { log: serviceLog } = await serviceRes.json();
  expect(serviceLog?.type).toBe('service');
  expect(serviceLog?.items?.length).toBe(1);
  createdLogIds.push(serviceLog.id);
  expect(await vehicleMileage(request, vehicle.id)).toBe(5000);

  // 2) a BACKDATED service log with a lower mileage must NOT clobber the newer reading
  const backdatedRes = await request.post('/api/logs', {
    data: {
      log: {
        vehicleId: vehicle.id,
        type: 'service',
        date: '20260101',
        entry: 'old oil change receipt',
        items: [{ key: 'engine-oil', name: 'Engine oil', action: 'replace' }],
        mileage: 3000,
      },
    },
  });
  expect(backdatedRes.ok()).toBeTruthy();
  const { log: backdatedLog } = await backdatedRes.json();
  createdLogIds.push(backdatedLog.id);
  expect(await vehicleMileage(request, vehicle.id)).toBe(5000); // unchanged

  // 3) a mileage-type log keeps overwrite-always semantics — deliberate downward
  // corrections stay possible through it
  const mileageRes = await request.post('/api/logs', {
    data: { log: { vehicleId: vehicle.id, type: 'mileage', entry: '2500' } },
  });
  expect(mileageRes.ok()).toBeTruthy();
  const { log: mileageLog } = await mileageRes.json();
  createdLogIds.push(mileageLog.id);
  expect(await vehicleMileage(request, vehicle.id)).toBe(2500);

  // 4) a service log with NO mileage leaves the vehicle untouched
  const noMileageRes = await request.post('/api/logs', {
    data: {
      log: {
        vehicleId: vehicle.id,
        type: 'service',
        entry: 'chain lubed',
        items: [{ key: 'chain', name: 'Drive chain', action: 'lubricate' }],
      },
    },
  });
  expect(noMileageRes.ok()).toBeTruthy();
  const { log: noMileageLog } = await noMileageRes.json();
  createdLogIds.push(noMileageLog.id);
  expect(await vehicleMileage(request, vehicle.id)).toBe(2500); // unchanged

  // cleanup
  for (const id of createdLogIds) {
    await request.delete(`/api/logs/${id}`);
  }
  await request.delete(`/api/vehicles/${vehicle.id}`);
});

test('hostile structured fields on a journal log are stored-but-inert (no crash, vehicle untouched)', async ({ request }) => {
  const vehicleRes = await request.post('/api/vehicles', { data: { vehicle: testVehicle(4321) } });
  const { vehicle } = await vehicleRes.json();
  expect(vehicle?.id).toBeTruthy();

  // a journal log carrying junk items[] (and no mileage): documented behavior is
  // stored-but-inert — items only gain meaning on service logs (and stay
  // service-restricted in S12's components update too)
  const hostileRes = await request.post('/api/logs', {
    data: {
      log: {
        vehicleId: vehicle.id,
        type: 'journal',
        entry: 'just a note with junk fields',
        items: [{ key: null, bogus: true, cost: 'not-a-number' }, 'not-even-an-object'],
        totalCost: 'free?',
      },
    },
  });
  expect(hostileRes.ok()).toBeTruthy();
  const { log: hostileLog } = await hostileRes.json();
  expect(hostileLog?.id).toBeTruthy();
  expect(hostileLog?.type).toBe('journal');

  // the vehicle's mileage is untouched by the journal log's junk
  expect(await vehicleMileage(request, vehicle.id)).toBe(4321);

  await request.delete(`/api/logs/${hostileLog.id}`);
  await request.delete(`/api/vehicles/${vehicle.id}`);
});
