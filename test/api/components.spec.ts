import { test, expect } from '@playwright/test';

// covers S12's vehicle.components snapshot: saving a SERVICE log with structured
// items[] folds each item into the owning vehicle's `components` (via saveLog's
// post-save block / applyItemsToComponents). Rules under test: replace sets `detail`,
// non-replace actions refresh "last touched" but keep `detail`, backdated logs never
// overwrite newer state, same key converges to one entry, deleting the source log
// leaves the snapshot standing, and non-service logs never touch components.
// Per the test-isolation convention, every record is created here via the API with
// unique-per-run values; nothing asserts against the memory-store seeds.

function testVehicle(mileage: number) {
  return {
    type: 'motorcycle',
    maker: 'Test Maker',
    model: `Components API Model ${Date.now()}-${Math.random().toString(16).slice(2, 8)}`,
    year: 2022,
    mileage,
    modifications: [],
  };
}

async function getComponents(request: any, vehicleId: string): Promise<any> {
  const res = await request.get(`/api/vehicles/${vehicleId}`);
  const { vehicle } = await res.json();
  return vehicle?.components;
}

async function postServiceLog(request: any, log: any): Promise<any> {
  const res = await request.post('/api/logs', { data: { log } });
  expect(res.ok()).toBeTruthy();
  const { log: saved } = await res.json();
  expect(saved?.id).toBeTruthy();
  return saved;
}

test('a service log replacing the front tire snapshots it into vehicle.components', async ({ request }) => {
  const vehicleRes = await request.post('/api/vehicles', { data: { vehicle: testVehicle(1000) } });
  const { vehicle } = await vehicleRes.json();
  expect(vehicle?.id).toBeTruthy();

  const log = await postServiceLog(request, {
    vehicleId: vehicle.id,
    type: 'service',
    date: '20260401',
    entry: 'replaced front tire',
    items: [{ key: 'front-tire', name: 'Front tire', action: 'replace', note: 'Michelin Anakee Adventure', cost: 289.99 }],
    mileage: 18300,
  });

  const components = await getComponents(request, vehicle.id);
  expect(components?.['front-tire']).toEqual({
    name: 'Front tire',
    detail: 'Michelin Anakee Adventure',
    action: 'replace',
    date: '20260401',
    mileage: 18300,
    logId: log.id,
  });

  await request.delete(`/api/logs/${log.id}`);
  await request.delete(`/api/vehicles/${vehicle.id}`);
});

test('a later inspect updates date/action but keeps the installed detail', async ({ request }) => {
  const vehicleRes = await request.post('/api/vehicles', { data: { vehicle: testVehicle(1000) } });
  const { vehicle } = await vehicleRes.json();

  const replaceLog = await postServiceLog(request, {
    vehicleId: vehicle.id,
    type: 'service',
    date: '20260401',
    entry: 'replaced front tire',
    items: [{ key: 'front-tire', name: 'Front tire', action: 'replace', note: 'Michelin Anakee Adventure' }],
    mileage: 18300,
  });

  const inspectLog = await postServiceLog(request, {
    vehicleId: vehicle.id,
    type: 'service',
    date: '20260501',
    entry: 'inspected front tire',
    items: [{ key: 'front-tire', name: 'Front tire', action: 'inspect' }],
    mileage: 19100,
  });

  const components = await getComponents(request, vehicle.id);
  expect(components?.['front-tire']).toEqual({
    name: 'Front tire',
    detail: 'Michelin Anakee Adventure', // unchanged — inspect is not an install
    action: 'inspect',
    date: '20260501',
    mileage: 19100,
    logId: inspectLog.id,
  });

  for (const l of [replaceLog, inspectLog]) await request.delete(`/api/logs/${l.id}`);
  await request.delete(`/api/vehicles/${vehicle.id}`);
});

