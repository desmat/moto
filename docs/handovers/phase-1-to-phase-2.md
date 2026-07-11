# Handover: Phase 1 → Phase 2

Addressed to the agent implementing [Phase 2](../phase-2.md). Phase 1 (S0–S6 per [phase-1.md](../phase-1.md)) is fully landed on `main` and verified — including a real-key manual pass of the odometer OCR. The Phase 2 plans were written against the Phase 1 *plans*; this documents what actually shipped, where it deviates, and which Phase 2 plan lines those deviations invalidate. Read this alongside AGENTS.md (which was updated throughout the phase and is current).

## What shipped, and the exported surfaces you build on

### `services/ai.ts` (S1) — extended by your S7/S10/S11/S13

```ts
const MODELS = { vision: "gpt-4o" };  // single source of truth; add embeddings model here (S7)

export async function extractFromImage<T>({ imageUrl, prompt, schemaName, schema }: {
  imageUrl: string,                 // blob URL or data: URL — passed straight to OpenAI
  prompt: string,
  schemaName: string,               // doubles as json_schema name and the mock key
  schema: Record<string, unknown>,  // plain JSON Schema (strict mode); NOT `object` — the SDK type needs the index signature
}): Promise<T>
```

- Lazy memoized client; importing without `OPENAI_API_KEY` never throws, calling does (`"services.ai: OPENAI_API_KEY is not set"`).
- Errors are wrapped `services.ai.extractFromImage(<schemaName>): <message>` and rethrown; routes map them to 502.
- **⚠ There is no `MOCKS` const** (post-landing refactor): `AI_MOCK=true` canned responses live in **`test/fixtures/ai-mocks.json`**, keyed by `schemaName`, lazily `fs`-read (memoized) only in mock mode. Unmocked schema under `AI_MOCK` → throw (a test hitting an unmocked schema is a bug). This invalidates the wording in phase-2-s0.md ("how `MOCKS` is keyed"), s7 ("mock in `services/ai.ts`"), s10 ("canned `manualSchedule` mock"), s11 ("Add a `receipt` entry to `MOCKS`"), s13 ("`onboarding` scripted mock") — in every case: **add a key to `test/fixtures/ai-mocks.json` instead**. `services/ai.ts` is Node-runtime-only, so `fs` is fine there (unlike `proxy.ts`).

### `services/odometer.ts` + `app/api/ai/odometer/route.ts` (S6) — the shape your S11 receipt work copies

Post-landing refactor: the domain logic (type, JSON schema, prompt) lives in **`services/odometer.ts`** behind `readOdometer(imageUrl): Promise<OdometerReading>`; the route is a thin HTTP shell (auth → 404 → ownership → non-image 400 → `readOdometer` → 502 on throw → `trackEvent("odometer-ocr")`). phase-2-s11.md says "Copy `app/api/ai/odometer/route.ts` (S6) verbatim in shape" — **the shape now includes the service/route split**: make `services/receipt.ts` + a thin `/api/ai/receipt` route.

**The most important tuning note of the phase — adopt this in the receipt schema.** The odometer schema *leads with a boolean gate*:

```ts
type OdometerReading = {
  odometer_digits_clearly_visible: boolean,  // FIRST field, on purpose
  reading: number | null,
  unit: "km" | "mi" | null,
  confidence: "high" | "low",
};
```

During the real-key pass, gpt-4o **confidently hallucinated readings** (`30540 km / high`, then `140057 mi / high` after prompt hardening) for a featureless test image. Prompt-only "never guess, null is expected" instructions did **not** fix it. Forcing the model to commit to "are digits actually visible?" *before* emitting a reading (field order in the strict schema) fixed it completely: legible display → `12345 km / high`, featureless/irrelevant images → `null`. Receipts will hit the same failure mode — give the receipt schema an equivalent leading gate (e.g. `receipt_clearly_visible: boolean`) and phrase the prompt as a strict transcriber (see `ODOMETER_PROMPT` in `services/odometer.ts` for the working framing). Strict-mode schema details: every property in `required`, `additionalProperties: false`, nullable number via `type: ["number","null"]`, nullable enum via `anyOf`.

### Attachment upload call chain (S2/S3) — your S8 documents ride this

`lib/upload.ts` `uploadFile(file: File, userId: string): Promise<UploadedBlob>` → token exchange at `POST /api/attachments/upload` (`@vercel/blob/client` `handleUpload`) → client then POSTs `/api/attachments` to create the record.

