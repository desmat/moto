# S10 — Owner's manual → `MaintenanceSchedule` entity

Story: [phase-2.md](../phase-2.md) § S10. Depends on S8/S9 (documents) + S1 (AI layer). Unblocks Phase 3 S14–S17. The biggest story in the phase; the reusable "review extracted rows" component built here serves S11 and S13 too.

## Design

- **Proposed vs. confirmed as a status field**, not separate entities: `status: "proposed" | "confirmed"` on `MaintenanceSchedule`. Extraction creates a `proposed` record; the user's review/confirm flips it — and deletes any previously-confirmed schedule for that vehicle at that moment (one confirmed schedule per vehicle; the old one isn't versioned — deferred). A dangling proposal never affects Phase 3 computations (they read confirmed only).
- **`confirmSchedule(id, user)` is the ONLY code path that sets `confirmed`** (S0 review decision — the invariant previously had unsanctioned entrances). Concretely: (a) the PUT `[id]` route, on a body whose `status` is `"confirmed"` while the stored record isn't, first applies the other edits (`items`) as a normal update *keeping the stored status*, then delegates to `confirmSchedule` — it never writes `status: "confirmed"` itself; (b) POST bodies arriving with `status: "confirmed"` (Phase 3 S14 test fixtures do this) are created as `proposed` then immediately passed through `confirmSchedule`, so the swap-delete of any prior confirmed schedule always runs; (c) confirming an already-confirmed record is a no-op update (idempotent). Demoting `confirmed` → `proposed` via PUT is a plain update (harmless — it only ever *reduces* the confirmed count). **Record this in the Phase 2→3 handover**: S14's fixtures must POST schedules with `status: "confirmed"` and rely on entrance (b).
- **Extraction reads the whole PDF via OpenAI file input** — the one deliberate full-document AI spend (schedule tables in scanned manuals mangle as raw text). New `services/ai.ts` function `extractFromFile` (upload to OpenAI Files API → chat/responses call with the file content part + JSON-schema response → delete the uploaded file in a `finally`). `AI_MOCK` → canned `manualSchedule` entry in **`test/fixtures/ai-mocks.json`** (the Phase 1 handover's registry — there is no `MOCKS` const) with a handful of plausible items: engine-oil, oil-filter, chain, valve-clearance, brake-fluid….
- **Schema leads with a boolean gate** (Phase 1's highest-leverage finding, mandatory for every new extraction schema): first field `schedule_table_found: boolean` — gpt-4o confidently fabricates plausible structured output for unreadable input, prompt-only "don't guess" does not stop it, and a leading commit-to-visibility field in the strict schema does (see `services/odometer.ts` for the working pattern + prompt framing). `false` → empty `items`, route surfaces "no schedule found" rather than inventing one.
- **Canonical `key` is minted at extraction time** (prompt instructs kebab-case canonical component keys and gives the preferred vocabulary: `engine-oil`, `oil-filter`, `air-filter`, `chain`, `front-tire`, `rear-tire`, `brake-fluid`, `brake-pads-front`, `coolant`, `spark-plugs`, `valve-clearance`, …). S11's receipt prompt shares the same vocabulary const so keys converge — export `CANONICAL_COMPONENT_KEYS` from `types/MaintenanceSchedule.ts`.
- **Units normalized to km + months** in the schema; the manual's original phrasing preserved per-item in `notes`.

## Files

### Create `types/MaintenanceSchedule.ts`

```ts
export type ScheduleItem = {
  key: string;            // canonical slug (see CANONICAL_COMPONENT_KEYS)
  name: string;           // display name as the manual phrases it
  action: "replace" | "inspect" | "adjust" | "lubricate" | "clean" | "other";
  intervalKm?: number;
  intervalMonths?: number;
  firstAtKm?: number;     // break-in/first-service items
  notes?: string;
};
export type MaintenanceSchedule = {
  id, createdAt/By, updatedAt/By, deletedAt?,
  userId: string; vehicleId: string;
  documentId?: string;               // absent for future "generic"/hand-entered schedules
  source: "manual" | "generic" | "user";
  status: "proposed" | "confirmed";
  items: ScheduleItem[];
};
export const MaintenanceScheduleOptions = {
  lookups: { user: "userId", vehicle: "vehicleId" },
  hardDelete: true, fieldDisplayOrder: [...],
};
export const CANONICAL_COMPONENT_KEYS = [...];
```

### Touchpoints

Standard six (S2 template): `config.ts` key `MotoMaintenanceSchedule`, both backends (no seed), `services/schedules.ts` CRUD + `confirmSchedule(id, user)` (set `confirmed`, delete the vehicle's prior confirmed record — service-layer so every caller gets the swap semantics), `app/api/schedules/route.ts` + `[id]/route.ts` (GET `?vehicle=`; PUT pins identity + `vehicleId`/`documentId`/`source`, so edits touch `items`/`status` only; POST exists for future hand-entered schedules), `hooks/use-schedule.tsx`.

### Modify `services/ai.ts`

`extractFromFile({ buffer, filename, prompt, schemaName, schema })` per Design. Add the `manualSchedule` entry to `test/fixtures/ai-mocks.json`.

### Create `app/api/documents/[id]/schedule/route.ts`

POST: auth/404/ownership; document must be `type: "manual"` (400 otherwise); fetch the PDF from the attachment; `extractFromFile` with the schedule schema/prompt; create a `proposed` `MaintenanceSchedule` (`documentId`, `source: "manual"`); return it. `maxDuration = 300`, `trackEvent("schedule-extracted", ...)`. Client triggers it after ingest reaches `ready` (chained in `components/vehicle-documents.tsx` for manuals).

### Create `components/extracted-rows.tsx` (the reusable review table)

Generic controlled component: `columns` (label, field, input type: text/number/select), `rows`, `onChange` — renders editable `Input`s per cell, per-row delete, add-row button. Deliberately dumb (no validation logic beyond numeric coercion); S10 (schedule items), S11 (receipt line items), and S13 (proposed logs) all parameterize it.

### Create `components/schedule-review.tsx`

Mounted on the vehicle detail page (with `vehicle-documents.tsx`): when a `proposed` schedule exists for the vehicle → banner "Review the maintenance schedule extracted from ⟨title⟩" + `extracted-rows` table of items + Confirm / Discard buttons (PUT status / DELETE). When a `confirmed` schedule exists → a collapsed summary line ("Maintenance schedule: N items from ⟨title⟩" + Edit, reopening the same table; saving keeps `confirmed`).

## Tests

`test/api/schedules.spec.ts` (mocks + memory store): manual-type document (S9 fixture) → POST `.../schedule` → `proposed` record with the canned items, `key`s from the canonical list; PUT edit an item + confirm → `confirmed`; extract again → new `proposed` exists *alongside* the confirmed; confirm it → exactly one confirmed remains for the vehicle; non-manual document → 400; hostile PUT can't change `vehicleId`/`source`.

## Steps

1. Types + touchpoints → 2. `extractFromFile` + mock → 3. extraction route → 4. `extracted-rows.tsx` → 5. `schedule-review.tsx` + vehicle-page mounting + auto-trigger after manual ingest → 6. spec → 7. lint/build/test.
8. Manual with a real manual PDF (CB500X or similar): eyeball extracted items against the printed schedule table — this is the phase AC's "plausible schedule" check; tune the prompt here, it's the highest-leverage prompt in the app.

## Out of scope

Schedule *consumption* (Phase 3 S14), generic no-manual schedules (`source: "generic"` reserved), schedule versioning/history, mileage-unit preferences (km assumed, per app convention so far), multi-manual merge.
