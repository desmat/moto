# Phase 2 — Documents become data: implementable stories

Breakdown of [roadmap](./roadmap.md) Phase 2, continuing the numbering from [phase-1](./phase-1.md) (S1–S6). Assumes Phase 1 is done: `services/ai.ts` exists (S1), attachments + blob upload work (S2–S4), and the photo→OCR→review→save pattern is established (S6).

Decisions already made (recorded in the roadmap):
- **Embeddings live in Upstash Vector.**
- **Extracted service items are structured fields on `Log`** (the log stays "the thing that happened") **plus a current-state snapshot** ("what's on the bike now") — entity vs. vehicle sub-field resolved in S12 below.

**Pre-step**: before any story, run [implementation-plans/phase-2-s0.md](./implementation-plans/phase-2-s0.md) — verify the Phase 1 handover against the code and resolve the flags raised in the plan review.

One scoping call made here: **`Document` = big reference documents (manuals; later wiring diagrams, insurance papers) that get chunked and embedded. Receipts are *not* Documents** — a receipt's payload becomes structured fields on a `Log` (S11) with the photo as a plain attachment. Nothing about a 40-line receipt needs chunking/embedding, and the log itself is what search and the Phase 3 schedule matcher consume.

---

## S7 — Embedding + vector plumbing

Extend `services/ai.ts` with `embed(texts: string[])` (OpenAI embeddings, model name in the same config const as S1's), and add `services/vector.ts` wrapping `@upstash/vector` (new dependency): `upsertChunks(chunks)`, `queryChunks(text, filter)`, `deleteByDocument(documentId)`. Chunk text lives in vector metadata alongside `{ userId, vehicleId, documentId, chunkIndex }` — no separate Redis read needed at query time; filter every query by `userId` (tenant isolation lives here, not in callers).

**Mock mode**: same pattern as `STORE_TYPE=memory` / `AI_MOCK` — `VECTOR_MOCK=true` (or piggyback on `AI_MOCK`) swaps in an in-memory store with naive cosine similarity so Playwright runs need no Upstash Vector instance.

**Acceptance criteria**
- [ ] `UPSTASH_VECTOR_REST_URL` / `UPSTASH_VECTOR_REST_TOKEN` documented in AGENTS.md's env section; server-only, **not** added to `next.config.mjs`'s `env` whitelist.
- [ ] A query can never return another user's chunks (filter applied inside `services/vector.ts`, verified by a test with two users' data).
- [ ] `deleteByDocument` removes all of a document's vectors (needed by S8's delete path).
- [ ] Mock mode: deterministic, zero network.

## S8 — `Document` entity + upload UI

New entity via the six-touchpoint pattern. Shape (`types/Document.ts`): `id`, `createdAt/By` etc., `userId`, `vehicleId`, `type` (`"manual"` | `"other"` for now), `title`, `attachmentId` (source file via S2/S3 infra), `status` (`"uploaded"` | `"processing"` | `"ready"` | `"error"`), `error?`, `pageCount?`, `summary?`. Lookups: `user`, `vehicle`. Store key `MotoDocument`.

**UI**: a Documents section on the vehicle detail page (`/vehicles/[id]`) — upload button (reuses the S3/S4 upload flow, PDFs and images), list with title/type/status. No new top-level nav item yet (manuals belong to vehicles); if one is added later, remember the AGENTS.md nav rule: `app-sidebar.tsx` `NavItems` + `app-breadcrumbs.tsx` `pageNames` stay in sync by hand.

**Acceptance criteria**
- [ ] All six touchpoints, both store backends, `storeConfigs` entry.
- [ ] API routes follow the existing contract (auth, user-scoped reads, ownership on `[id]`, pinned identity fields, `id` destructured off before create).
- [ ] Upload a PDF against a vehicle → Document record in `uploaded` status, linked to its Attachment.
- [ ] Deleting a Document deletes its vectors (S7), its attachment record, and the blob.
- [ ] `test/api` spec for CRUD + ownership.

## S9 — Ingestion pipeline (extract → chunk → embed)

