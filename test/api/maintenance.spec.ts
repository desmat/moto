import { test, expect } from '@playwright/test';
import moment from 'moment';
import { rankMaintenanceItems } from '../../lib/maintenance';

// S14: the maintenance status engine through its routes — GET
// /api/vehicles/[id]/maintenance and GET /api/maintenance — under AI_MOCK + memory
// store. The determinism lives in lib/maintenance.ts's computeMaintenanceStatus; there
// is no unit runner, so the full matrix is exercised here: km-only, months-only,
// both-earlier-wins, never-done (+ firstAtKm), overdue/upcoming boundaries, the
// write-time classifier (deterministic keyword mock in services/ai.ts), and the
// distinct "no schedule" shape.
//
// Per the test-isolation convention every record is created via the API inside each
// test (never asserted against seeds); each test uses its own vehicle(s).
//
// Date fixtures are RELATIVE (moment from "now") with generous margins — km boundaries
// are pinned exactly (fully deterministic), date boundaries stay 7+ days away from the
// overdue/upcoming edges so month-end clamping and midnight rollovers can't flip them.

const DATE = 'YYYYMMDD';
const today = () => moment().format(DATE);
const daysAgo = (days: number) => moment().subtract(days, 'days').format(DATE);

async function createVehicle(request: any, mileage: number) {
  const res = await request.post('/api/vehicles', {
    data: {
      vehicle: {
        type: 'motorcycle',
        maker: 'Test Maker',
        model: `Maintenance Test ${Date.now()}-${Math.random().toString(16).slice(2, 8)}`,
        year: 2024,
        mileage,
        modifications: [],
      },
    },
  });
  const { vehicle } = await res.json();
  expect(vehicle?.id).toBeTruthy();
  return vehicle;
}

async function setVehicleMileage(request: any, vehicle: any, mileage: number) {
  const res = await request.put(`/api/vehicles/${vehicle.id}`, {
    data: { vehicle: { ...vehicle, mileage } },
  });
  expect(res.ok()).toBeTruthy();
}

// the sanctioned path to a confirmed schedule (services/schedules.ts's confirmSchedule
// invariant): POST a proposed record, then PUT it back with status "confirmed"
async function confirmSchedule(request: any, vehicleId: string, items: any[]) {
  const postRes = await request.post('/api/schedules', {
    data: { schedule: { vehicleId, source: 'user', items } },
  });
  expect(postRes.ok()).toBeTruthy();
  const { schedule } = await postRes.json();
  expect(schedule?.status).toBe('proposed');

  const putRes = await request.put(`/api/schedules/${schedule.id}`, {
    data: { schedule: { ...schedule, status: 'confirmed' } },
  });
  expect(putRes.ok()).toBeTruthy();
  const { schedule: confirmed } = await putRes.json();
  expect(confirmed.status).toBe('confirmed');
  return confirmed;
}

async function postLog(request: any, log: any) {
  const res = await request.post('/api/logs', { data: { log } });
  expect(res.ok()).toBeTruthy();
  const { log: saved } = await res.json();
  expect(saved?.id).toBeTruthy();
  return saved;
}

async function getMaintenance(request: any, vehicleId: string) {
  const res = await request.get(`/api/vehicles/${vehicleId}/maintenance`);
  expect(res.ok()).toBeTruthy();
  const { maintenance } = await res.json();
  expect(maintenance?.vehicleId).toBe(vehicleId);
  return maintenance;
}

// sweep everything a test created (logs first — deleting the vehicle doesn't cascade),
// so the long-lived shared store doesn't accumulate records: the smoke e2e asserts the
// SEEDED entries are visible on the createdAt-sorted dashboard list, and leftover logs
// from this spec would displace them
async function cleanup(request: any, ...vehicles: any[]) {
  for (const vehicle of vehicles) {
    const { logs } = await (await request.get(`/api/logs?vehicle=${vehicle.id}`)).json();
    for (const log of logs || []) await request.delete(`/api/logs/${log.id}`);
    const { schedules } = await (await request.get(`/api/schedules?vehicle=${vehicle.id}`)).json();
    for (const schedule of schedules || []) await request.delete(`/api/schedules/${schedule.id}`);
    await request.delete(`/api/vehicles/${vehicle.id}`);
  }
}

