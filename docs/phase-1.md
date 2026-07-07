# Phase 1 — Substrate + first AI win: implementable stories

Breakdown of [roadmap](./roadmap.md) Phase 1 into stories with acceptance criteria. Ordered by dependency; S1–S3 are parallelizable, everything after builds on them.

Groundwork already in place: `openai` (v4) and `@vercel/blob` are already dependencies; `BLOB_READ_WRITE_TOKEN` is already a required env var.

**Pre-step**: before any story, run [implementation-plans/phase-1-s0.md](./implementation-plans/phase-1-s0.md) — groundwork checks plus resolution of the flags raised in the plan review.

---

## S1 — OpenAI service layer (`services/ai.ts`)

Single module wrapping the OpenAI client, following the existing service conventions (module-scope setup, `console.log("services.ai.<fn>", {...})` debug logging, thin typed functions).

**Scope for Phase 1**: only what odometer OCR needs — one function like `extractFromImage({ imageUrl, prompt, schema })` that sends an image to a vision-capable model with `response_format: { type: "json_schema", ... }` and returns parsed, typed JSON. (Plain JSON schema, not the zod helper — zod isn't a dependency and one schema doesn't justify adding it.) Chat/embeddings come in Phases 2–3; just don't paint the module into a corner (e.g. keep model names in one config const, not inline).

**Mock mode**: when `AI_MOCK=true` (or `NEXT_PUBLIC_MOCK_AUTH=true` test runs), return canned responses instead of calling OpenAI — same pattern/motivation as `STORE_TYPE=memory`: Playwright tests must be deterministic and must not need (or spend) a real API key.

**Env footgun note**: `OPENAI_API_KEY` is server-only. Do **not** add it to `next.config.mjs`'s `env` whitelist — that block exists precisely to expose vars to the browser, which is exactly wrong for a secret.

**Acceptance criteria**
- [ ] `OPENAI_API_KEY` documented in AGENTS.md's required-env-vars section; absent key fails loudly at call time (clear error), not silently.
- [ ] `extractFromImage` returns typed JSON matching the supplied schema; API errors surface as thrown errors the route layer can turn into 5xx JSON.
- [ ] `AI_MOCK=true` short-circuits with a canned response and zero network calls.
- [ ] No `NEXT_PUBLIC_` or `next.config.mjs` exposure of the key; module is only imported from server code.

## S2 — `Attachment` entity

New entity via the six-touchpoint pattern (AGENTS.md "Adding a new entity"), copying `Vehicle` as reference.

**Shape** (`types/Attachment.ts`): `id`, `createdAt/By`, `updatedAt/By`, `deletedAt`, `userId`, `logId?` (optional — uploaded before the log exists, linked on save; Phase 2 documents will attach elsewhere), `vehicleId?`, `url` (blob URL), `pathname` (blob pathname, needed for deletion), `contentType`, `size`, `filename`. Lookups: `user: "userId"`, `log: "logId"`.

**Acceptance criteria**
- [ ] All six touchpoints done — including **both** store backends (`redis.ts` and `memory.ts`, the easy-to-miss one) and `storeConfigs` entry with key `MotoAttachment`.
- [ ] API routes follow the existing contract: `currentUser()` + 403, reads scoped by `user: user.id`, ownership check on `[id]` routes, identity fields pinned on PUT, client-supplied `id` destructured off before create (per the AGENTS.md gotcha).
- [ ] DELETE on an attachment also deletes the blob (`del(pathname)` from `@vercel/blob`) — record and blob never diverge silently.
- [ ] `test/api` spec covering create/list/get/delete + ownership (mirroring whatever exists for vehicles/logs).

## S3 — Blob upload route

`app/api/attachments/upload/route.ts` using `@vercel/blob/client`'s `handleUpload` token-exchange flow, so files go **client → Blob directly** rather than through the Next.js function (phone photos are multi-MB; serverless request bodies cap at ~4.5MB on Vercel — routing uploads through the API would be both a size ceiling and slow).

- `onBeforeGenerateToken`: require `currentUser()`, restrict `allowedContentTypes` (images + PDF for now), prefix pathnames `moto/{userId}/` with `addRandomSuffix`.
- `onUploadCompleted`: create the `Attachment` record (no `logId` yet — linked in S4). Note: this callback doesn't fire on localhost without a tunnel, so the client should also POST to create the attachment record after upload completes, idempotently (find-by-pathname or create).