`services/documents.ts` gains `ingestDocument(id)`: pull the file from Blob, extract text, chunk (~800 tokens, ~15% overlap, keep page numbers in chunk metadata for citations later), `embed()` (S7), upsert to Upstash Vector, flip status `processing` → `ready` (or `error` with a stored message). Plus `searchDocuments(query, { userId, vehicleId?, documentId? })` → embed query → `queryChunks`.

**Text extraction**: `unpdf` (new dependency, serverless-friendly) for PDF text; image-only pages/photo uploads fall back to S1's vision extraction per page. Rationale: bulk text via OpenAI vision would cost real money per 150-page manual and be slow; unpdf is free and fast, OpenAI handles what unpdf can't read.

**Long-running work**: triggered by `POST /api/documents/[id]/ingest`, which sets `processing` and does the work in-route with `export const maxDuration = 300`. The client polls document status (react-query `refetchInterval` while `processing`). No queue infrastructure yet — a manual is a one-time ingest and 300s is enough; note a deferred task to move to a background job if real manuals blow the budget.

**Acceptance criteria**
- [ ] Upload → ingest → `ready`, and `searchDocuments("valve clearance", { vehicleId })` returns relevant chunks with document/page metadata.
- [ ] Failure mid-ingest → status `error` with message surfaced in the Documents UI, and a re-try affordance (re-ingest is idempotent: `deleteByDocument` first).
- [ ] UI shows `processing` state live (polling) without a manual refresh.
- [ ] Mocked end-to-end `test/api` spec (AI + vector mocks): ingest a small fixture PDF, search returns its content.

## S10 — Manual → `MaintenanceSchedule` entity

Upload flow for `type: "manual"` documents additionally extracts a structured maintenance schedule.

**Entity** (`types/MaintenanceSchedule.ts`, six touchpoints, key `MotoMaintenanceSchedule`): `userId`, `vehicleId`, `documentId?`, `source` (`"manual"` | `"generic"` | `"user"` — `generic` reserved for the Phase 3+ no-manual fallback), `items: ScheduleItem[]` where `ScheduleItem = { key (slug), name, action ("replace" | "inspect" | "adjust" | "lubricate" | "clean" | ...), intervalKm?, intervalMonths?, firstAtKm?, notes? }`. One schedule per vehicle (latest wins; re-extraction replaces after review).

**Extraction**: send the manual to OpenAI as a file input (schedule tables are often scanned tables that raw text extraction mangles — this is the one place we pay for full-document AI reading) with a JSON-schema response of `ScheduleItem[]`. Normalize units to km + months at extraction time; keep the manual's original phrasing in `notes`.

**Review before commit**: extraction lands as a *proposed* schedule the user reviews in a simple editable table (edit/delete rows, fix intervals) and confirms — AI output becomes canonical data only after human sign-off. (Same review-then-save pattern as S6 and S11; worth building as a reusable "review extracted rows" component.)

**Acceptance criteria**
- [ ] Uploading a real owner's manual produces a plausible proposed schedule (manually verified against a known manual, e.g. CB500X).
- [ ] User can edit/remove rows before confirming; confirmed schedule persists and is visible on the vehicle page.
- [ ] Re-uploading/re-extracting proposes a new schedule without clobbering the confirmed one until confirmed.
- [ ] Mocked `test/api` spec: canned extraction → confirm → schedule retrievable via API.

## S11 — Receipt scan → structured service log

**Log type extension** (`types/Log.ts`): new built-in `LogTypeService = "service"`, plus optional structured fields on `Log`: `items?: { name, action, note?, cost? }[]`, `mileage?: number`, `vendor?: string`, `totalCost?: number`. Existing logs are untouched (all fields optional).

**Flow**: new quick-record entry point "Service / Receipt" beside Journal/Mileage/Custom → snap/upload receipt photo(s) (S4 infra) → `POST /api/ai/receipt` runs S1's `extractFromImage` with a receipt schema (date, vendor, odometer if printed, line items with inferred `action`, per-line + total cost) → review screen with editable pre-filled fields (the S10 review component) → save as a `service` log with the photo attached. Manual entry (no photo) through the same form must also work — the scan is an accelerator, not a gate.