const itemFor = (maintenance: any, key: string) => {
  const item = maintenance.items.find((entry: any) => entry.item.key == key);
  expect(item).toBeTruthy();
  return item;
};

test('km-only interval: due math, upcoming window, and exact boundaries', async ({ request }) => {
  // interval 8000 km, last done at 5000 → due at 13000; upcoming window 10% = 800 km
  const vehicle = await createVehicle(request, 12199);
  await confirmSchedule(request, vehicle.id, [
    { key: 'engine-oil', name: 'Engine oil', action: 'replace', intervalKm: 8000 },
  ]);
  const serviceLog = await postLog(request, {
    vehicleId: vehicle.id,
    type: 'service',
    date: daysAgo(60),
    entry: 'Oil change',
    mileage: 5000, // below the vehicle's current mileage → monotonic rule leaves it alone
    items: [{ key: 'engine-oil', name: 'Engine oil', action: 'replace' }],
  });

  // 801 km remaining → just outside the 800 km window → ok
  let status = itemFor(await getMaintenance(request, vehicle.id), 'engine-oil');
  expect(status.lastDone).toMatchObject({ date: daysAgo(60), mileage: 5000, logId: serviceLog.id });
  expect(status.nextDue.km).toBe(13000);
  expect(status.nextDue.date).toBeUndefined(); // no months interval → no date axis
  expect(status.status).toBe('ok');
  expect(status.overdueByKm).toBeUndefined();

  // exactly 800 remaining → upcoming
  await setVehicleMileage(request, vehicle, 12200);
  status = itemFor(await getMaintenance(request, vehicle.id), 'engine-oil');
  expect(status.status).toBe('upcoming');

  // exactly AT the due km → still upcoming, not overdue (overdue is strictly past)
  await setVehicleMileage(request, vehicle, 13000);
  status = itemFor(await getMaintenance(request, vehicle.id), 'engine-oil');
  expect(status.status).toBe('upcoming');
  expect(status.overdueByKm).toBeUndefined();

  // one km past due → overdue by exactly 1
  await setVehicleMileage(request, vehicle, 13001);
  status = itemFor(await getMaintenance(request, vehicle.id), 'engine-oil');
  expect(status.status).toBe('overdue');
  expect(status.overdueByKm).toBe(1);
  expect(status.overdueByDays).toBeUndefined();

  await cleanup(request, vehicle);
});

test('months-only intervals: ok, upcoming, and overdue by date', async ({ request }) => {
  // one vehicle, three months-only items anchored by three service logs
  const vehicle = await createVehicle(request, 5000);
  await confirmSchedule(request, vehicle.id, [
    { key: 'chain', name: 'Drive chain', action: 'lubricate', intervalMonths: 6 },
    { key: 'engine-oil', name: 'Engine oil', action: 'replace', intervalMonths: 6 },
    { key: 'air-filter', name: 'Air filter', action: 'clean', intervalMonths: 6 },
  ]);
  const mkService = (date: string, key: string, name: string) =>
    postLog(request, {
      vehicleId: vehicle.id,
      type: 'service',
      date,
      entry: `${name} serviced`,
      items: [{ key, name, action: 'other' }],
    });

  await mkService(daysAgo(30), 'chain', 'Drive chain');            // due in ~5 months → ok
  await mkService(daysAgo(170), 'air-filter', 'Air filter');       // due in ~10 days → upcoming
  const oilLog = await mkService(daysAgo(220), 'engine-oil', 'Engine oil'); // due ~40 days ago → overdue

  const maintenance = await getMaintenance(request, vehicle.id);

  const chain = itemFor(maintenance, 'chain');
  expect(chain.status).toBe('ok');
  expect(chain.nextDue.date).toBe(moment(daysAgo(30), DATE).add(6, 'months').format(DATE));
  expect(chain.nextDue.km).toBeUndefined(); // no km interval → no km axis

  const airFilter = itemFor(maintenance, 'air-filter');
  expect(airFilter.status).toBe('upcoming');
  expect(airFilter.overdueByDays).toBeUndefined();

  const oil = itemFor(maintenance, 'engine-oil');
  expect(oil.status).toBe('overdue');
  expect(oil.lastDone.logId).toBe(oilLog.id);
  expect(oil.lastDone.mileage).toBeUndefined(); // log carried no mileage
  expect(oil.overdueByDays).toBeGreaterThan(30);
  expect(oil.overdueByKm).toBeUndefined();

  await cleanup(request, vehicle);
});

