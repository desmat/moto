# S16 — "Next due" on the dashboard

Story: [phase-3.md](../phase-3.md) § S16. Depends on S14 + S15 (the `/api/maintenance` payload) and S11 (the service-log dialog it opens). Replaces the placeholder 🤖 line at the top of `app/page.tsx` (`app/page.tsx:71-75`) — the roadmap's "placeholder optimism, now earned" moment.

## Design

- **One fetch, one hook**: `hooks/use-maintenance.tsx` → `GET /api/maintenance` (all vehicles, S14). Modeled on `use-attachment` (no localStorage layer — statuses are cheap to recompute and staleness is exactly what this feature fights). Query key `["maintenance"]`.
- **Invalidation is the freshness mechanism**: `use-log.tsx`'s `add`/`save`/`delete` `onSuccess` handlers additionally invalidate `["maintenance"]` (they already invalidate `["vehicles"]` for the same reason — extend the existing pattern). That's what makes "log it → item clears" work without a refresh.
- **Severity ranking across vehicles**: overdue first (by `max(overdueByKm / intervalKm, overdueByDays / 30)` descending — normalize so a 500-km-overdue oil change outranks a 2-day-overdue inspection), then upcoming (soonest `nextDue.date`/smallest km gap). Top 3 shown; ranking helper exported from `services/maintenance.ts` so S17 sorts identically.
- **Empty states are the funnel, per vehicle**: the card body picks the first applicable across the user's garage —
  1. some vehicle lacks a confirmed schedule → "Upload the owner's manual for ⟨name⟩ and I'll track what's due" → link to `/vehicles/[id]` (S8's documents section);
  2. schedules exist but `lastReading` is stale (> `STALE_DAYS`) or projection confidence `none` → "When did you last check the odometer?" → opens `log-entry-dialog` in mileage mode (S6's snap flow included);
  3. items exist → the ranked list;
  4. nothing due, nothing missing → "All caught up ✓ — next up: ⟨soonest ok-item⟩".
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
- `services/stores/memory.ts`: seed a **confirmed `MaintenanceSchedule`** for the CB500X (`source: "user"`, items incl. `engine-oil` `intervalKm: 6000` and `chain` `intervalKm: 1000`/`intervalMonths: 1`) — tuned against the existing seeds (oil change at ~18,000 3 days ago; mileage 18,250) so the seeded dashboard shows **one overdue item (chain lube by date) and one ok** deterministically. This seed is what makes S16/S17 e2e and `STORE_TYPE=memory` dev work out of the box; keep the arithmetic in a comment next to it.

## Tests

- e2e (`test/e2e/`): seeded store → dashboard shows the ⚠️/🔔 line for the seeded overdue item; click it → dialog pre-filled with the item and vehicle → save → card refreshes and the item is gone (react-query invalidation, no reload). Second spec: fresh vehicle created via API (no schedule) → card shows the upload-manual funnel line naming that vehicle.
- `test/api`: none new (S14's spec covers the payload; ranking helper asserted through item order in a two-item overdue fixture added to `maintenance.spec.ts`).

## Steps

1. Hook → 2. ranking helper in `services/maintenance.ts` → 3. card component → 4. `app/page.tsx` swap + `use-log` invalidations + dialog `defaultItems` → 5. memory seed (+ comment math) → 6. specs → 7. lint/build/test; manual on phone width (the card is the first thing a rider sees — check it doesn't push Record below the fold).

## Out of scope

The full table (S17), notifications on due items (Phase 4), per-user threshold tuning, dismissing/snoozing items, multi-vehicle "(more)" aggregation page.
