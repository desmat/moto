import { test, expect } from '@playwright/test';
import fs from 'fs';
import path from 'path';
import { smokeTestUserId } from '../../services/stores/memory';

// covers the S9 ingestion pipeline end-to-end under AI_MOCK + BLOB_MOCK + memory store:
// POST /api/documents/[id]/ingest (extract → chunk → embed → status transitions) and
// GET /api/documents/search (vector query scoped to the session user). The fixture is a
// tiny real one-page PDF embedded as a data: URL in the attachment record — exactly the
// shape BLOB_MOCK uploads produce — so ingestDocument's fetch works with no Blob store.
// Mock embeddings are deterministic bag-of-words hash vectors (services/ai.ts), so a
// token-overlap query reliably ranks the chunk containing those words first.
//
// Per the test-isolation convention everything is created via the API inside each spec
// (never asserted against seeds), with unique-per-run values; searches are always
// scoped by ?vehicle= (unique per test) so parallel specs' chunks can't bleed in.

const FIXTURE_SENTENCE = 'valve clearance check every 24000 km';

const pdfDataUrl = `data:application/pdf;base64,${
  fs.readFileSync(path.join(__dirname, '../fixtures/mini-manual.pdf')).toString('base64')
}`;

const testVehicle = {
  type: 'motorcycle',
  maker: 'Test Maker',
  model: 'Ingest Test Model',
  year: 2023,
  mileage: 5000,
  modifications: [],
};

// unique pathname per call so repeated runs against a reused dev server never collide
// on the attachments POST's pathname idempotency lookup
function testAttachment(suffix: string, url: string) {
  const filename = `test-ingest-${Date.now()}-${Math.random().toString(16).slice(2, 8)}-${suffix}.pdf`;
  return {
    url,
    pathname: `moto/${smokeTestUserId}/${filename}`,
    contentType: 'application/pdf',
    size: url.length,
    filename,
  };
}

async function createVehicle(request: any) {
  const res = await request.post('/api/vehicles', { data: { vehicle: testVehicle } });
  const { vehicle } = await res.json();
  expect(vehicle?.id).toBeTruthy();
  return vehicle;
}

async function createDocument(request: any, suffix: string, url = pdfDataUrl) {
  const vehicle = await createVehicle(request);

  const attachmentRes = await request.post('/api/attachments', {
    data: { attachment: testAttachment(suffix, url) },
  });
  const { attachment } = await attachmentRes.json();
  expect(attachment?.id).toBeTruthy();

  const documentRes = await request.post('/api/documents', {
    data: { document: { vehicleId: vehicle.id, attachmentId: attachment.id, type: 'manual' } },
  });
  const { document } = await documentRes.json();
  expect(document?.id).toBeTruthy();
  expect(document?.status).toBe('uploaded');

  return { vehicle, attachment, document };
}

async function search(request: any, q: string, params: Record<string, string>) {
  const searchParams = new URLSearchParams({ q, ...params });
  const res = await request.get(`/api/documents/search?${searchParams}`);
  expect(res.ok()).toBeTruthy();
  const { results } = await res.json();
  return results;
}

test('ingest extracts, chunks, and embeds a PDF; search finds its content', async ({ request }) => {
  const { vehicle, document } = await createDocument(request, 'happy');

  const ingestRes = await request.post(`/api/documents/${document.id}/ingest`);
  expect(ingestRes.ok()).toBeTruthy();
  const { document: ingested } = await ingestRes.json();
  expect(ingested?.status).toBe('ready');
  expect(ingested?.pageCount).toBe(1);
  expect(ingested?.error).toBeUndefined();

  const results = await search(request, 'valve clearance', { vehicle: vehicle.id });
  expect(results.length).toBeGreaterThan(0);
  expect(results[0].text).toContain(FIXTURE_SENTENCE);
  expect(results[0].documentId).toBe(document.id);
  expect(results[0].page).toBe(1);
  expect(results[0].chunkIndex).toBe(0);
  expect(results[0].score).toBeGreaterThan(0);

  await request.delete(`/api/documents/${document.id}`);
  await request.delete(`/api/vehicles/${vehicle.id}`);
});