test('interval by both km and months: the earlier axis wins', async ({ request }) => {
  const items = [{ key: 'engine-oil', name: 'Engine oil', action: 'replace', intervalKm: 8000, intervalMonths: 12 }];
  const oilService = (vehicleId: string, date: string) => ({
    vehicleId,
    type: 'service',
    date,
    entry: 'Oil change',
    mileage: 5000,
    items: [{ key: 'engine-oil', name: 'Engine oil', action: 'replace' }],
  });

  // km comfortably ok (10000 of 13000) but the date axis ~1 month past due → overdue
  const byDate = await createVehicle(request, 10000);
  await confirmSchedule(request, byDate.id, items);
  await postLog(request, oilService(byDate.id, moment().subtract(13, 'months').format(DATE)));
  let status = itemFor(await getMaintenance(request, byDate.id), 'engine-oil');
  expect(status.status).toBe('overdue');
  expect(status.overdueByDays).toBeGreaterThan(7);
  expect(status.overdueByKm).toBeUndefined();
  expect(status.nextDue.km).toBe(13000); // both axes still reported

  // date comfortably ok (~11 months out) but 500 km past due → overdue
  const byKm = await createVehicle(request, 13500);
  await confirmSchedule(request, byKm.id, items);
  await postLog(request, oilService(byKm.id, daysAgo(30)));
  status = itemFor(await getMaintenance(request, byKm.id), 'engine-oil');
  expect(status.status).toBe('overdue');
  expect(status.overdueByKm).toBe(500);
  expect(status.overdueByDays).toBeUndefined();

  // km inside the upcoming window (500 of 800 remaining), date far out → upcoming
  const upcoming = await createVehicle(request, 12500);
  await confirmSchedule(request, upcoming.id, items);
  await postLog(request, oilService(upcoming.id, daysAgo(30)));
  status = itemFor(await getMaintenance(request, upcoming.id), 'engine-oil');
  expect(status.status).toBe('upcoming');

  await cleanup(request, byDate, byKm, upcoming);
});

test('never-done items: firstAtKm anchors, otherwise unknown', async ({ request }) => {
  const items = [
    { key: 'valve-clearance', name: 'Valve clearance', action: 'inspect', intervalKm: 6000, firstAtKm: 6000 },
    { key: 'spark-plugs', name: 'Spark plugs', action: 'replace', intervalKm: 6000 },  // km-only, no firstAtKm
    { key: 'coolant', name: 'Coolant', action: 'replace', intervalMonths: 24 },        // months-only, no history
  ];

  const fresh = await createVehicle(request, 1000);
  await confirmSchedule(request, fresh.id, items);
  let maintenance = await getMaintenance(request, fresh.id);

  // never done + firstAtKm → due at 6000, 5000 remaining → ok
  const valves = itemFor(maintenance, 'valve-clearance');
  expect(valves.lastDone).toBeUndefined();
  expect(valves.nextDue.km).toBe(6000);
  expect(valves.status).toBe('ok');

  // never done, km interval but NO firstAtKm → due-by-km unknowable → unknown
  const plugs = itemFor(maintenance, 'spark-plugs');
  expect(plugs.nextDue.km).toBeUndefined();
  expect(plugs.status).toBe('unknown');

  // never done, months-only → no anchor date → unknown
  expect(itemFor(maintenance, 'coolant').status).toBe('unknown');

  // past firstAtKm without ever being done → overdue
  const ridden = await createVehicle(request, 6100);
  await confirmSchedule(request, ridden.id, items);
  maintenance = await getMaintenance(request, ridden.id);
  const overdueValves = itemFor(maintenance, 'valve-clearance');
  expect(overdueValves.status).toBe('overdue');
  expect(overdueValves.overdueByKm).toBe(100);

  await cleanup(request, fresh, ridden);
});