test('a backdated replace of the same key never overwrites newer state', async ({ request }) => {
  const vehicleRes = await request.post('/api/vehicles', { data: { vehicle: testVehicle(1000) } });
  const { vehicle } = await vehicleRes.json();

  const freshLog = await postServiceLog(request, {
    vehicleId: vehicle.id,
    type: 'service',
    date: '20260401',
    entry: 'replaced front tire',
    items: [{ key: 'front-tire', name: 'Front tire', action: 'replace', note: 'Michelin Anakee Adventure' }],
    mileage: 18300,
  });
  const before = await getComponents(request, vehicle.id);

  // an old receipt logged after the fact: older date, different tire
  const backdatedLog = await postServiceLog(request, {
    vehicleId: vehicle.id,
    type: 'service',
    date: '20250101',
    entry: 'old tire receipt',
    items: [{ key: 'front-tire', name: 'Front tire', action: 'replace', note: 'Worn-out OEM tire' }],
    mileage: 9000,
  });

  const after = await getComponents(request, vehicle.id);
  expect(after?.['front-tire']).toEqual(before['front-tire']); // unchanged, still the fresh one
  expect(after['front-tire'].logId).toBe(freshLog.id);

  for (const l of [freshLog, backdatedLog]) await request.delete(`/api/logs/${l.id}`);
  await request.delete(`/api/vehicles/${vehicle.id}`);
});

test('two logs touching the same canonical key converge to a single entry', async ({ request }) => {
  const vehicleRes = await request.post('/api/vehicles', { data: { vehicle: testVehicle(1000) } });
  const { vehicle } = await vehicleRes.json();

  // different receipt phrasings, same canonical key (extraction-time canonicalization)
  const firstLog = await postServiceLog(request, {
    vehicleId: vehicle.id,
    type: 'service',
    date: '20260401',
    entry: 'front tyre fitted',
    items: [{ key: 'front-tire', name: 'Front tyre', action: 'replace', note: 'Anakee Adventure 110/80' }],
  });
  const secondLog = await postServiceLog(request, {
    vehicleId: vehicle.id,
    type: 'service',
    date: '20260601',
    entry: 'FR TIRE R&R',
    items: [{ key: 'front-tire', name: 'FR TIRE', action: 'replace', note: 'Road 6' }],
  });

  const components = await getComponents(request, vehicle.id);
  expect(Object.keys(components || {})).toEqual(['front-tire']);
  expect(components['front-tire'].detail).toBe('Road 6');
  expect(components['front-tire'].logId).toBe(secondLog.id);

  for (const l of [firstLog, secondLog]) await request.delete(`/api/logs/${l.id}`);
  await request.delete(`/api/vehicles/${vehicle.id}`);
});

test('deleting the source log leaves the components snapshot standing', async ({ request }) => {
  const vehicleRes = await request.post('/api/vehicles', { data: { vehicle: testVehicle(1000) } });
  const { vehicle } = await vehicleRes.json();

  const log = await postServiceLog(request, {
    vehicleId: vehicle.id,
    type: 'service',
    date: '20260401',
    entry: 'replaced front tire',
    items: [{ key: 'front-tire', name: 'Front tire', action: 'replace', note: 'Michelin Anakee Adventure' }],
  });

  const deleteRes = await request.delete(`/api/logs/${log.id}`);
  expect(deleteRes.ok()).toBeTruthy();

  // state is "what's on the bike", not an index of logs: the snapshot survives
  const components = await getComponents(request, vehicle.id);
  expect(components?.['front-tire']?.detail).toBe('Michelin Anakee Adventure');
  expect(components['front-tire'].logId).toBe(log.id); // now a dangling (404) link — by design

  await request.delete(`/api/vehicles/${vehicle.id}`);
});

test('a journal log carrying items[] never touches components (service-only rule)', async ({ request }) => {
  const vehicleRes = await request.post('/api/vehicles', { data: { vehicle: testVehicle(1000) } });
  const { vehicle } = await vehicleRes.json();

  const journalRes = await request.post('/api/logs', {
    data: {
      log: {
        vehicleId: vehicle.id,
        type: 'journal',
        date: '20260401',
        entry: 'diary entry with hand-added items',
        items: [{ key: 'front-tire', name: 'Front tire', action: 'replace', note: 'should be inert' }],
      },
    },
  });
  expect(journalRes.ok()).toBeTruthy();
  const { log: journalLog } = await journalRes.json();

  const components = await getComponents(request, vehicle.id);
  expect(components).toBeFalsy(); // stored-but-inert: no snapshot created

  await request.delete(`/api/logs/${journalLog.id}`);
  await request.delete(`/api/vehicles/${vehicle.id}`);
});
