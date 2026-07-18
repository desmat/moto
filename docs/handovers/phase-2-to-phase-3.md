# Handover: Phase 2 → Phase 3

Addressed to the agent implementing [Phase 3](../phase-3.md). Phase 2 (S7–S13 per [phase-2.md](../phase-2.md)) is fully landed on `main` and verified — every story got a real-key/real-data pass on top of the mocked suite (real manuals through schedule extraction, the user's real multi-page shop invoices through receipt extraction, a live-conversation pass of the onboarding interview). The Phase 3 plans were written against the Phase 2 *plans*; this documents what actually shipped, where it deviates, and what those deviations touch in S14–S18. Read alongside AGENTS.md (updated throughout the phase and current).

## The contracts Phase 3 reads

### `MaintenanceSchedule` (S10) — what S14 computes over

`types/MaintenanceSchedule.ts`, exactly as planned plus one addition the plans don't mention — **`status: "proposed" | "confirmed"`**:

```ts
type ScheduleItem = {
  key: string;            // canonical slug (see CANONICAL_COMPONENT_KEYS below)
  name: string;           // display name as the manual phrases it
  action: "replace" | "inspect" | "adjust" | "lubricate" | "clean" | "other";
  intervalKm?: number;
  intervalMonths?: number;
  firstAtKm?: number;     // break-in/first-service items
  notes?: string;         // the manual's original phrasing (units, conditions, caveats)
};
type MaintenanceSchedule = { id, createdAt/By, updatedAt/By, userId, vehicleId,
  documentId?,            // absent for "generic"/hand-entered
  source: "manual" | "generic" | "user",
  status: "proposed" | "confirmed",
  items: ScheduleItem[] };
```

Proposed-vs-confirmed is a **status field, not separate entities**. Extraction creates a `proposed` record; **`services/schedules.ts`'s `confirmSchedule(id, by)` is the ONLY code path that sets `"confirmed"`** — it promotes first, then sweeps (deletes) any *other* confirmed schedule for the vehicle, so the one-confirmed-schedule-per-vehicle invariant always holds and is self-healing (re-confirming is an idempotent no-op that still sweeps). The routes funnel into it: `PUT /api/schedules/[id]` with a body status of `"confirmed"` applies edits keeping the stored status then delegates; `POST /api/schedules` arriving `"confirmed"` is created as `"proposed"` then passed through. **S14 test fixtures that need a confirmed schedule: POST it, then confirm via the API (`PUT` with `status: "confirmed"`)** — never write `status: "confirmed"` directly. **Phase 3 computations must read confirmed schedules only** (a dangling proposal is inert by design). Store key `MotoMaintenanceSchedule`, entity name `schedules`, lookups `user`/`vehicle`.

### `CANONICAL_COMPONENT_KEYS` — the reconciliation vocabulary

Lives in `types/MaintenanceSchedule.ts` (23 keys): `engine-oil, oil-filter, air-filter, fuel-line, spark-plugs, valve-clearance, coolant, chain, sprockets, clutch, throttle, front-tire, rear-tire, wheels, brake-fluid, brake-pads-front, brake-pads-rear, brake-hoses, suspension-front, suspension-rear, steering-bearings, battery, lights`.

It is **guidance, not an enum** — strict-mode JSON schemas can't hold a dynamic vocabulary, so every extraction prompt interpolates the list ("STRONGLY prefer one of…, only mint a new kebab-case slug when none fit") and every service slugifies server-side. Consequence for S14's matcher: real extracted data **does** contain off-list keys (the seeded CB500X schedule has `crankcase-breather`, `cooling-system`, `side-stand`…; the seeded CRF250RL schedule even has shop-typo keys like `brake-fuild`, `steering-ead-bearings` — kept deliberately as realistic data). Key equality reconciles the canonical ones; the rest is the matcher problem the phase doc defers.

### `Log` structured fields (S11) + `saveLog`'s post-save block (S14 appends its classifier here)

`types/Log.ts`: optional `items?: LogItem[]`, `mileage?: number`, `vendor?: string`, `totalCost?: number` on every log; `LogItem = { key, name, action (same 6-value union as ScheduleItem), note?, cost? }` — deliberately shares the key vocabulary with `ScheduleItem` so S14 reconciles by key equality. `LogTypeService = "service"` joined the built-ins.

`services/logs.ts` `saveLog(data, user)` runs, in order:
1. **Entry composition**: a `service` log with no `entry` but with `items` gets one composed from the first 3 item names + "+N more" + vendor (done in the service so every entrance gets it — receipt dialog, raw API, S13's proposed logs).
2. The store write (create/update).
3. **The post-save vehicle sync block** (this is the block S14's plan says to append the classifier to — `services/logs.ts` ~lines 100–134): mileage-type logs overwrite `vehicle.mileage` **always** (entry parsed as the reading; deliberate downward corrections stay possible); any other log type carrying numeric `mileage` updates it **monotonically** (only if higher — backdated receipts must not clobber fresher readings). **Only `service`-type logs** fold `items` into `vehicle.components` via `applyItemsToComponents` (exported, pure — the admin rebuild and tests replay the same rules): newer-dated state wins (YYYYMMDD string compare, same-day write wins), `replace` (or first-install `other`) sets `detail` from `item.note`, every applied action refreshes name/action/date/mileage/logId. Items on a journal log are stored but inert. One vehicle update carries both mileage and components.

`vehicle.components` is `Record<string, VehicleComponentState>` (`types/Vehicle.ts`) — a **snapshot**: deleting the source log leaves state intact; `services/admin.ts`'s `rebuildComponents(userId)` is the recovery path.

### `searchDocuments` (S9) — S18's tool

```ts
// services/documents.ts
searchDocuments(query: string, { userId, vehicleId?, documentId? }): Promise<(Chunk & { score: number })[]>
// services/vector.ts
type Chunk = { documentId, chunkIndex, page, text, userId, vehicleId };
```

`userId` is required — tenant isolation is enforced *inside* `queryChunks` (`services/vector.ts`), not by callers. Chunk text + page live in vector metadata, so a search result is render-ready with page citations, no Redis read. Upstash upserts index **asynchronously** — query-right-after-upsert can return 0; verification scripts poll/sleep.

### `chatJSON` (S13) — the structured-chat primitive S18's chat can build on

```ts
// services/ai.ts
chatJSON<T>({ messages: ChatMessage[], schemaName, schema, model?, reasoningEffort? }): Promise<T>
```

Whole conversation in, one strict-JSON turn out (shares `completeJSON` internals with `extractFromImage`). The S13 pattern S18's plan calls "S18-style" already exists end-to-end: **client-held transcript** POSTed each turn (no server-side session), route caps at 20 messages (drop oldest) and validates roles (`user`/`assistant` only — client-supplied `system` is a 400), system prompt prepended fresh per call with vehicle context interpolated. Copy `app/api/ai/onboarding/route.ts` + `components/onboarding-interview.tsx`'s transcript handling for `/insights` chat.

**Mock behavior**: when the `test/fixtures/ai-mocks.json` entry for `schemaName` is an **array**, `chatJSON` walks it as a script indexed by the count of `user` messages in the transcript (0 answers → first turn), sticking on the last turn when exhausted. A dict entry behaves like the static mocks. This is how S18's chat gets a deterministic e2e script.

## Reusable UI pieces

- **`components/extracted-rows.tsx`** — the review-then-confirm table (S10/S11/S13 all use it). Props: `columns: { label, field, type: "text" | "number" | "select" | "badge", options?, width? }[]`, `rows: any[]`, `onChange(rows)`, `allowAdd?: boolean` (default true). `"badge"` renders a read-only muted pill (the column label, lowercased) when the field is truthy — S13's "est." column. Rows are plain objects; delete is built in.
- **`components/service-log-dialog.tsx`** — S16/S17's plan adds `defaultItems`/`defaultVehicleId`; current props are `{ vehicles?, onSubmit?(log: { vehicleId, type, date, entry, items, mileage?, vendor?, totalCost?, attachmentIds }), children }` (trigger-wrapping pattern). Its vehicle picker defaults to **unselected** with Save gated on a choice (S12c decision) — receipt scans auto-select via `matchVehicleDescription` (see deviations).
- **`components/onboarding-interview.tsx`** — the chat dialog (bubbles, per-turn POST, inline `VehicleDocuments` upload when the turn sets `suggestUpload`, swap-to-review-table on `done`, mileage-log-last confirm ordering). Reference implementation for S18's chat UI.
- **The review-then-confirm convention** (S6 → S10 → S11 → S13, keep it in Phase 3): AI output is never persisted directly — it lands in an editable `extracted-rows` table (or pre-filled form) and becomes data only on explicit confirm, through the normal CRUD routes.

## Deviations from the Phase 2 plans (and what they touch in S14–S18)

- **Models are the gpt-5.6 family now**, not gpt-4o: `MODELS.vision = "gpt-5.6-terra"` (default), with per-feature overrides chosen by eval — odometer `gpt-5.6-luna`/effort `none`, schedule extraction `gpt-5.6-sol`/effort `medium`, receipt + onboarding default terra/effort `low`. `extractFromImage`/`extractFromFile`/`chatJSON` all take optional `model`/`reasoningEffort`. Any Phase 3 plan line saying "gpt-4o" is stale; model names live only in `services/ai.ts` `MODELS` + these per-service overrides.
- **Schedule proposed/confirmed is a status field with a single confirm path** (see contracts above) — S14 fixture setup must confirm via the API, not POST `status: "confirmed"`.
- **Receipt extraction resolves the vehicle** (S12b/c, unplanned): the receipt schema has a `vehicle` field (description as printed); `matchVehicleDescription(description, vehicles)` in `types/Vehicle.ts` does loose longest-prefix model matching (handles shop typos — a real invoice printing "CFR250RL" resolves to the CRF250RL) and auto-selects the untouched picker; no/ambiguous match warns inline.
- **Receipt items are synthesized, not transcribed** (S12d): the prompt folds labor/part/consumable lines into one item per component, splits oil vs. oil-filter, keeps real one-off repairs as minted-slug items, routes tune-up checklist noise into a `general-service` umbrella item, and omits taxes/fees. Iterated on the user's two real invoices. S16's "recent work" surfaces get clean per-component items, not invoice noise.
- **Dashboard charts remain disabled** (Phase 1 deviation, still true); the dashboard now also carries S13's per-vehicle "Finish setting up" cards (localStorage-dismissed, key `moto:onboarding:dismissed`) — S16's "next due" section lands alongside these, and its e2e specs must tolerate cards from parallel specs' zero-log vehicles.
- **`trackEvent` types** (`types/TrackingEvent.ts`) grew through the phase (`document-*`, `schedule-*`, `odometer-ocr`, `receipt-ocr`, `onboarding-turn`) — S14/S18 events extend this union.
- No Phase 2 acceptance criteria were dropped. Deferred list as planned (phase-2.md): no job queue (in-route `maxDuration: 300` + client polling), no schedule versioning, citation UI (page metadata captured, not surfaced — that's S18), handwritten receipts.

## Seed / mock state (S16's dashboard seed math reads this)

`services/stores/memory.ts` (`STORE_TYPE=memory`), all under `smokeTestUserId`. **Log dates are RELATIVE** — `seedDate(daysAgo)`/`mk(daysAgo, …)` compute from "now" at server start, so seed math must be expressed in days-ago, not absolute dates:

- **Vehicles (4)**: CB500X `vehicle-smoketest` (2021, **mileage 18250**, `components` seeded with 4 keys: `engine-oil` + `oil-filter` @ 3 days ago / `smoke-log-3`, `front-tire` + `rear-tire` "Michelin Anakee Adventure" @ 10 days ago / `smoke-log-7`); Yamaha XT250 `vehicle-smoketest-2` (2018, mileage 9400); Honda CRF250RL `vehicle-crf250rl` (2020, mileage 3200); Suzuki GSX-R 750 `vehicle-gsxr750` (2009, mileage 22500).
- **Logs (7, all on the CB500X)**: day-0 journal (chain cleaned), day-1 **mileage 18250** (`smoke-log-2`), day-3 **service** with `items` (`engine-oil` + `oil-filter`, `smoke-log-3`), day-5 custom type "chain adjustment", day-8 journal (spongy brake lever), day-10 **service** with `items` (`front-tire` + `rear-tire`, `smoke-log-7`, carries the seeded attachment), day-12 mileage 17980.
- **Schedules (3, all `source: "manual"`, `status: "confirmed"`, ids `schedule-seed-0/1/2`)**: CB500X (26 items, real extracted CB500X manual data), CRF250RL (real extracted, includes typo keys), XT250 (real extracted, Yamaha's 6000km/6mo cadence). **GSX-R 750 deliberately has no schedule** — it's the "no manual ingested" case S14/S16 need. These were pasted in via a temporary copy-schedule-JSON mechanism marked `TEMPORARY` in the file — fine to keep using, meant to be removed eventually.
- **No seeded documents** (on purpose — a seeded "ready" doc would need seeded mock vectors; S9's spec creates its own), one seeded attachment (`attachment-smoketest`, data-URL png on `smoke-log-7`).
- **`test/fixtures/ai-mocks.json` keys**: `odometer`, `receipt`, `pageTranscription`, `manualSchedule` (dicts) and `onboarding` (the scripted **array**: 3 questions → `done` with one estimated backdated `engine-oil` service log @ `20260315`/10800 + one mileage log `20260701`/12800; turn 3 sets `suggestUpload`). S14's classifier mock and S18's chat script get added here, keyed by `schemaName` — array = script, dict = static.
- **Suite is 76 tests** at handover (`test/api`: attachments, components, documents, ingest, odometer, onboarding, ownership, receipts, schedules, upload, vehicle-match; `test/e2e`: components-card, log-attachments, odometer-ocr, onboarding, service-log, smoke), all green. **Parallelism hazards observed**: the isolation convention is load-bearing — parallel specs constantly create vehicles/logs, so never assert on seeds, list positions, or "the only X"; S13's e2e enters via the per-vehicle finish-setup card precisely because the fresh-user forced-dialog path can't run under the seeded store. One unreproducible smoke-spec flake was observed once in ~5 full runs (a `/api/logs` POST response missing `log`) — rerun before suspecting your diff, and check the stale-`.next` gotcha (AGENTS.md) for ChunkLoadError-flavored failures.

## Prompts — where they live and what tuning taught (the notes matter more than the code)

All extraction prompts are strict-transcriber framed with a **leading boolean visibility gate** in the schema (`odometer_digits_clearly_visible`, `receipt_clearly_visible`, `page_text_clearly_legible`, `schedule_table_found`) — the Phase 1 hallucination fix, verified again this phase (the placeholder receipt fixture correctly gates false under a real key). Any new Phase 3 extraction schema must repeat the pattern. S13's turn schema deliberately has **no** gate (no image to hallucinate from; noted in code).

- **`services/schedule-extraction.ts` `SCHEDULE_PROMPT`** (exported for the eval harness) + `gpt-5.6-sol`/`medium`. Tuned against the real CB500X manual: 7/26 → 22/26 interval decode. The harness is **`docs/prompt-evals/schedule-extraction-eval.ts`** with ground truth `cb500x-schedule-ground-truth.md` — rerun it after any prompt/model change (it scores the exported shipped prompt directly, and `extractFromFile` takes `--model` comparisons). Negative results, documented so you don't retry them: temperature 0 didn't help; a maker-hint in the prompt didn't help. The footnote rule (row markers `*1` resolve to notes possibly on the NEXT page) was the single biggest win.
- **`services/receipt.ts` `RECEIPT_PROMPT`**: multi-page = pages of ONE invoice read together (user-reported bug: only the last page was scanned when pages went in separate calls — all pages go in one `extractFromImage` call via `imageUrls`); items synthesized per component (see deviations); French receipts translated; `KM OUT` preferred for mileage. Iterated on two real invoices (a 2-page Honda dealer invoice with a shop typo, a 3-page $1,927 tune-up). The user's real receipt photos are in `~/Downloads` (`2a_/2b_PXL…`, `3a_/3b_/3c_PXL…`); `test/fixtures/receipt.jpg` is a deliberate 64×32 placeholder that gates false under a real key.
- **`services/onboarding.ts` `systemPrompt(vehicle)`** + turn schema: per-vehicle interpolation, today's date, ≤5 questions in fixed order, vague answers → `estimated: true` values, at-most-one-mileage-log rule (historical readings ride on backdated service logs; the client also dedupes and POSTs mileage last — belt and braces). Real-key tuning caught the model **dropping earlier-proposed logs on the final turn while the summary still promised them** — the fix is the explicit "NEVER drop a previously proposed log; the done-summary must describe exactly what the proposal contains" rule. If you touch this prompt, re-test specifically that turn-N proposals survive to `done`.
- **`services/odometer.ts` `ODOMETER_PROMPT`** (`gpt-5.6-luna`/`none`) and **`services/documents.ts` `PAGE_TRANSCRIPTION_PROMPT`** — unchanged shapes from their stories, both gate-first.

## Env / deps / machinery

- **New deps**: `@upstash/vector`, `unpdf`. No others.
- **New env vars**: `UPSTASH_VECTOR_REST_URL` / `UPSTASH_VECTOR_REST_TOKEN` — server-only, **not** in `next.config.mjs`'s `env` whitelist (that block exposes to the browser). The index was provisioned via the **Vercel marketplace** (2026-07-11): **cosine metric, 1536 dimensions** — must match `MODELS.embedding` (`text-embedding-3-small`).
- **`AI_MOCK=true` is ONE knob on purpose**: it mocks chat/extraction (ai-mocks.json), embeddings (deterministic bag-of-words vectors, computed in code), and the vector store (in-memory brute-force cosine). **`.env.local` sets `STORE_TYPE=memory` AND `AI_MOCK=true`** — a plain `npm run dev` is fully mocked, and any real-key verification must pass `AI_MOCK=false` explicitly on the command line (CLI beats `.env.local`); this silently faked a "real-backend" pass once (tell-tales: ~0.2 cosine scores, bag-of-words misses like "valves" ≠ "valve", an empty live index).
- Still-standing warts: `.env.local` has **two** `OPENAI_API_KEY` lines (a `"DEBUG"` placeholder above the real key — last-one-wins; delete the placeholder when convenient); one-off `tsx` scripts must live in the repo root (session scratchpads can't resolve `node_modules`); one dev server per project directory (a running `npm run dev` breaks `npm run test` — kill the printed PID).