test('write-time classifier: a free-text log becomes an item lastDone (keyword mock)', async ({ request }) => {
  const vehicle = await createVehicle(request, 5000);
  await confirmSchedule(request, vehicle.id, [
    { key: 'chain', name: 'Drive chain', action: 'lubricate', intervalMonths: 1 },
    { key: 'engine-oil', name: 'Engine oil', action: 'replace', intervalKm: 8000 },
  ]);

  // custom-type free text mentioning the chain → mock classifier maps it to ["chain"]
  const chainLog = await postLog(request, {
    vehicleId: vehicle.id,
    type: 'wrenching', // custom type — classified just like journal
    date: daysAgo(3),
    entry: 'lubed the chain',
  });
  const chainLogRes = await request.get(`/api/logs/${chainLog.id}`);
  const { log: storedChainLog } = await chainLogRes.json();
  expect(storedChainLog.scheduleKeys).toEqual(['chain']);

  // ...and the engine shows the chain item lastDone pointing at that log
  let maintenance = await getMaintenance(request, vehicle.id);
  const chain = itemFor(maintenance, 'chain');
  expect(chain.lastDone).toMatchObject({ date: daysAgo(3), logId: chainLog.id });
  expect(chain.lastDone.mileage).toBeUndefined();
  expect(chain.status).toBe('upcoming'); // due ~27 days out, inside the 30-day window
  // engine-oil untouched: never done, km-only, no firstAtKm → unknown
  expect(itemFor(maintenance, 'engine-oil').status).toBe('unknown');

  // a non-matching journal still gets classified — empty scheduleKeys, no lastDone
  const rideLog = await postLog(request, {
    vehicleId: vehicle.id,
    type: 'journal',
    date: daysAgo(1),
    entry: 'nice ride today',
  });
  const { log: storedRideLog } = await (await request.get(`/api/logs/${rideLog.id}`)).json();
  expect(storedRideLog.scheduleKeys).toEqual([]);

  // hand-supplied scheduleKeys are respected (the JSON-editor correction path): the
  // classifier is skipped, the keys stand, and the engine matches on them
  const handLog = await postLog(request, {
    vehicleId: vehicle.id,
    type: 'journal',
    date: daysAgo(2),
    entry: 'did some garage work',
    scheduleKeys: ['engine-oil'],
  });
  const { log: storedHandLog } = await (await request.get(`/api/logs/${handLog.id}`)).json();
  expect(storedHandLog.scheduleKeys).toEqual(['engine-oil']);
  maintenance = await getMaintenance(request, vehicle.id);
  expect(itemFor(maintenance, 'engine-oil').lastDone.logId).toBe(handLog.id);

  await cleanup(request, vehicle);
});

test('no confirmed schedule: distinct scheduleId-less shape, and the classifier stays off', async ({ request }) => {
  // no schedule at all → 200 with scheduleId absent + empty items (NOT an error)
  const bare = await createVehicle(request, 5000);
  const bareMaintenance = await getMaintenance(request, bare.id);
  expect(bareMaintenance.scheduleId).toBeUndefined();
  expect(bareMaintenance.items).toEqual([]);

  // a PROPOSED (unconfirmed) schedule is inert: same no-schedule shape...
  const proposed = await createVehicle(request, 5000);
  const postRes = await request.post('/api/schedules', {
    data: {
      schedule: {
        vehicleId: proposed.id,
        source: 'user',
        items: [{ key: 'chain', name: 'Drive chain', action: 'lubricate', intervalMonths: 1 }],
      },
    },
  });
  expect(postRes.ok()).toBeTruthy();
  const proposedMaintenance = await getMaintenance(request, proposed.id);
  expect(proposedMaintenance.scheduleId).toBeUndefined();
  expect(proposedMaintenance.items).toEqual([]);

  // ...and journal saves skip classification entirely (no scheduleKeys, not even [])
  const journal = await postLog(request, {
    vehicleId: proposed.id,
    type: 'journal',
    date: today(),
    entry: 'lubed the chain',
  });
  const { log: stored } = await (await request.get(`/api/logs/${journal.id}`)).json();
  expect(stored.scheduleKeys).toBeUndefined();

  await cleanup(request, bare, proposed);
});