**Side effects in `saveLog`** (extending the existing mileage-sync block in `services/logs.ts`): a service log with `mileage` updates `vehicle.mileage` under the same guards (ownership, numeric, with S6's "lower than current" confirm happening client-side); items feed the S12 state update.

**Acceptance criteria**
- [ ] Photo of a real shop invoice → review screen with date, vendor, line items, costs pre-filled; user corrects a line; save → `service` log with structured `items` and attachment.
- [ ] Same form works with zero AI (manual entry, no photo).
- [ ] `mileage` on the receipt updates `vehicle.mileage` (same rules as mileage logs).
- [ ] Unreadable/partial receipt degrades to a mostly-empty editable form, photo still attached (S6's failure-path standard).
- [ ] 403/ownership checks on the extraction route; mocked `test/api` spec for extract → save.

## S12 — Vehicle current-state ("what's on the bike now")

Resolves the roadmap's open question (entity vs. sub-field): **sub-field on `Vehicle`** — `components?: { [key: string]: { name, detail?, action, date, mileage?, logId } }` — maintained by `saveLog` whenever a log carries structured `items`, exactly mirroring the existing `vehicle.mileage` sync precedent ([services/logs.ts:40-49](../services/logs.ts#L40-L49)). Rationale: current-state is a derived snapshot, not a thing that happened (history stays in logs); a fourth entity would add six touchpoints of ceremony for what is one map that's always read with the vehicle. The `logId` back-pointer keeps it auditable, and it's rebuildable from logs if it ever drifts. Tradeoff accepted: it's editable via the vehicle JSON editor — fine, identity fields are still pinned, and hand-correcting state is arguably a feature.

- `key` is a normalized slug of the item name ("Front tire — Michelin Anakee Adventure" → `front-tire`); the extraction schema (S10/S11) should ask the model for a canonical `key` alongside the display name so slugs converge ("front tyre", "fr tire" → `front-tire`). Fuzzy reconciliation beyond that is Phase 3's matcher problem.
- Only `replace`/`install`-type actions update `detail` (what's mounted); any action updates `date`/`mileage` (last touched).
- **Display**: a "Current setup" card on the vehicle detail page — component, what's installed, last serviced date + mileage, linked to the source log.

**Acceptance criteria**
- [ ] Saving a service log with "replaced front tire — Michelin Anakee Adventure" at 18,250 km → `vehicle.components["front-tire"]` reflects it; card shows it; link opens the source log.
- [ ] A later "inspected front tire" log updates date/mileage but not `detail`.
- [ ] Two receipts using different phrasings for the same component converge on one key (via extraction-time canonicalization).
- [ ] Deleting the source log leaves state intact (snapshot semantics — document this; rebuild-from-logs is a deferred admin task).

## S13 — AI onboarding interview

Augment, don't replace: the forced `SetupVehicleDialog` stays (it's already minimal — type/maker/model/year), and on first-vehicle creation flows into an optional AI follow-up session. A dashboard card ("Finish setting up your ⟨bike⟩ — 2 min") reopens it if skipped.

**The session** (chat-style dialog, `POST /api/ai/onboarding` per turn): given the just-created vehicle, the AI asks one thing at a time — current mileage; "when did you last change the oil / chain / tires?" (question list generated from generic knowledge of that make/model, or from the schedule if a manual is already ingested); "have the owner's manual as a PDF? upload it here" (embeds the S8 upload); "recent service receipts? snap them" (S11 flow inline). Free-text answers like "oil was done maybe 2k km ago at the dealer" get structured by the model into proposed backdated logs.

**Output is reviewable, like everything else**: the session ends with a summary screen — "I'll record: mileage 18,250 • oil change ~16,250 km (est.) • new tires May 2026" — user confirms, records are created as backdated logs (which via S12 also seed `vehicle.components`, and via the existing sync set `vehicle.mileage`). Skippable at every step; skipping creates nothing.

**Acceptance criteria**
- [ ] Fresh user: vehicle dialog → interview → answer three questions in free text → confirm → backdated logs exist with sensible `date`/`mileage`, vehicle mileage + components updated.
- [ ] "Skip" at any point exits cleanly with no records; the finish-setup card reappears until completed or dismissed.
- [ ] Manual uploaded mid-interview lands in the S8/S9 pipeline (interview doesn't block on ingestion).
- [ ] `AI_MOCK=true` drives a canned interview script so an e2e Playwright spec can cover the whole flow deterministically.
- [ ] Nothing the AI proposes is persisted without the confirm step.

---

## Sequencing & sizing

| Story | Depends on | Size |
|---|---|---|
| S7 Embedding + vector plumbing | S1 | S |
| S8 Document entity + upload UI | S2, S3 | M |
| S9 Ingestion pipeline | S7, S8 | M–L |
| S10 Manual → MaintenanceSchedule | S8, S9 | L |
| S11 Receipt → structured service log | S1, S4 | M–L |
| S12 Vehicle current-state | S11 | S–M |
| S13 AI onboarding interview | S1 (richer with S9–S12) | L |

S7/S8 and S11 are independent tracks; S11+S12 (receipts → state) is the highest user-visible value per effort and can ship before the manual pipeline (S9/S10) if desired. S13 last — it stitches the others together.

**New dependencies**: `@upstash/vector`, `unpdf`. **New env vars**: `UPSTASH_VECTOR_REST_URL`, `UPSTASH_VECTOR_REST_TOKEN` (server-only — not whitelisted in `next.config.mjs`).

Deferred from Phase 2: background job queue for ingestion (in-route `maxDuration` for now), rebuild-components-from-logs admin task, multi-manual/versioned schedules per vehicle, canonical component taxonomy beyond extraction-time slugging, handwritten receipt quality, citation UI for chunk page numbers (metadata is captured; surfacing it is Phase 3 chat).

## Final step — handover to Phase 3

After the last story is implemented and verified, write `docs/handovers/phase-2-to-phase-3.md`, addressed to the agent implementing [Phase 3](./phase-3.md). Phase 3's engine (S14) and chat (S18) consume Phase 2's data model directly — this handover is what keeps them from re-deriving it. Cover:

- **The contracts Phase 3 reads**: `MaintenanceSchedule`/`ScheduleItem` as actually shipped (S14 computes over it), how the one-confirmed-schedule-per-vehicle invariant is enforced and through which code path (`confirmSchedule` vs. routes — S14's test fixtures POST confirmed schedules and need to know the sanctioned way), `CANONICAL_COMPONENT_KEYS` location and final vocabulary, the structured `Log` fields (`items`/`mileage`/`vendor`/`totalCost`) and `saveLog`'s post-save block structure (mileage sync + monotonic rule + components update — S14 appends its classifier to this exact block), and `searchDocuments`' signature/result shape (S18's tool).
- **Reusable UI pieces and their props**: `extracted-rows.tsx`, `service-log-dialog.tsx` (S16/S17 add `defaultItems`/`defaultVehicleId` to it), the review-then-confirm pattern conventions.
- **Deviations from these plans**, each mapped to the Phase 3 plan sections it invalidates (S14–S18 cite Phase 2 files, seeds, and mocks by name).
- **Seed/mock state**: exact memory-store seed contents after the S11 re-typing (S16's dashboard seed math is tuned against these numbers — include dates, mileages, and which seeded logs carry `items`/keys), the `AI_MOCK` mock registry entries and scripted behaviors (S13's interview script, classifier mocks), and any test-suite order/parallelism hazards observed.
- **Prompts**: where the manual-extraction, receipt, and onboarding prompts live and what the real-data tuning passes learned (these are named the highest-leverage prompts — the notes matter more than the code).
- **Env/deps**: `@upstash/vector`/`unpdf`, vector index provisioning steps as actually performed, new env vars.
