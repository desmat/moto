# S17 — Full maintenance schedule page

Story: [phase-3.md](../phase-3.md) § S17. Depends on S14 + S15; shares the ranking helper and dialog plumbing with S16 (land S16 first — this story is mostly composition). Route: `/vehicles/[id]/schedule`.

## Design

- **A per-vehicle subpage, not a nav item.** Reached from S16's "(more)" and the vehicle page's schedule summary line (S10). Sidebar `NavItems` unchanged.
- **Breadcrumbs come almost free**: `app-breadcrumbs.tsx` prefix-matches `pageNames`, so the new route already renders "Dashboard | Vehicles | schedule". The only change: add `"schedule"` to the `altPageName` capitalization list (currently `["edit"]`) so it renders "Schedule". No `pageNames` entry needed — note this in the AGENTS.md nav paragraph if it reads otherwise.
- **One data source**: `GET /api/vehicles/[id]/maintenance` (S14) has everything the table needs (items + status + lastDone + nextDue); `useSchedule({ vehicleId })` (S10) supplies title/source metadata for the header. New `useMaintenance({ vehicleId })` variant on S16's hook (same query key family, parameterized like `use-log`'s `{ id }` pattern).
- **Rows are actionable, unknowns are recoverable**:
  - Sorted by S16's shared ranking helper — imported from **`lib/maintenance.ts`**, never `services/maintenance.ts` (S0 flag 1: client components must not pull store-touching service modules into the bundle); `unknown` items grouped at the bottom under "No history yet".
  - Per-row "Log it" → `service-log-dialog` with `defaultItems` + `defaultVehicleId` (exactly S16's interaction).
  - Per-unknown-row "When did you last do this?" → the same dialog with the date field emphasized — a *backdated* entry (S11's dialog already has an editable date; no new mechanism, just copy that frames it as history-capture, not new work).

## Files

### Create `app/vehicles/[id]/schedule/page.tsx`

Client page following `app/vehicles/[id]/page.tsx`'s skeleton (`use(params)`, `decodeURIComponent`, `NotFound` when loaded-but-missing). Header: vehicle name (link back to `/vehicles/[id]`), "from ⟨document title⟩" when the confirmed schedule has a `documentId` (document title via `useDocument({ vehicleId })`), an Edit button opening S10's `schedule-review` table for the confirmed schedule. Body: the table.

### Create `components/maintenance-table.tsx`

Props: `items: MaintenanceItemStatus[]`, `vehicle`. Columns: status badge (colored dot + label — the styling vocabulary S16's card established), item (name + action), interval ("6,000 km / 12 mo"), last done (date + mileage, linking to `/logs/⟨logId⟩`), next due (km and/or date, "~" prefix when `estimated`), row action button. Mobile: the table is the widest thing in the app so far — wrap in `overflow-x-auto` *or* collapse to stacked cards under `md:`; decide at implementation by eyeballing both on a phone (acceptance is "usable at 390px", not a specific layout).

### Modify

- `components/app-breadcrumbs.tsx`: `["edit"]` → `["edit", "schedule"]`.
- `components/next-due-card.tsx` (S16): confirm "(more)" href points here.
- `components/schedule-review.tsx` (S10): the confirmed-schedule summary line links here too.
- `hooks/use-maintenance.tsx`: per-vehicle parameterization.

## Tests

- e2e (**own fixtures via the API, not the seeds — S0 flag 3**: "Log it" against `vehicle-smoketest` would clear the seeded overdue chain other surfaces rely on, and seed-asserting specs race parallel writers): create vehicle → POST schedule with three items (one to make overdue via a backdated keyed log, one ok via a recent keyed log, one — e.g. `valve-clearance` — with no log at all) → confirm via `PUT` `status: "confirmed"` (the sanctioned path) → navigate to `/vehicles/⟨id⟩/schedule` → all three render with correct badges; last-done link opens the spec's own log; "Log it" on the overdue row → dialog pre-filled → save → row flips out of overdue without reload; the no-log item renders in "No history yet" → "When did you last do this?" → backdated save → row acquires lastDone. (The seeded CB500X schedule remains the hands-on dev/demo surface — verify it by eye, not by spec.)
- `test/api`: none new (route consumes S14's tested endpoint).

## Steps

1. `useMaintenance({ vehicleId })` → 2. `maintenance-table.tsx` → 3. page + header wiring → 4. breadcrumbs tweak + inbound links (card, schedule summary) → 5. e2e (own fixtures per Tests) → 6. lint/build/test; manual at phone width per Design (seeded CB500X schedule is the eyeball surface).

## Out of scope

Editing schedule items inline in this table (Edit goes through S10's review component), history-per-item view, printable/export view (Phase 4), cross-vehicle aggregate schedule page.
