# S0 — Phase 3 pre-flight

Run this before starting any Phase 3 story.

## Read the Phase 2 handover

`docs/handovers/phase-2-to-phase-3.md` (written as Phase 2's final step). Verify against the code, not just the prose — these plans consume Phase 2's data model directly:

- [ ] `MaintenanceSchedule`/`ScheduleItem` as shipped, and the sanctioned confirm path decided in Phase 2's S0 — S14's fixtures POST confirmed schedules and must use it.
- [ ] `CANONICAL_COMPONENT_KEYS` location and final vocabulary (the classifier and every prompt reference it).
- [ ] `saveLog`'s post-save block structure (mileage sync + monotonic rule + components update) — S14 appends its classifier to this exact block.
- [ ] `searchDocuments` signature/result shape (S18's tool) and the vector tenant-isolation invariant.
- [ ] `extracted-rows.tsx` / `service-log-dialog.tsx` real props — S16/S17 add `defaultItems`/`defaultVehicleId`.
- [ ] Memory-seed contents after Phase 2's re-typing (dates, mileages, which logs carry `items`/keys) — S16's seed arithmetic is tuned against these exact numbers.
- [ ] Deviations list → annotate the Phase 3 plan sections each one invalidates. Missing/stale handover → reconstruct from git history first.

## Review flags to resolve (raised against these plans — fix the plans first)

1. **Client components must not import store-touching service modules (S14/S16/S17).** The ranking helper is planned into `services/maintenance.ts`, which also hosts `getVehicleMaintenance` and thus imports services that run `createStore({ debug: true })` at module scope — `next-due-card.tsx`/`maintenance-table.tsx` importing the helper pulls store construction into the client bundle. Split: pure pieces (`computeMaintenanceStatus`, ranking, threshold consts) in a client-safe module (`lib/maintenance.ts` or alongside `types/Maintenance.ts`); `services/maintenance.ts` keeps the store-touching assembly. Update all three plans.
2. **S16's promised "seeded overdue chain" can't happen with the current seeds.** The seeded chain logs are 0 and 5 days old, and seeded records bypass `saveLog`, so they carry no `scheduleKeys`/`items` — chain computes as `unknown` (no keys) or `ok` (keys, lastDone today), never `overdue`. The seed work must stamp `scheduleKeys`/`items` directly onto seed logs *and* date the newest chain log more than a month back; redo the seed arithmetic comment to cover keys and dates, and recheck S17's e2e and S18's canned answer, which assert against the same fixture.
3. **Seed-exact e2e vs. the parallel shared store.** Confirm the test-isolation convention from Phase 1's S0 held through Phase 2, and that S16/S17/S18's seed-asserting specs can't race any spec mutating the same seeded vehicle (Phase 1's S6 e2e originally overwrote its mileage — verify that was resolved as planned).
4. **S15 slope guard.** `estimateDateForMileage` at slope ≤ 0 must return `undefined` explicitly (no divide-by-zero/negative extrapolation) — the plan implies it via the `low` confidence rule but never states it; make it an AC.

## Output

The S14–S18 plan files corrected per the above, handover verified (deviations annotated), baseline suite green. Then start S14 (S15 lands on top of it).