test('re-ingest is idempotent: no duplicate chunks', async ({ request }) => {
  const { vehicle, document } = await createDocument(request, 'idempotent');

  await request.post(`/api/documents/${document.id}/ingest`);
  const reIngestRes = await request.post(`/api/documents/${document.id}/ingest`);
  expect(reIngestRes.ok()).toBeTruthy();
  const { document: reIngested } = await reIngestRes.json();
  expect(reIngested?.status).toBe('ready');

  // the one-page fixture yields exactly one chunk; a duplicate would show up as a
  // second result for this document
  const results = await search(request, 'valve clearance', { vehicle: vehicle.id });
  const ownChunks = results.filter((r: any) => r.documentId == document.id);
  expect(ownChunks.length).toBe(1);
  // and ids (documentId:chunkIndex) are unique across everything the search returned
  const ids = results.map((r: any) => `${r.documentId}:${r.chunkIndex}`);
  expect(new Set(ids).size).toBe(ids.length);

  await request.delete(`/api/documents/${document.id}`);
  await request.delete(`/api/vehicles/${vehicle.id}`);
});

test('search scoped to a different vehicle does not return the chunks', async ({ request }) => {
  const { vehicle, document } = await createDocument(request, 'scoping');
  const otherVehicle = await createVehicle(request);

  await request.post(`/api/documents/${document.id}/ingest`);

  const scopedResults = await search(request, 'valve clearance', { vehicle: otherVehicle.id });
  expect(scopedResults.filter((r: any) => r.documentId == document.id)).toHaveLength(0);

  // ...and scoping by ?document= works too
  const docScoped = await search(request, 'valve clearance', { document: document.id });
  expect(docScoped.length).toBeGreaterThan(0);
  expect(docScoped.every((r: any) => r.documentId == document.id)).toBe(true);

  await request.delete(`/api/documents/${document.id}`);
  await request.delete(`/api/vehicles/${vehicle.id}`);
  await request.delete(`/api/vehicles/${otherVehicle.id}`);
});

test('deleting a document cascades to its vectors', async ({ request }) => {
  const { vehicle, document } = await createDocument(request, 'cascade');

  await request.post(`/api/documents/${document.id}/ingest`);
  const before = await search(request, 'valve clearance', { vehicle: vehicle.id });
  expect(before.filter((r: any) => r.documentId == document.id).length).toBeGreaterThan(0);

  const deleteRes = await request.delete(`/api/documents/${document.id}`);
  expect(deleteRes.ok()).toBeTruthy();

  const after = await search(request, 'valve clearance', { vehicle: vehicle.id });
  expect(after).toHaveLength(0);

  await request.delete(`/api/vehicles/${vehicle.id}`);
});

test('a broken file lands the document in "error" with the message stored', async ({ request }) => {
  const brokenDataUrl = `data:application/pdf;base64,${Buffer.from('this is not a pdf').toString('base64')}`;
  const { vehicle, document } = await createDocument(request, 'broken', brokenDataUrl);

  // the route still returns 200 with the errored document — status is the source of
  // truth for ingestion outcomes, not the HTTP code
  const ingestRes = await request.post(`/api/documents/${document.id}/ingest`);
  expect(ingestRes.status()).toBe(200);
  const { document: errored } = await ingestRes.json();
  expect(errored?.status).toBe('error');
  expect(errored?.error).toBeTruthy();

  // ...and it stuck on the record
  const getRes = await request.get(`/api/documents/${document.id}`);
  const { document: fetched } = await getRes.json();
  expect(fetched?.status).toBe('error');
  expect(fetched?.error).toBeTruthy();

  // an errored ingest left no chunks behind
  const results = await search(request, 'valve clearance', { vehicle: vehicle.id });
  expect(results).toHaveLength(0);

  await request.delete(`/api/documents/${document.id}`);
  await request.delete(`/api/vehicles/${vehicle.id}`);
});

test('search requires q; ingest 404s for a missing id', async ({ request }) => {
  const noQRes = await request.get('/api/documents/search');
  expect(noQRes.status()).toBe(400);

  const emptyQRes = await request.get('/api/documents/search?q=');
  expect(emptyQRes.status()).toBe(400);

  const missingRes = await request.post('/api/documents/does-not-exist/ingest');
  expect(missingRes.status()).toBe(404);
});
