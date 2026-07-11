import { test, expect } from '@playwright/test';
import { smokeTestUserId } from '../../services/stores/memory';

// covers the upload-token exchange (app/api/attachments/upload): @vercel/blob's
// handleUpload computes the client token locally from BLOB_READ_WRITE_TOKEN (an HMAC —
// no Vercel round-trip), so the exchange is exercisable offline via the request fixture.
// The Playwright test server always impersonates a single non-admin user
// (smokeTestUserId), so only that user's `moto/{userId}/` prefix may be granted a token.

// the `blob.generate-client-token` event body @vercel/blob/client's upload() POSTs to
// the handleUpload route (shape per @vercel/blob v2's GenerateClientTokenEvent)
function tokenEventBody(pathname: string) {
  return {
    type: 'blob.generate-client-token',
    payload: {
      pathname,
      multipart: false,
      clientPayload: null,
    },
  };
}

test('upload token is issued for a pathname under the caller\'s own prefix', async ({ request }) => {
  const res = await request.post('/api/attachments/upload', {
    data: tokenEventBody(`moto/${smokeTestUserId}/test-${Date.now()}.jpg`),
  });
  expect(res.status()).toBe(200);
  const json = await res.json();
  expect(json?.type).toBe('blob.generate-client-token');
  expect(json?.clientToken).toBeTruthy();
  expect(json?.clientToken).toContain('vercel_blob_client_');
});

test('upload token is refused for a pathname outside the caller\'s prefix', async ({ request }) => {
  const otherUserRes = await request.post('/api/attachments/upload', {
    data: tokenEventBody('moto/someone-else/x.jpg'),
  });
  expect(otherUserRes.status()).toBe(400);

  const noPrefixRes = await request.post('/api/attachments/upload', {
    data: tokenEventBody('x.jpg'),
  });
  expect(noPrefixRes.status()).toBe(400);
});