- **`userId` must be the INTERNAL short-uuid** — `useUserRecord().user.id`, never `useUser()` (auth-provider id; the two coincide only under mock auth, so the bug passes tests and fails for real Clerk users). The upload route only issues tokens for `moto/${currentUser().id}/…`; the attachments POST enforces the same prefix on the record side (400).
- Token rules: `allowedContentTypes: [jpeg, png, webp, heic, pdf]`, 20MB cap, `addRandomSuffix: true`. `onUploadCompleted` is a **log-only no-op** — record creation is the client's job (the webhook can't reach localhost; single code path for dev and prod). Accepted risk: client dies between upload and POST → orphaned blob.
- `POST /api/attachments` is **idempotent by `pathname`** (returns the existing record), strips client-supplied `id` by destructuring (the AGENTS.md gotcha).
- `BLOB_MOCK=true` (test env) short-circuits `uploadFile` to a fake result: **unique-per-call** mock pathname (`mock-${Date.now()}-${rand}-${name}` — deterministic paths collide with the pathname idempotency across specs) and a data-URL of the file contents. Read in client code → whitelisted by exact name in `next.config.mjs`'s `env` block.
- `Attachment` PUT pins `id/userId/createdAt/createdBy` **and** `url/pathname/size/contentType` (PUT exists to set `logId`/`vehicleId`; `filename` is deliberately editable). DELETE deletes the blob best-effort (`del(attachment.url)` in try/catch-warn — fake pathnames in tests must not block record deletion; the warn noise in test output is designed behavior).

### Log-dialog attachment strip (S4) — your S11 `service-log-dialog` reuses these pieces

In `components/log-entry-dialog.tsx`:

- `PendingAttachment = { id, url, contentType, filename, status: "uploading" | "ready" | "error" }`; `id` is a throwaway local key until the record POST lands, then the record id (this id-swap matters: S6's one-shot OCR guard keys off it).
- Upload-on-pick (`uploadFile` → `useAttachment().add`), per-file spinner, ✕ remove (DELETEs record+blob for `ready`; `error` entries never got a record), hidden `<input type="file" accept="image/*,application/pdf" multiple>` with **no `capture` attribute** (mobile then offers Camera/Library/Files in one tap).
- The attach button is disabled until `useUserRecord()` resolves (the pathname prefix needs the internal id).
- `onSubmit` payload carries `attachmentIds` (ready ones); **linking happens server-side** in `app/api/logs/route.ts` POST: per id, link only if `attachment.userId == user.id && (!attachment.logId || attachment.logId == newLog.id)` (never steal), denormalize `vehicleId`; bogus ids skip+warn without failing the save. `hooks/use-log.tsx` `addMutation` destructures `attachmentIds` off the log (never stored on the record) and invalidates `["attachments"]` on success. phase-2-s11.md's note "`app/api/logs/route.ts`: no change needed" holds.
- S6 UI state you'll mirror: `ocr: "idle"|"reading"|"done"|"low"|"failed"` (one-shot per attachment via a `lastOcrAttachmentId` ref; auto-fires only in mileage mode when the newest attachment turns `ready`, is an image, and the field is still empty), a single muted status line under the input, manual edits reset to `idle`, and the two-tap lower-than-current confirm (`saveWarningArmed`, Save relabels "Save anyway", disarmed on entry/vehicle change).
- **The vehicle picker renders only when the user has >1 vehicle** — replicate that guard in `service-log-dialog` (s11 says "same Dialog skeleton (vehicle picker …)").

### Route conventions (post-landing refactor) — your S8 "copy the vehicles routes" copies this too

All API routes now use **`lib/api.ts`**: `authorizationFailed()`, `notFound()`, `badRequest(msg)`, `jsonError(msg, status)`, `canAccess(user, record)`. `proxy.ts` remains the primary session gate; the in-route `currentUser()` check is defense-in-depth that falls out of needing `user.id` for scoping (rationale documented in `lib/api.ts`).

### S5 display surfaces

- Logs GET merges a computed `attachmentCount` per log (one `getAttachments({user})` per request, grouped — response-only field, not on `types/Log.ts`).
- `/logs/[id]` renders a read-only attachments strip; lists show a paperclip + `"(photo)"` fallback for empty entries.
- **Cascade delete** lives in `services/logs.ts` `deleteLog` (attachments' records+blobs go with the log). Your S8 document-delete cascade should follow the same service-layer pattern (the s8 plan already says so).

## Other deviations from the Phase 1 plans

- **Dashboard charts are disabled** (commented out in `app/page.tsx` with a revive note; they rendered dummy data). The smoke specs' dashboard-rendered sentinel is now the text **"Record"**, not "Charts". Dashboard shows the **10** newest entries (was 5).
- **Single-vehicle UX** (post-phase addition): with exactly one vehicle, the nav item goes singular ("Vehicle") and deep-links to `/vehicles/<id>` (`useNavItems()` in `components/app-sidebar.tsx`, shared with the bottom bar), and the vehicle page shows an "Add another vehicle" button. Untestable e2e under the parallel shared store (specs constantly add/remove vehicles); verified via live browser.
- **Memory seed now has TWO vehicles**: the CB500X (`mileage: 18250`) *and* a Yamaha XT250 (`vehicle-smoketest-2`, `mileage: 9400`), plus one seeded attachment (`attachment-smoketest`, data-URL png, linked to `smoke-log-7`). Phase 2/3 plan lines that say "the seeded CB500X has 18250" remain true, but don't assume it's the only vehicle — and per the test-isolation convention (below) don't assert on seeds at all.
- No acceptance criteria were dropped or weakened. One nuance: unauthenticated/wrong-prefix upload-token requests are **400**s (`handleUpload` converts `onBeforeGenerateToken` throws), not 403s — matches the S3 plan, noting it here because the phase doc's AC said "403".

## Test/dev machinery

- `playwright.config.ts` `webServer.env`: `STORE_TYPE=memory`, `AI_MOCK=true`, `BLOB_MOCK=true` (+ the pre-existing mock-auth vars). Suite is **29 tests** (`test/api`: ownership, attachments, upload, odometer; `test/e2e`: smoke, log-attachments, odometer-ocr), all green at handover.
- **Test-isolation convention** (AGENTS.md, tightened mid-phase): specs create their own records via the API and assert on those; seeds are dev conveniences, **not a test contract** — even read-only assertions on seed ids/values/ordering are out. Unique-per-run pathnames everywhere (idempotency collisions).
- Fixtures: `test/fixtures/odometer.jpg` (1KB, deliberately featureless — under a real key it now correctly yields `reading: null`; the canned mock is what returns 12345), `test/fixtures/ai-mocks.json` (the AI mock registry — you'll add `receipt`, `manualSchedule`, `onboarding`, embedding mocks here). Your S9 adds `test/fixtures/mini-manual.pdf`.
- **Flakiness gotchas** (both in AGENTS.md): (1) one dev server per project directory — any running `npm run dev` breaks `npm run test`; (2) **stale `.next`** — flaky e2e failures with an empty `<main>` and `[browser] ChunkLoadError` in webServer output mean a corrupt Turbopack cache (seen after alternating dev/test server sessions with different env) — `rm -rf .next`. This cost an hour of ghost-chasing; check it before suspecting your code.

## Deferred / known warts (as they actually stand)

- Orphaned attachments: dialog closed after upload → unlinked records + blobs, no reaping (accepted, deferred).
- HEIC accepted and stored raw; non-Safari rendering quirks deferred. No image resizing/thumbnails (full-size blob URLs in `<img>`).
- OCR fires on the **newest** attachment only (multi-image OCR deferred); removing a photo mid-OCR doesn't cancel the in-flight call (field stays editable; hint clears on edit).
- `attachmentCount` recomputed on every logs GET (fine at this scale; denormalize onto `Log` if it ever matters).
- **`.env.local` has TWO `OPENAI_API_KEY` lines** (a `"DEBUG"` placeholder ~line 36, the real `sk-…` below it). Last-one-wins keeps it working, but scripts that grab the first match break — delete the placeholder when convenient.

## Env/deps

- New env vars, all documented in AGENTS.md: `OPENAI_API_KEY` (server-only — deliberately **not** in `next.config.mjs`'s `env` whitelist), `AI_MOCK` (server-side), `BLOB_MOCK` (client-read → whitelisted by exact name). No new npm dependencies were added in Phase 1 (`openai` v4.104, `@vercel/blob` v2.5 were already present). Your S7 adds `@upstash/vector` (+ env vars), S9 adds `unpdf`.
- Prompt text lives in `services/odometer.ts` (`ODOMETER_PROMPT`); model names only in `services/ai.ts`'s `MODELS`.
