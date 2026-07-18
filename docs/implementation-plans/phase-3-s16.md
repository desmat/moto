# S16 — "Next due" on the dashboard

Story: [phase-3.md](../phase-3.md) § S16. Depends on S14 + S15 (the `/api/maintenance` payload) and S11 (the service-log dialog it opens). Replaces the placeholder 🤖 line at the top of `app/page.tsx` (`app/page.tsx:71-75`) — the roadmap's "placeholder optimism, now earned" moment.

## Design

- **One fetch, one hook**: `hooks/use-maintenance.tsx` → `GET /api/maintenance` (all vehicles, S14). Modeled on `use-attachment` (no localStorage layer — statuses are cheap to recompute and staleness is exactly what this feature fights). Query key `["maintenance"]`.
- **Invalidation is the freshness mechanism**: `use-log.tsx`'s `add`/`save`/`delete` `onSuccess` handlers additionally invalidate `["maintenance"]` (they already invalidate `["vehicles"]` for the same reason — extend the existing pattern). That's what makes "log it → item clears" work without a refresh.
- **Severity ranking across vehicles**: overdue first (by `max(overdueByKm / intervalKm, overdueByDays / 30)` descending — normalize so a 500-km-overdue oil change outranks a 2-day-overdue inspection), then upcoming (soonest `nextDue.date`/smallest km gap). Top 3 shown; ranking helper exported from **`lib/maintenance.ts`** (S0 flag 1: client components must not import `services/maintenance.ts` — it pulls store construction into the client bundle) so S17 sorts identically.
- **Funnels are additive lines, not a garage-wide cascade** (S0 pre-flight correction: a "first applicable state across the garage" card is broken on both axes — the seeded GSX-R is permanently schedule-less, so state 1 would mask the ranked list forever, and parallel specs constantly add vehicles, so no garage-wide state is e2e-assertable): the ranked list renders whenever items are due; **below it**, one funnel line per applicable vehicle —
  - no confirmed schedule → "Upload the owner's manual for ⟨name⟩ and I'll track what's due" → link to `/vehicles/[id]` (S8's documents section);
  - has a schedule but `lastReading` stale (> `STALE_DAYS`) or projection confidence `none` → "When did you last check the odometer?" → opens `log-entry-dialog` in mileage mode (S6's snap flow included).
  Nothing due and no funnels → "All caught up ✓ — next up: ⟨soonest ok-item⟩".
- **Wording carries confidence** (S15): `estimated` dates render as "~3 weeks"; no date → "in ~800 km".

## Files

### Create `hooks/use-maintenance.tsx`

`useMaintenance()` → `{ loaded, vehicles: VehicleMaintenance[] }` per Design.

### Create `components/next-due-card.tsx`

Replaces the placeholder block in `app/page.tsx`. Keeps the 🤖 visual identity (same emoji + layout so the dashboard doesn't rearrange). Each item row: status icon (⚠️ overdue / 🔔 upcoming), "⟨item name⟩ ⟨overdue by X km | due in ~Y⟩", muted vehicle name — the whole row a button opening `service-log-dialog` (S11) with new props `defaultItems={[{ key, name, action }]}` and `defaultVehicleId`, followed by "(more)" → `/vehicles/[id]/schedule` (S17; when items span multiple vehicles, "(more)" goes to the top item's vehicle). Loading state: keep the placeholder sentence as skeleton text.

### Modify

- `app/page.tsx`: swap the placeholder `<div>` for `<NextDueCard />`; pass nothing (the card owns its hooks). The Record buttons/charts/entries below are untouched.
- `hooks/use-log.tsx`: add `queryClient.invalidateQueries({ queryKey: ["maintenance"] })` to the three mutations' `onSuccess`.
- `components/service-log-dialog.tsx` (S11): accept `defaultItems` (pre-populates the `extracted-rows` table; user still edits/saves normally).
- `services/stores/memory.ts`: seed a **confirmed `MaintenanceSchedule`** for the CB500X (`source: "user"`, items incl. `engine-oil` `intervalKm: 6000` and `chain` `intervalKm: 1000`/`intervalMonths: 1`) **plus the seed-log rework this requires (S0 flag 2)** — seeds bypass `saveLog`, so the classifier never keys them and the current chain logs (0 and 5 days old, key-less) would compute `unknown`, never overdue:
  - stamp `scheduleKeys: ["chain"]` directly onto the "chain adjustment" custom log and **re-date it from 5 to ~40 days ago** → chain (1-month interval) computes overdue by ~10 days;
  - the day-0 "chain cleaned" journal stays **unkeyed on purpose** (inert to the engine — realistic pre-classifier history; keying it would clear the overdue);
  - engine-oil computes `ok` from the already-keyed items on the day-3 service log (18,250 km vs. a 6,000 km interval).
  Keep the full arithmetic — keys, dates, mileages — in a comment next to the seed. This seed makes `STORE_TYPE=memory` dev/demo show a real overdue item out of the box and anchors S18's canned answer text; **e2e specs do not assert against it** (see Tests).

## Tests

- e2e (`test/e2e/`): **both specs create their own fixtures via the API** (S0 flag 3 — the isolation convention: a spec that logs against the seeded chain item clears it under other specs' feet, and no spec through Phase 2 references a seeded id; keep it that way). Spec 1: create vehicle → POST schedule (`source: "user"`) → confirm via `PUT` with `status: "confirmed"` (the sanctioned path — never POST `"confirmed"` directly) → POST a backdated keyed service log making one item overdue → dashboard shows that item's line (match on the spec's unique vehicle name) → click → dialog pre-filled with item and vehicle → save → that line leaves the card without reload (react-query invalidation). Spec 2: fresh vehicle, no schedule → card shows the upload-manual funnel line naming that vehicle (lines from seeds/parallel specs will coexist — assert the line, never the card's entirety).
- `test/api`: none new (S14's spec covers the payload; ranking helper asserted through item order in a two-item overdue fixture added to `maintenance.spec.ts`).

## Steps

1. Hook → 2. ranking helper in `lib/maintenance.ts` → 3. card component → 4. `app/page.tsx` swap + `use-log` invalidations + dialog `defaultItems` → 5. memory seed (+ comment math) → 6. specs → 7. lint/build/test; manual on phone width (the card is the first thing a rider sees — check it doesn't push Record below the fold).

## Out of scope

The full table (S17), notifications on due items (Phase 4), per-user threshold tuning, dismissing/snoozing items, multi-vehicle "(more)" aggregation page.