test('lastReading reflects the newest odometer observation', async ({ request }) => {
  const vehicle = await createVehicle(request, 5000);
  await confirmSchedule(request, vehicle.id, [
    { key: 'engine-oil', name: 'Engine oil', action: 'replace', intervalKm: 8000 },
  ]);

  // an older service log with a receipt mileage, then a newer mileage-type log
  await postLog(request, {
    vehicleId: vehicle.id,
    type: 'service',
    date: daysAgo(20),
    entry: 'Oil change',
    mileage: 5500,
    items: [{ key: 'engine-oil', name: 'Engine oil', action: 'replace' }],
  });
  await postLog(request, { vehicleId: vehicle.id, type: 'mileage', date: daysAgo(2), entry: '7777' });

  const maintenance = await getMaintenance(request, vehicle.id);
  expect(maintenance.lastReading).toEqual({ mileage: 7777, date: daysAgo(2) });
  expect(maintenance.scheduleId).toBeTruthy();
  // the mileage log also moved vehicle.mileage (saveLog sync): due 13500, current 7777 → ok
  expect(itemFor(maintenance, 'engine-oil').status).toBe('ok');

  await cleanup(request, vehicle);
});

test('GET /api/maintenance returns every vehicle of the caller, schedule or not', async ({ request }) => {
  const withSchedule = await createVehicle(request, 12500);
  const schedule = await confirmSchedule(request, withSchedule.id, [
    { key: 'chain', name: 'Drive chain', action: 'lubricate', intervalKm: 1000 },
  ]);
  await postLog(request, {
    vehicleId: withSchedule.id,
    type: 'service',
    date: daysAgo(10),
    entry: 'Chain lube',
    mileage: 11000, // due at 12000, vehicle at 12500 → overdue by 500
    items: [{ key: 'chain', name: 'Drive chain', action: 'lubricate' }],
  });
  const without = await createVehicle(request, 100);

  const res = await request.get('/api/maintenance');
  expect(res.ok()).toBeTruthy();
  const { vehicles } = await res.json();

  // parallel specs create vehicles for the same user constantly — assert on OUR
  // entries, never on counts or positions
  const mine = vehicles.find((entry: any) => entry.vehicleId == withSchedule.id);
  expect(mine).toBeTruthy();
  expect(mine.scheduleId).toBe(schedule.id);
  const chain = itemFor(mine, 'chain');
  expect(chain.status).toBe('overdue');
  expect(chain.overdueByKm).toBe(500);
  const bare = vehicles.find((entry: any) => entry.vehicleId == without.id);
  expect(bare).toBeTruthy();
  expect(bare.scheduleId).toBeUndefined();
  expect(bare.items).toEqual([]);

  await cleanup(request, withSchedule, without);
});

test('maintenance route 404s for a missing vehicle', async ({ request }) => {
  const res = await request.get('/api/vehicles/does-not-exist/maintenance');
  expect(res.status()).toBe(404);
});

// ---------------------------------------------------------------------------
// S15 mileage projection (lib/mileage.ts), exercised through the same route.
// Fixtures post mileage-type logs in ascending date order — saveLog's post-save sync
// overwrites vehicle.mileage on every mileage log, so the vehicle ends up matching the
// newest reading (used deliberately). Estimated dates are asserted with a ±1 day
// tolerance: the server computes "now" at request time, so a midnight rollover
// mid-test must not flip the assertion.