**Acceptance criteria**
- [ ] Unauthenticated upload token request → 403.
- [ ] Uploaded file lands under `moto/{userId}/…` and an `Attachment` record exists pointing at it, owned by the uploader.
- [ ] Works in local dev (record creation doesn't depend on the completion webhook).
- [ ] Oversized/wrong-type files rejected with a user-visible message (set a `maximumSizeInBytes`, e.g. 20MB).

## S4 — Attach pic/file in the log dialog

Extend `components/log-entry-dialog.tsx` (all three modes) with an attach affordance.

- Input: `<input type="file" accept="image/*,.pdf" capture="environment">` styled as a camera/paperclip button — on mobile this opens the camera directly (the low-friction path); on desktop it's a file picker. Allow multiple.
- On pick: upload immediately (S3 flow) with a per-file progress/spinner state, show thumbnail (images) or filename chip (files), each removable before save (remove = delete attachment + blob).
- On save: dialog's `onSubmit` payload gains `attachmentIds`; the save path (dashboard `app/page.tsx` handler → `hooks/use-log.tsx` → API) sets `logId` on those attachments after the log is created.
- Save button stays disabled while an upload is in flight (no logs referencing half-uploaded files); an entry with attachments but empty text should be savable for journal/custom mode (the pic *is* the entry) — relax the `canSubmit` rule to `entry text OR ≥1 attachment` for those modes.

**Acceptance criteria**
- [ ] From each of Journal / Mileage / Custom: pick a photo → thumbnail appears → save → log exists with attachments linked (`GET /api/attachments?log=<id>` returns them).
- [ ] Removing a pending attachment before save deletes the record and blob.
- [ ] Cancel/close after uploading doesn't leave the UI wedged; orphaned attachment records (no `logId`) are acceptable for now — note a deferred cleanup task rather than building reaping.
- [ ] Journal/custom entry with photo only (no text) can be saved; mileage still requires a numeric reading (until S6 fills it).
- [ ] Upload in flight → Save disabled with visible state.

## S5 — Show attachments on logs

- **Log detail page** (`/logs/[id]`): attachments section alongside the JSON editor — image thumbnails opening full-size (new tab is fine), non-images as download links. Deleting the log deletes its attachments (records + blobs) — extend `services/logs.ts`'s delete path.
- **Latest-entries list** (dashboard) and Logs list: small paperclip/thumbnail indicator on entries that have attachments. Keep it cheap: either include an `attachmentCount`/first-thumbnail in the logs API response or a batched lookup — not N+1 client fetches.

**Acceptance criteria**
- [ ] Log with attachments shows them on its detail page; image opens full-size; file downloads.
- [ ] Lists indicate which entries have attachments without a per-row request.
- [ ] Deleting a log removes its attachment records and blobs.

## S6 — Odometer photo → mileage (the demo)

The end-to-end slice: in the mileage-mode dialog, a photo of the odometer pre-fills the reading.

- New route `app/api/ai/odometer/route.ts`: auth-gated, takes an attachment id (or blob URL owned by the user), calls S1's `extractFromImage` with an odometer-reading schema `{ reading: number | null, unit?: "km" | "mi", confidence: "high" | "low" }`, returns it.
- Dialog flow (mileage mode): photo picked → uploads (S4) → OCR call fires automatically → odometer field fills in with a subtle "read from photo ✨" hint → user can correct → Save. The existing `saveLog()` behavior (updating `vehicle.mileage`) is untouched.
- Failure path is first-class: unreadable photo → non-blocking "couldn't read the odometer" note, field stays empty and editable, photo stays attached. Low confidence → fill the field but visibly flag it for confirmation.
- Sanity check: if the reading is *lower* than the vehicle's current `mileage`, warn before save (wrong bike / mis-OCR catch) but allow it (corrections are legitimate).

**Acceptance criteria**
- [ ] Phone flow: Record → Current Mileage → snap photo → reading appears pre-filled → Save → mileage log created with photo attached and `vehicle.mileage` updated. No typing except tapping Save when OCR is right.
- [ ] Unreadable image degrades to ordinary manual entry with the photo attached; no error wall.
- [ ] Reading below current vehicle mileage triggers a confirm, not a silent save.
- [ ] OCR route: 403 unauthenticated; 404/403 for an attachment the user doesn't own.
- [ ] `test/api` spec for the OCR route running against `AI_MOCK=true` (deterministic canned reading).

---

## Sequencing & sizing

| Story | Depends on | Size |
|---|---|---|
| S1 OpenAI service layer | — | S |
| S2 Attachment entity | — | M |
| S3 Blob upload route | S2 | S |
| S4 Attach in log dialog | S2, S3 | M |
| S5 Show attachments | S2, S4 | S–M |
| S6 Odometer OCR | S1, S4 | M |

Deferred from Phase 1 (noted, not built): orphaned-attachment reaping, HEIC conversion edge cases, image resizing/thumbnails (blob URLs served as-is for now), multi-image OCR.

## Final step — handover to Phase 2

After the last story is implemented and verified (not before — the handover documents reality, not intent), write `docs/handovers/phase-1-to-phase-2.md`, addressed to the agent implementing [Phase 2](./phase-2.md). The Phase 2 stories and plans were written against *these plans*, so anything that landed differently is a landmine for that agent. Cover:

- **What shipped, where, and the actual exported surfaces** Phase 2 builds on: `services/ai.ts` (the final `extractFromImage` signature, the `MODELS` const, how the `MOCKS` registry is keyed — S7/S10/S11/S13 all extend this file), the attachment upload call chain (`lib/upload.ts` → `/api/attachments/upload` → `/api/attachments`, the `moto/{userId}/` prefix rule and pathname idempotency), and the log-dialog attachment strip S11 reuses.
- **Deviations from these plans**: renames, moved files, changed decisions, dropped or weakened acceptance criteria — and for each, which Phase 2 plan sections it invalidates (they cite S1–S6 files and patterns by name).
- **Test/dev machinery**: mock knobs added (`AI_MOCK`, `BLOB_MOCK`), `playwright.config.ts` changes, memory-store seed changes (Phase 2's S11/S16-era work re-types these seeds), fixtures added under `test/fixtures/`, and anything flaky or order-dependent observed in the suite.
- **Deferred/known-wart list as it actually stands** (orphaned attachments, HEIC, etc.), plus any new warts discovered during implementation.
- **Env/deps**: new env vars and where they're documented, `.env.local` entries the next agent must have, prompt text locations and any tuning notes from the S6 manual pass.
