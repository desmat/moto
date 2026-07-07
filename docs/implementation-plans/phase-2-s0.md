# S0 — Phase 2 pre-flight

Run this before starting any Phase 2 story.

## Read the Phase 1 handover

`docs/handovers/phase-1-to-phase-2.md` (written as Phase 1's final step). Don't just read it — **verify it against the code**, since these plans cite Phase 1 surfaces by name:

- [ ] `services/ai.ts`: actual `extractFromImage` signature, `MODELS` const, how `MOCKS` is keyed — S7/S10/S11/S13 all extend this file.
- [ ] Upload call chain as shipped (`lib/upload.ts` → `/api/attachments/upload` → `/api/attachments`), the prefix rule as actually enforced after Phase 1's S0 decision, and the pathname idempotency behavior.
- [ ] Log-dialog attachment strip: the pieces S11's `service-log-dialog` reuses, and their real props.
- [ ] Seed/fixture/mock-knob state (`AI_MOCK`, `BLOB_MOCK`, `test/fixtures/`, memory seeds) and the test-isolation convention adopted in Phase 1's S0.
- [ ] The handover's deviations list: for each deviation, annotate the Phase 2 plan sections it invalidates. If the handover is missing or stale relative to the code, reconstruct the deltas from git history before starting.

## Review flags to resolve (raised against these plans — fix the plans first)

1. **S7 `deleteByDocument` mechanism doesn't exist as described.** "Query ids by filter then delete" isn't available — Upstash Vector queries require a query vector, and delete-by-metadata-filter is paid-tier. The plan's own id scheme (`{documentId}:{chunkIndex}`) enables the right answer: delete by id prefix (`index.delete({ prefix: \`${documentId}:\` })`), all tiers. Keep the ownership check in the caller (prefix delete ignores metadata). Correct the S7 plan.
2. **One-confirmed-schedule invariant has unsanctioned entrances (S10).** Swap semantics live only in `confirmSchedule`, but the review UI confirms "via PUT status" and Phase 3's S14 fixtures will POST already-confirmed schedules — both bypass the swap, allowing two confirmed schedules per vehicle. Decide the sanctioned path (PUT status-flips delegate to `confirmSchedule`, or a dedicated confirm endpoint; POSTs arriving `confirmed` rejected or routed through the swap), write it into the S10 plan, and record it for the Phase 3 handover — S14's spec depends on it.
3. **S11/S12 wording conflict on non-service logs with `items[]`.** S11 calls hostile/hand-added structured fields on a journal log "stored-but-inert"; S12 then makes *every* log with `items[]` update `vehicle.components` — no longer inert. Decide whether the components update is restricted to `service`-type logs, and align both plans.
4. **S13 proposal ordering hazard.** The proposal schema permits backdated `mileage`-type logs, whose overwrite-always semantics can clobber current mileage depending on the sequential-POST order at confirm time. Constrain the proposal to one current-mileage log posted last (or add an equivalent guard) in the S13 plan.
5. **Phase-doc sizing table mismatch.** The table says S13 depends only on S1; the S13 plan (correctly) hard-requires S11's `Log` fields. Fix the table in `phase-2.md`.

## Output

The S7/S10/S11/S12/S13 plan files and `phase-2.md` corrected per the above, handover verified (deviations annotated into affected plans), baseline suite green. Then start S7.