const mileageLog = (vehicleId: string, date: string, mileage: number) =>
  ({ vehicleId, type: 'mileage', date, entry: `${mileage}` });

const expectDateNear = (actual: string, expected: string) => {
  expect(actual).toBeTruthy();
  expect(Math.abs(moment(actual, DATE).diff(moment(expected, DATE), 'days'))).toBeLessThanOrEqual(1);
};

test('projection: steady rider gets an estimated date where the arithmetic says', async ({ request }) => {
  // 1000 km every 10 days → 100 km/day; span 20 days, newest 10 days old → high
  const vehicle = await createVehicle(request, 0);
  await confirmSchedule(request, vehicle.id, [
    { key: 'valve-clearance', name: 'Valve clearance', action: 'inspect', intervalKm: 5000, firstAtKm: 5000 },
  ]);
  await postLog(request, mileageLog(vehicle.id, daysAgo(30), 1000));
  await postLog(request, mileageLog(vehicle.id, daysAgo(20), 2000));
  await postLog(request, mileageLog(vehicle.id, daysAgo(10), 3000));

  const maintenance = await getMaintenance(request, vehicle.id);
  expect(maintenance.projection).toBeTruthy();
  expect(maintenance.projection.confidence).toBe('high');
  expect(maintenance.projection.kmPerDay).toBeCloseTo(100, 5);

  // never done + firstAtKm 5000, last reading 3000 at daysAgo(10) → 2000 km / 100 km/day
  // = 20 days after the reading = ~10 days from now
  const valves = itemFor(maintenance, 'valve-clearance');
  expect(valves.nextDue.km).toBe(5000);
  expect(valves.nextDue.estimated).toBe(true);
  expectDateNear(valves.nextDue.date, moment().add(10, 'days').format(DATE));
  // the estimated date pulls the item into the 30-day upcoming window even though the
  // km axis alone wouldn't (2000 km remaining vs a 500 km window) — the story's point
  expect(valves.status).toBe('upcoming');
  expect(valves.overdueByDays).toBeUndefined();

  await cleanup(request, vehicle);
});

test('projection: single reading → confidence none, km due but no date', async ({ request }) => {
  const vehicle = await createVehicle(request, 0);
  await confirmSchedule(request, vehicle.id, [
    { key: 'valve-clearance', name: 'Valve clearance', action: 'inspect', intervalKm: 5000, firstAtKm: 5000 },
  ]);
  await postLog(request, mileageLog(vehicle.id, daysAgo(5), 1200));

  const maintenance = await getMaintenance(request, vehicle.id);
  expect(maintenance.projection).toEqual({ kmPerDay: 0, confidence: 'none' });
  expect(maintenance.lastReading).toEqual({ mileage: 1200, date: daysAgo(5) });

  const valves = itemFor(maintenance, 'valve-clearance');
  expect(valves.nextDue.km).toBe(5000);
  expect(valves.nextDue.date).toBeUndefined();
  expect(valves.nextDue.estimated).toBeUndefined();

  await cleanup(request, vehicle);
});

test('projection: two readings 3 days apart → low confidence, date still present', async ({ request }) => {
  const vehicle = await createVehicle(request, 0);
  await confirmSchedule(request, vehicle.id, [
    { key: 'valve-clearance', name: 'Valve clearance', action: 'inspect', intervalKm: 1500, firstAtKm: 1500 },
  ]);
  await postLog(request, mileageLog(vehicle.id, daysAgo(4), 1000));
  await postLog(request, mileageLog(vehicle.id, daysAgo(1), 1300)); // 100 km/day, span 3 < 14

  const maintenance = await getMaintenance(request, vehicle.id);
  expect(maintenance.projection.confidence).toBe('low');
  expect(maintenance.projection.kmPerDay).toBeCloseTo(100, 5);

  // (1500 - 1300) / 100 = 2 days after daysAgo(1) = ~1 day out; consumers soften the
  // phrasing at "low" — asserted here only as the confidence value on the payload
  const valves = itemFor(maintenance, 'valve-clearance');
  expect(valves.nextDue.estimated).toBe(true);
  expectDateNear(valves.nextDue.date, moment().add(1, 'days').format(DATE));

  await cleanup(request, vehicle);
});

