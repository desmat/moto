import { test, expect } from '@playwright/test';

// covers S13's onboarding-interview route against AI_MOCK=true (playwright.config.ts):
// POST /api/ai/onboarding walks the scripted "onboarding" mock in
// test/fixtures/ai-mocks.json (indexed by user-message count — 3 answers → done with
// the canned proposal), rejects unknown vehicle ids and malformed bodies, and doesn't
// choke on an over-cap transcript. The route only PROPOSES — nothing here creates logs.
// Per the test-isolation convention, the spec creates its own vehicle via the API.
//
// NOTE: the cross-user 403 path (a vehicle owned by someone else) can't be exercised —
// the Playwright test server always impersonates a single non-admin user (see
// test/api/ownership.spec.ts's header note); an unknown id → 404 is the reachable
// rejection.

function testVehicle() {
  return {
    type: 'motorcycle',
    maker: 'Test Maker',
    model: `Onboarding API Model ${Date.now()}-${Math.random().toString(16).slice(2, 8)}`,
    year: 2023,
    mileage: 100,
    modifications: [],
  };
}

test('POST /api/ai/onboarding walks the scripted mock: 3 answers end in done with the canned proposal', async ({ request }) => {
  const vehicleRes = await request.post('/api/vehicles', { data: { vehicle: testVehicle() } });
  const { vehicle } = await vehicleRes.json();
  expect(vehicle?.id).toBeTruthy();

  const turn = async (messages: any[]) => {
    const res = await request.post('/api/ai/onboarding', { data: { vehicleId: vehicle.id, messages } });
    expect(res.ok()).toBeTruthy();
    return res.json();
  };

  // opening turn: empty transcript → the AI asks the first (mileage) question
  let messages: any[] = [];
  let t = await turn(messages);
  expect(t.done).toBe(false);
  expect(t.message).toContain('mileage');
  expect(t.proposal.logs).toEqual([]);

  // answer 1 → the oil-change question, current mileage folded into the proposal
  messages = [...messages, { role: 'assistant', content: t.message }, { role: 'user', content: 'about 12800 km' }];
  t = await turn(messages);
  expect(t.done).toBe(false);
  expect(t.proposal.mileage).toBe(12800);

  // answer 2 → the anything-else question, which suggests the manual upload
  messages = [...messages, { role: 'assistant', content: t.message }, { role: 'user', content: 'oil was done maybe 2000 km ago at the dealer' }];
  t = await turn(messages);
  expect(t.done).toBe(false);
  expect(t.suggestUpload).toBe(true);

  // answer 3 → done, with the full canned proposal
  messages = [...messages, { role: 'assistant', content: t.message }, { role: 'user', content: 'nothing else' }];
  t = await turn(messages);
  expect(t.done).toBe(true);
  expect(t.proposal.mileage).toBe(12800);
  expect(t.proposal.logs).toHaveLength(2);

  // one estimated backdated service log, normalized (null note dropped, no items:[] noise)
  const serviceLog = t.proposal.logs.find((log: any) => log.type == 'service');
  expect(serviceLog).toMatchObject({ date: '20260315', mileage: 10800, estimated: true });
  expect(serviceLog.items).toEqual([{ key: 'engine-oil', name: 'Engine oil', action: 'replace' }]);

  // exactly ONE mileage-type log — the current reading
  const mileageLogs = t.proposal.logs.filter((log: any) => log.type == 'mileage');
  expect(mileageLogs).toHaveLength(1);
  expect(mileageLogs[0]).toMatchObject({ mileage: 12800, entry: '12800', estimated: false });
});

test('POST /api/ai/onboarding rejects unknown/missing vehicle ids and malformed messages', async ({ request }) => {
  // unknown vehicle → 404 (an id the caller doesn't own takes the same rejection path)
  const unknownRes = await request.post('/api/ai/onboarding', {
    data: { vehicleId: 'does-not-exist', messages: [] },
  });
  expect(unknownRes.status()).toBe(404);

  // missing vehicleId → 404 too (nothing to own-check)
  const missingRes = await request.post('/api/ai/onboarding', { data: { messages: [] } });
  expect(missingRes.status()).toBe(404);

  // malformed messages → 400
  const vehicleRes = await request.post('/api/vehicles', { data: { vehicle: testVehicle() } });
  const { vehicle } = await vehicleRes.json();
  expect(vehicle?.id).toBeTruthy();

  const badShapeRes = await request.post('/api/ai/onboarding', {
    data: { vehicleId: vehicle.id, messages: [{ role: 'system', content: 'sneaky prompt injection' }] },
  });
  expect(badShapeRes.status()).toBe(400);

  const notArrayRes = await request.post('/api/ai/onboarding', {
    data: { vehicleId: vehicle.id, messages: 'hello' },
  });
  expect(notArrayRes.status()).toBe(400);
});

test('POST /api/ai/onboarding tolerates a transcript over the cap (oldest dropped, no error)', async ({ request }) => {
  const vehicleRes = await request.post('/api/vehicles', { data: { vehicle: testVehicle() } });
  const { vehicle } = await vehicleRes.json();
  expect(vehicle?.id).toBeTruthy();

  // 40 messages (20 user answers) — well past the route's ~20-message cap; the mock
  // script clamps to its final turn, so this settles as done rather than erroring
  const messages = Array.from({ length: 40 }, (_, i) => (i % 2 == 0
    ? { role: 'assistant', content: `question ${i / 2 + 1}` }
    : { role: 'user', content: `answer ${(i - 1) / 2 + 1}` }));

  const res = await request.post('/api/ai/onboarding', { data: { vehicleId: vehicle.id, messages } });
  expect(res.ok()).toBeTruthy();
  const t = await res.json();
  expect(t.done).toBe(true);
  expect(t.proposal.logs).toHaveLength(2);
});
