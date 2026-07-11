# S3 — Blob upload route + client upload utility

Story: [phase-1.md](../phase-1.md) § S3. Depends on S2 (`Attachment` entity). Unblocks S4.

## Design

- **Client → Blob direct** via `@vercel/blob/client`'s token-exchange flow (`handleUpload` server-side, `upload()` client-side). Files never pass through a Next.js function — phone photos are multi-MB and serverless bodies cap at ~4.5MB on Vercel.
- **Single record-creation path — no `onUploadCompleted`.** Vercel's completion webhook can't reach localhost, so it can't be the (or even *a*) source of truth without an idempotency dance. Instead the client POSTs `/api/attachments` (S2) right after `upload()` resolves — authenticated, prefix-validated, idempotent by `pathname`. Prod and dev behave identically. Accepted risk: client dies between upload and POST → orphaned blob (already the deferred-cleanup bucket).
- **Tenant prefix enforced at token time**: pathnames must be `moto/{internal user id}/…`. The client builds the prefix from its **internal** id — `useUserRecord().user.id`, **not** `useUser()` (which is the auth provider's session id, a Clerk `user_…` in prod; it coincides with the internal id only under mock-auth/impersonation, so a `useUser()`-built prefix passes tests but is rejected at token time for every real Clerk user). The server-side `onBeforeGenerateToken` check against `currentUser().id` is the actual security boundary; the client-built prefix must match it, and the SDK flow gives the client no way to bypass that check.
- **`BLOB_MOCK=true` for tests**: the client utility short-circuits to a fake result (no network, no token) so Playwright runs neither need nor pollute the real Blob store. This var is read in **client** code → per the AGENTS.md footgun it must be whitelisted by exact name in `next.config.mjs`'s `env` block (the documented pattern; not a `NEXT_PUBLIC_` rename).

## Files

### Create `app/api/attachments/upload/route.ts`

```ts
import { handleUpload, type HandleUploadBody } from "@vercel/blob/client";

export async function POST(request: Request): Promise<NextResponse> {
  // handleUpload({ body, request, onBeforeGenerateToken, onUploadCompleted: noop })
}
```

`onBeforeGenerateToken(pathname)`:
- `currentUser()` → throw `"authorization failed"` if missing (handleUpload turns throws into 400s; keep the message consistent with the 403 JSON convention elsewhere).
- Reject unless `pathname.startsWith(\`moto/${user.id}/\`)`.
- Return `{ allowedContentTypes: ["image/jpeg","image/png","image/webp","image/heic","application/pdf"], maximumSizeInBytes: 20 * 1024 * 1024, addRandomSuffix: true }`.

`onUploadCompleted`: log-only no-op (record creation is the client's job — see Design).

Note: this route lives under `/api` and is *not* `/api/admin*`, so `proxy.ts` already gates it with a Clerk session before `currentUser()` runs — same as every other API route; no proxy changes.

### Create `lib/upload.ts` (client-side)

```ts
import { upload } from "@vercel/blob/client";

export type UploadedBlob = { url: string, pathname: string, contentType: string, size: number, filename: string };

export async function uploadFile(file: File, userId: string): Promise<UploadedBlob> {
  // userId is the INTERNAL short-uuid (useUserRecord().user.id), matching currentUser().id
  // the upload route enforces — never the auth-provider id from useUser().
  if (process.env.BLOB_MOCK == "true") {
    // fake result — must mirror the real flow's addRandomSuffix, i.e. a UNIQUE pathname per
    // call: `moto/${userId}/mock-${Date.now()}-${rand}-${file.name}`. A deterministic path
    // (`mock-${file.name}`) collides across specs: the attachments POST is idempotent-by-pathname
    // and S4's linking guard won't re-link, so the 2nd spec to upload a shared fixture
    // (S4 + S6 both use test/fixtures/odometer.jpg) silently gets the 1st spec's already-linked
    // record and ends up with no attachment on its log. url = a data-URL of the file (small
    // fixtures only) — flows through the normal S2 record-creation path.
  }
  const result = await upload(`moto/${userId}/${file.name}`, file, {
    access: "public",
    handleUploadUrl: "/api/attachments/upload",
  });
  return { ...pick from result, size: file.size, filename: file.name };
}
```

### Modify

- `next.config.mjs` — add `BLOB_MOCK: process.env.BLOB_MOCK` to the `env` block, with the same style of comment as its neighbors.
- `playwright.config.ts` — add `BLOB_MOCK: 'true'` to `webServer.env`.
- `AGENTS.md` — mention `BLOB_MOCK=true` alongside `STORE_TYPE=memory`/`AI_MOCK` in the local-dev/test env paragraph, and add it to the env-var-exposure footgun's list of whitelisted names.

### Create `test/api/upload.spec.ts`

The token exchange is exercisable via the `request` fixture (`handleUpload`'s token generation is computed from `BLOB_READ_WRITE_TOKEN` locally, no Vercel round-trip): POST the `blob.generate-client-token` event body with a pathname under the mock user's prefix → 200 with token; with a pathname under another user's prefix (`moto/someone-else/x.jpg`) → 400. (The full browser upload path is covered by S4's e2e spec under `BLOB_MOCK`.)

## Steps

1. Upload route → 2. `lib/upload.ts` (+ mock branch) → 3. `next.config.mjs` + `playwright.config.ts` + AGENTS.md wiring → 4. spec.
5. Verify — the mock path via `npm run test:api`; the real path manually: `npm run dev`, a throwaway page/console snippet calling `uploadFile`, confirm the blob appears in the Vercel dashboard under `moto/<uid>/…` and the POST-back creates the record. Delete the test blob after.

## Acceptance criteria → verification

| AC | How verified |
|---|---|
| Unauthenticated token request → 4xx | manual curl without session (test server always impersonates, per `ownership.spec.ts`'s note) |
| File lands under `moto/{userId}/…` + owned record exists | manual real-path check above |
| Works on localhost (no webhook dependency) | by design (client POST path); e2e in S4 |
| Wrong prefix / oversized / wrong type rejected | spec (prefix); `allowedContentTypes`/`maximumSizeInBytes` enforced by Blob (manual spot-check with a >20MB file) |

## Out of scope

Dialog UI (S4), progress rendering (S4), orphan cleanup, HEIC→JPEG conversion (raw HEIC is accepted and stored; rendering quirks in non-Safari browsers are a known deferred item).