test('projection: newest reading 90 days old → low confidence', async ({ request }) => {
  const vehicle = await createVehicle(request, 0);
  await confirmSchedule(request, vehicle.id, [
    { key: 'valve-clearance', name: 'Valve clearance', action: 'inspect', intervalKm: 6000, firstAtKm: 6000 },
  ]);
  await postLog(request, mileageLog(vehicle.id, daysAgo(110), 1000));
  await postLog(request, mileageLog(vehicle.id, daysAgo(90), 3000)); // span 20, but stale

  const maintenance = await getMaintenance(request, vehicle.id);
  expect(maintenance.projection.confidence).toBe('low');
  expect(maintenance.projection.kmPerDay).toBeCloseTo(100, 5);

  await cleanup(request, vehicle);
});

test('projection: target below the last reading clamps the date to today, never the past', async ({ request }) => {
  // steady 100 km/day, newest reading 3000 — but the item was due at 2500, so the
  // arithmetic date is behind us; the estimate clamps to "now"
  const vehicle = await createVehicle(request, 0);
  await confirmSchedule(request, vehicle.id, [
    { key: 'valve-clearance', name: 'Valve clearance', action: 'inspect', intervalKm: 2500, firstAtKm: 2500 },
  ]);
  await postLog(request, mileageLog(vehicle.id, daysAgo(30), 1000));
  await postLog(request, mileageLog(vehicle.id, daysAgo(10), 3000));

  const maintenance = await getMaintenance(request, vehicle.id);
  expect(maintenance.projection.confidence).toBe('high');

  const valves = itemFor(maintenance, 'valve-clearance');
  expect(valves.nextDue.estimated).toBe(true);
  expectDateNear(valves.nextDue.date, today());
  expect(valves.nextDue.date >= daysAgo(1)).toBeTruthy(); // never in the past
  // overdue comes from ACTUAL vehicle.mileage (3000 vs due 2500), never the projection;
  // the clamped estimated date (today) contributes no overdueByDays
  expect(valves.status).toBe('overdue');
  expect(valves.overdueByKm).toBe(500);
  expect(valves.overdueByDays).toBeUndefined();

  await cleanup(request, vehicle);
});

test('projection: decreasing readings → slope <= 0, low confidence, no estimated date', async ({ request }) => {
  const vehicle = await createVehicle(request, 0);
  await confirmSchedule(request, vehicle.id, [
    { key: 'valve-clearance', name: 'Valve clearance', action: 'inspect', intervalKm: 5000, firstAtKm: 5000 },
  ]);
  await postLog(request, mileageLog(vehicle.id, daysAgo(30), 3000));
  await postLog(request, mileageLog(vehicle.id, daysAgo(10), 2000)); // downward correction

  const maintenance = await getMaintenance(request, vehicle.id);
  expect(maintenance.projection.confidence).toBe('low');
  expect(maintenance.projection.kmPerDay).toBeLessThanOrEqual(0);

  // slope guard: estimateDateForMileage returns undefined — km due stays date-less
  const valves = itemFor(maintenance, 'valve-clearance');
  expect(valves.nextDue.km).toBe(5000);
  expect(valves.nextDue.date).toBeUndefined();
  expect(valves.nextDue.estimated).toBeUndefined();

  await cleanup(request, vehicle);
});

