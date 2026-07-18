# S14 — Maintenance status engine (`services/maintenance.ts`)

Story: [phase-3.md](../phase-3.md) § S14. Depends on S10 (confirmed schedules) + S11 (structured log items). Unblocks S16/S17/S18. The core rule: **AI at write time, never at read time** — the engine itself is a pure function over stored data.

## Design

- **Pure core, thin routes.** `computeMaintenanceStatus(...)` takes everything as arguments (including `now`) and touches no store — the routes assemble inputs; tests hit the routes (no unit runner exists) but the determinism lives in one function.
- **Client-safe split (S0 flag 1)**: the pure pieces (`computeMaintenanceStatus`, S16's ranking helper, the threshold consts) live in **`lib/maintenance.ts`**, which imports nothing store-touching — S16's card and S17's table import from there. `services/maintenance.ts` holds only the store-touching assembly (`getVehicleMaintenance`); client components must never import it (a `services/*` import pulls `createStore({ debug: true })` module-scope construction into the client bundle).
- **Matching is key equality.** A log "counts" for a schedule item when `log.items[].key` (S11 receipts, S13 seeds) or `log.scheduleKeys[]` (new — see classifier) contains the item's `key`. `lastDone` = the newest such log by `date` (YYYYMMDD compares lexically), its `mileage` if present.
- **Due math**: `nextDue.km = lastDone.mileage + intervalKm`; `nextDue.date = lastDone.date + intervalMonths` (moment); when both, **earlier wins**. Never done: km-based → `firstAtKm` (else due-by-km unknowable); months-based with no history → `unknown`. Current position = `vehicle.mileage` (last *actual* reading — deliberately conservative; S15's projection converts future km to dates for display but never declares something overdue on projected kilometers).
- **Status**: `overdue` (past km or date), `upcoming` (within `UPCOMING_KM_FRACTION = 0.1` of the interval or `UPCOMING_DAYS = 30`, whichever is sooner), `ok`, `unknown`. The two thresholds are exported consts, one place.
- **Write-time classifier**: on `saveLog` of journal/custom-type logs (not service/mileage), when the vehicle has a confirmed schedule, one `chatJSON` call (S13's function) maps the entry text against that schedule's keys → `scheduleKeys?: string[]` stored on the log. Wrapped in try/catch — **classification failure never fails a save**; skipped entirely when there's no confirmed schedule. `AI_MOCK` classifier: deterministic keyword match (a key is returned when a distinctive word of it appears in the entry — "lubed chain" → `chain`), which makes seeded-store dev and specs behave sensibly.
- **Backfill** for pre-existing logs: an uncomment-to-run block in `services/admin.ts` (gated by `ADMIN_CONFIRM` like everything there) that runs the same classifier over a user's unkeyed journal/custom logs, idempotent (skips logs that already have `scheduleKeys`).

## Files

- `types/Maintenance.ts` (types only — computed, not a stored entity, so no `Options`/store touchpoints):
  ```ts
  export type MaintenanceItemStatus = {
    item: ScheduleItem;
    lastDone?: { date: string, mileage?: number, logId: string };
    nextDue: { km?: number, date?: string, estimated?: boolean };  // `estimated` date via S15
    status: "overdue" | "upcoming" | "ok" | "unknown";
    overdueByKm?: number; overdueByDays?: number;                  // for S16's severity ranking
  };
  export type VehicleMaintenance = {
    vehicleId: string;
    scheduleId?: string;               // absent → "no schedule" (distinct, not an error)
    lastReading?: { mileage: number, date: string };
    items: MaintenanceItemStatus[];
  };
  ```
- `types/Log.ts`: add `scheduleKeys?: string[]` (+ `fieldDisplayOrder`).
- `lib/maintenance.ts`: `computeMaintenanceStatus({ schedule, logs, vehicle, now })` (pure, exported) + `UPCOMING_KM_FRACTION`/`UPCOMING_DAYS` consts. **Client-safe: no `services/*` imports** (types + `lib/` + moment only).
- `services/maintenance.ts`: `getVehicleMaintenance(vehicleId, userId)` (fetches confirmed schedule via `services/schedules.ts`, logs via `services/logs.ts`, assembles, calls the lib's compute; S15 will thread projection in here).
- `services/logs.ts`: classifier call in `saveLog` per Design (after the existing post-save block; needs the vehicle's confirmed schedule — fetch via `services/schedules.ts`, reusing the already-fetched vehicle).
- `services/ai.ts`: keyword-match mock for schema `logClassifier`.
- `services/admin.ts`: backfill block.
- `app/api/vehicles/[id]/maintenance/route.ts`: GET, standard preamble (copy vehicles `[id]` GET), returns `VehicleMaintenance`.
- `app/api/maintenance/route.ts`: GET, all of the caller's vehicles → `{ vehicles: VehicleMaintenance[] }` (S16's single fetch).
- `test/api/maintenance.spec.ts`: build fixtures through the API (vehicle → POST `/api/schedules` with a hand-entered `source: "user"` confirmed schedule — S10's POST exists for exactly this → service/mileage logs), then assert the matrix: km-only interval, months-only, both-earlier-wins, never-done + `firstAtKm`, never-done months-only → `unknown`, overdue/upcoming boundary values (pin `date`s in fixtures; the engine takes `now` from the request date — accept ±1-day tolerance or pass explicit dates near boundaries generously). Plus: custom log "lubed the chain" → keyword-mock classifier → chain item's `lastDone` points at it; no-schedule vehicle → `scheduleId` absent with empty items.

## Steps

1. Types → 2. pure engine → 3. routes → 4. classifier in `saveLog` + mock → 5. admin backfill → 6. spec → 7. lint/build/test.
8. Manual: against real data (a confirmed schedule from S10 + seeded/real logs), eyeball `GET /api/vehicles/[id]/maintenance` for sanity.

## Out of scope

Projection/estimated dates (S15 threads into this engine next), any UI (S16/S17), classifier-correction UI (JSON editor suffices; noted deferred), generic schedules for manual-less vehicles.
