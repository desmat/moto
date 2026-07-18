# S12 — Vehicle current-state (`vehicle.components`)

Story: [phase-2.md](../phase-2.md) § S12. Depends on S11 (structured `items` on logs). Resolves the roadmap's open decision (b): **sub-field on `Vehicle`**, mirroring the existing `saveLog` → `vehicle.mileage` sync — see the phase doc for the full rationale (snapshot not history; rebuildable; no fourth entity's ceremony).

## Design

- **Written where mileage is written**: the same post-save block in `services/logs.ts` that S11 just refactored. One vehicle fetch, one vehicle update, both concerns.
- **Update rules**:
  - **Only `service`-type logs update `components`** (S0 review decision, aligning with S11: hostile/hand-added `items[]` on a journal log stays stored-but-inert — an extraction flow always produces `type: "service"`, so nothing legitimate is lost, and the JSON editor can't turn a diary entry into a state mutation). Every item on a saved *service* log with `items[]` touches `components[item.key]` — *unless* the existing state entry is **newer** (`existing.date > log.date`): backdated receipts (and S13's seeded history) must never overwrite fresher state. Compare on `date` (YYYYMMDD string compare works), tiebreak by taking the write (same-day re-log wins).
  - `action` ∈ `replace`-like (`replace`, plus treat `other` with no prior entry as install) sets `detail` (from `item.note || item.name` — the receipt's "Michelin Anakee Adventure" lives in the note/name); every action updates `action`/`date`/`mileage`/`logId` ("last touched").
- **Not derived-on-read, and deletion doesn't cascade**: deleting the source log leaves the snapshot standing (phase-doc AC; state is "what's on the bike", not an index of logs). A rebuild-from-logs admin script is the recovery tool and belongs in this story (cheap here, annoying later): `npm run admin` one-off gated by `ADMIN_CONFIRM`, replaying a user's logs oldest-first through the same update function.
- **Hand-editable by design** via the vehicle JSON editor (identity fields stay pinned; `components` is just data).

## Files

### Modify `types/Vehicle.ts`

```ts
export type VehicleComponentState = {
  name: string;        // display name from the last touching item
  detail?: string;     // what's installed — set by replace-type actions only
  action: string;      // last action performed
  date: string;        // YYYYMMDD of that log
  mileage?: number;
  logId: string;
};
// on Vehicle: components?: Record<string, VehicleComponentState>;  // keyed by canonical item key
```
Append `components` to `fieldDisplayOrder` (after `modifications`).

### Modify `services/logs.ts`

Extend the S11-refactored post-save block: when `saved.items?.length` and the (already-fetched, ownership-checked) vehicle exists, fold each item into `components` per the update rules — implemented as an exported pure function so the admin rebuild and tests reuse it:

```ts
export function applyItemsToComponents(components, items, log): Record<string, VehicleComponentState>
```
Single `store.vehicles.update` carries mileage + components together.

### Modify `services/admin.ts`

Add a commented-out one-off (matching the file's existing style of uncomment-to-run blocks, per AGENTS.md's description): `rebuildComponents(userId)` — fetch the user's logs, sort by `date` ascending, reduce through `applyItemsToComponents`, write each vehicle.

### Create `components/vehicle-components-card.tsx`

"Current setup" card on `/vehicles/[id]` (alongside S8's documents section, above the `JsonEditor`): one row per `components` entry — name, `detail` (muted "—" when unset), "last: ⟨action⟩ · ⟨date⟩ · ⟨mileage⟩ km", the date linking to `/logs/⟨logId⟩` (row renders fine if that log was deleted — plain 404 on click is acceptable). Rows sorted by `date` desc. Card hidden when `components` is empty.

## Tests

`test/api/components.spec.ts` (extends the S11 scenarios; memory store):
1. Service log "replaced front tire — Michelin Anakee Adventure" `mileage: 18300` → `vehicle.components["front-tire"]` has `detail` containing "Michelin", correct date/mileage/logId.
2. Later "inspect front-tire" log → `date`/`action` update, `detail` unchanged.
3. *Backdated* replace of the same key (older `date`) → state unchanged (newer-wins rule).
4. Two logs with `front-tire` key from different phrasings (extraction-time canonicalization simulated by using the same key) → single entry.
5. Deleting the source log → `components` untouched.
6. A `journal`-type log carrying `items[]` → `components` untouched (service-only rule).

e2e: seeded service logs (S11's memory-seed upgrade) → vehicle page shows the "Current setup" card with `front-tire`/`rear-tire`/`engine-oil` rows out of the box; date link opens the seeded log.

## Steps

1. Types → 2. `applyItemsToComponents` + `saveLog` wiring → 3. admin rebuild block → 4. card component + vehicle-page mount → 5. specs → 6. lint/build/test; manual: run a real receipt through S11's dialog and watch the card update.

## Out of scope

Consuming state for due-computation (Phase 3 S14 reads logs, not this snapshot — this card is for humans), component taxonomy management UI, uninstall/removal semantics, per-component history view (that's just a filtered log list — Phase 4 search).