test('projection: backdated lower service reading after a higher mileage log', async ({ request }) => {
  // a service log dated AFTER the mileage log but with a LOWER odometer (correction):
  // readings sort by date, fit tolerates the non-monotonic pair, floor = newest-by-date
  const vehicle = await createVehicle(request, 0);
  await confirmSchedule(request, vehicle.id, [
    { key: 'engine-oil', name: 'Engine oil', action: 'replace', intervalKm: 8000, firstAtKm: 2400 },
    { key: 'valve-clearance', name: 'Valve clearance', action: 'inspect', intervalKm: 5000, firstAtKm: 5000 },
  ]);
  await postLog(request, mileageLog(vehicle.id, daysAgo(5), 3000));
  await postLog(request, {
    vehicleId: vehicle.id,
    type: 'service',
    date: daysAgo(2),
    entry: 'Odometer per invoice',
    mileage: 2500,
  });

  const maintenance = await getMaintenance(request, vehicle.id);
  // newest-by-date observation wins, even though it's the lower value
  expect(maintenance.lastReading).toEqual({ mileage: 2500, date: daysAgo(2) });
  expect(maintenance.projection.confidence).toBe('low'); // slope <= 0

  // target below the newest-by-date floor (2400 <= 2500) → already passed → today,
  // even with a non-positive slope (no extrapolation needed)
  const oil = itemFor(maintenance, 'engine-oil');
  expect(oil.nextDue.estimated).toBe(true);
  expectDateNear(oil.nextDue.date, today());
  // target above the floor + slope <= 0 → no date at all
  const valves = itemFor(maintenance, 'valve-clearance');
  expect(valves.nextDue.date).toBeUndefined();

  await cleanup(request, vehicle);
});

// ---------------------------------------------------------------------------
// S16 severity ranking (lib/maintenance.ts's rankMaintenanceItems), asserted through
// item order over a real route payload: the helper is client-safe library code with no
// unit runner, so it's exercised here against /api/vehicles/[id]/maintenance output.

test('ranking: overdue items order by normalized severity across km and day axes', async ({ request }) => {
  // one service log 45 days ago at 10,000 km anchors three items; vehicle at 20,000 km.
  // - chain      (intervalKm 1000):  due 11,000 → overdue 9,000 km → severity 9.0
  // - air-filter (intervalMonths 1): due ~15 days ago → overdue ~15 d → severity ~0.5
  // - engine-oil (intervalKm 8000):  due 18,000 → overdue 2,000 km → severity 0.25
  // - spark-plugs (intervalMonths 2): due ~15 days out → upcoming (after all overdue)
  // Normalization is the point: engine-oil is overdue by MORE km than air-filter is by
  // days, but 2,000/8,000 < 15/30 — the fresher-relative-to-interval item ranks lower.
  // Only one odometer observation exists → projection confidence "none" → no estimated
  // dates can shift the fixture.
  const vehicle = await createVehicle(request, 20000);
  await confirmSchedule(request, vehicle.id, [
    { key: 'engine-oil', name: 'Engine oil', action: 'replace', intervalKm: 8000 },
    { key: 'chain', name: 'Drive chain', action: 'lubricate', intervalKm: 1000 },
    { key: 'air-filter', name: 'Air filter', action: 'inspect', intervalMonths: 1 },
    { key: 'spark-plugs', name: 'Spark plugs', action: 'inspect', intervalMonths: 2 },
  ]);
  await postLog(request, {
    vehicleId: vehicle.id,
    type: 'service',
    date: daysAgo(45),
    entry: 'Full service',
    mileage: 10000,
    items: [
      { key: 'engine-oil', name: 'Engine oil', action: 'replace' },
      { key: 'chain', name: 'Drive chain', action: 'lubricate' },
      { key: 'air-filter', name: 'Air filter', action: 'inspect' },
      { key: 'spark-plugs', name: 'Spark plugs', action: 'inspect' },
    ],
  });

  const maintenance = await getMaintenance(request, vehicle.id);
  const ranked = rankMaintenanceItems([maintenance]);

  expect(ranked.map((entry) => entry.status.item.key))
    .toEqual(['chain', 'air-filter', 'engine-oil', 'spark-plugs']);
  expect(ranked.slice(0, 3).every((entry) => entry.status.status == 'overdue')).toBeTruthy();
  expect(ranked[3].status.status).toBe('upcoming');
  expect(ranked.every((entry) => entry.vehicleId == vehicle.id)).toBeTruthy();

  await cleanup(request, vehicle);
});
