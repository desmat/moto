import { test, expect } from '@playwright/test';

// covers the CRUD + ownership-check behavior of the vehicle/log routes: GET/PUT/DELETE on
// a record you own must succeed, GET/PUT/DELETE on a record that doesn't exist must 404,
// and logs must reference one of the caller's own vehicles. The Playwright test server
// always impersonates a single non-admin user, so it can't exercise the cross-user 403
// path directly.

const testVehicle = {
  type: 'motorcycle',
  maker: 'Test Maker',
  model: 'Test Model',
  year: 2020,
  mileage: 1000,
  modifications: [],
};

test('vehicle CRUD works for the owning user and 404s for a missing id', async ({ request }) => {
  const createRes = await request.post('/api/vehicles', { data: { vehicle: testVehicle } });
  expect(createRes.ok()).toBeTruthy();
  const { vehicle } = await createRes.json();
  expect(vehicle?.id).toBeTruthy();
  expect(vehicle?.userId).toBeTruthy();

  const getRes = await request.get(`/api/vehicles/${vehicle.id}`);
  expect(getRes.ok()).toBeTruthy();

  const putRes = await request.put(`/api/vehicles/${vehicle.id}`, {
    data: { vehicle: { ...vehicle, mileage: 2000 } },
  });
  expect(putRes.ok()).toBeTruthy();
  const { vehicle: updated } = await putRes.json();
  expect(updated?.mileage).toBe(2000);
  // identity fields are pinned server-side even if the client tries to change them
  expect(updated?.id).toBe(vehicle.id);
  expect(updated?.userId).toBe(vehicle.userId);

  const missingRes = await request.get('/api/vehicles/does-not-exist');
  expect(missingRes.status()).toBe(404);

  const missingPutRes = await request.put('/api/vehicles/does-not-exist', { data: { vehicle: {} } });
  expect(missingPutRes.status()).toBe(404);

  const deleteRes = await request.delete(`/api/vehicles/${vehicle.id}`);
  expect(deleteRes.ok()).toBeTruthy();

  const missingDeleteRes = await request.delete('/api/vehicles/does-not-exist');
  expect(missingDeleteRes.status()).toBe(404);
});

test('log CRUD works for the owning user and 404s for a missing id', async ({ request }) => {
  const vehicleRes = await request.post('/api/vehicles', { data: { vehicle: testVehicle } });
  const { vehicle } = await vehicleRes.json();
  expect(vehicle?.id).toBeTruthy();

  const createRes = await request.post('/api/logs', {
    data: { log: { vehicleId: vehicle.id, type: 'journal', entry: 'test entry' } },
  });
  expect(createRes.ok()).toBeTruthy();
  const { log } = await createRes.json();
  expect(log?.id).toBeTruthy();
  expect(log?.date).toMatch(/^\d{8}$/);

  const getRes = await request.get(`/api/logs/${log.id}`);
  expect(getRes.ok()).toBeTruthy();

  const putRes = await request.put(`/api/logs/${log.id}`, {
    data: { log: { ...log, entry: 'updated entry' } },
  });
  expect(putRes.ok()).toBeTruthy();
  const { log: updated } = await putRes.json();
  expect(updated?.entry).toBe('updated entry');

  const missingRes = await request.get('/api/logs/does-not-exist');
  expect(missingRes.status()).toBe(404);

  const deleteRes = await request.delete(`/api/logs/${log.id}`);
  expect(deleteRes.ok()).toBeTruthy();

  const missingDeleteRes = await request.delete('/api/logs/does-not-exist');
  expect(missingDeleteRes.status()).toBe(404);

  await request.delete(`/api/vehicles/${vehicle.id}`);
});

test('a mileage log updates the vehicle record', async ({ request }) => {
  const vehicleRes = await request.post('/api/vehicles', { data: { vehicle: testVehicle } });
  const { vehicle } = await vehicleRes.json();

  const logRes = await request.post('/api/logs', {
    data: { log: { vehicleId: vehicle.id, type: 'mileage', entry: '5555' } },
  });
  expect(logRes.ok()).toBeTruthy();
  const { log } = await logRes.json();

  const getRes = await request.get(`/api/vehicles/${vehicle.id}`);
  const { vehicle: updated } = await getRes.json();
  expect(updated?.mileage).toBe(5555);

  await request.delete(`/api/logs/${log.id}`);
  await request.delete(`/api/vehicles/${vehicle.id}`);
});

test('logs must reference one of the caller\'s own vehicles', async ({ request }) => {
  const missingVehicleRes = await request.post('/api/logs', {
    data: { log: { vehicleId: 'does-not-exist', type: 'journal', entry: 'test entry' } },
  });
  expect(missingVehicleRes.status()).toBe(400);

  const noVehicleRes = await request.post('/api/logs', {
    data: { log: { type: 'journal', entry: 'test entry' } },
  });
  expect(noVehicleRes.status()).toBe(400);
});

test('user record GET/PUT works for the current user', async ({ request }) => {
  const getRes = await request.get('/api/user');
  expect(getRes.ok()).toBeTruthy();
  const { user } = await getRes.json();
  expect(user?.id).toBeTruthy();

  const putRes = await request.put('/api/user', {
    data: { user: { ...user, name: 'Updated Name' } },
  });
  expect(putRes.ok()).toBeTruthy();
  const { user: updated } = await putRes.json();
  expect(updated?.name).toBe('Updated Name');
  // identity fields are pinned server-side
  expect(updated?.id).toBe(user.id);
  expect(updated?.providerId).toBe(user.providerId);

  // restore the original name so repeated runs against the same store stay stable
  await request.put('/api/user', { data: { user } });
});
