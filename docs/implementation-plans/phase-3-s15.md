# S15 — Mileage projection

Story: [phase-3.md](../phase-3.md) § S15. Data comes from S6/S11 logs; integrates into S14's engine (land S14 first). Small, pure, and deliberately humble about its own accuracy.

## Design

- **Readings, not logs**: an odometer observation is any log with a mileage value — `mileage`-type logs (`parseFloat(entry)`) and `service` logs with a `mileage` field — reduced to `{ date, mileage }[]`, deduped per day (latest wins), sorted ascending. Non-monotonic history (corrections) is tolerated: the fit uses what it's given.
- **Fit**: simple least-squares slope (km/day) over the trailing window — last 90 days of readings, minimum 2, falling back to the last 6 readings if the window has <2. No seasonality, no fanciness; the confidence field is where honesty lives.
- **Confidence is part of every return value**: `"none"` (<2 readings) — no projection at all; `"low"` (readings span < 14 days, newest reading > 60 days old, or slope ≤ 0); `"high"` otherwise. Consumers must branch on it (S14 omits estimated dates at `none`; renders "~" phrasing at `low`).
- **Clamp**: projections never fall below the newest actual reading; `estimateDateForMileage` of an already-passed target returns "now".
- **Slope guard (S0 flag 4, an AC)**: `estimateDateForMileage` with slope ≤ 0 (or confidence `none`) returns `undefined` explicitly — no divide-by-zero, no negative extrapolation ever reaches a consumer. (`low` confidence already flags slope ≤ 0; this makes the date function itself safe regardless of whether the caller checked.)
- **Never stored, always computed** — and *not* used to declare items overdue (S14's conservative rule): projection only turns future km into approximate dates.

## Files

### Create `lib/mileage.ts`

**`lib/`, not `services/` (S0 flag 1)**: the module is entirely pure and S16's card reads `STALE_DAYS` (and projection confidence) from client code — same client-safe rule as `lib/maintenance.ts`: no `services/*` imports.

```ts
export type OdometerReading = { date: string /* YYYYMMDD */, mileage: number };
export type Projection = { kmPerDay: number, lastReading: OdometerReading,
                           confidence: "high" | "low" | "none" };

export function extractReadings(logs: Log[]): OdometerReading[]          // pure
export function fitProjection(readings: OdometerReading[], now: string): Projection  // pure
export function projectMileage(p: Projection, atDate: string): number | undefined
export function estimateDateForMileage(p: Projection, targetKm: number): string | undefined
```

All pure (module has no store access — the maintenance service already holds the logs). Window/threshold consts (`WINDOW_DAYS = 90`, `MIN_SPAN_DAYS = 14`, `STALE_DAYS = 60`) exported from here.

### Modify `services/maintenance.ts` + `lib/maintenance.ts` (S14)

`getVehicleMaintenance` (services) builds the projection from the logs it already fetched and passes it into `computeMaintenanceStatus` (lib), which fills `nextDue.date` for km-based items when it's missing or later than the km-derived one: `estimateDateForMileage(projection, nextDue.km)`, marked `estimated: true`; skipped at confidence `none`. `VehicleMaintenance` gains `projection?: { kmPerDay, confidence }` (S16's stale-mileage empty state reads `lastReading` + this).

## Tests

Extend `test/api/maintenance.spec.ts` (the projection is exercised through the maintenance route — matching the no-unit-runner reality; the functions stay pure for easy future extraction):

- **Steady rider**: readings 30/20/10 days ago at even spacing → km-based item's `nextDue.date` present, `estimated: true`, and lands ~where arithmetic says.
- **Single reading** → confidence `none`: km-based items have `nextDue.km` but no `date`.
- **Bursty/short span**: two readings 3 days apart → `low` (date present; consumers soften phrasing — asserted here only as the confidence value on the payload).
- **Stale**: newest reading fixture-dated 90 days back → `low`.
- **Clamp**: target km below the last reading → estimated date ≈ today, never in the past.
- **Slope ≤ 0**: readings that decrease (or are flat) over the window → `estimateDateForMileage` returns `undefined` (asserted as km-based items carrying `nextDue.km` but no `date`), confidence `low`.
- **Backdated correction**: a service log with lower mileage *after* a higher mileage-type reading → readings sort by date, fit doesn't crash, projection floor = newest-by-date reading.

## Steps

1. `lib/mileage.ts` → 2. thread into S14's service + type → 3. spec fixtures/cases → 4. lint/build/test.
5. Manual: with real logged history, check `kmPerDay` against your own sense of your riding cadence — the one true integration test for a projection.

## Out of scope

Riding-season/seasonality modeling, per-vehicle manual km/day overrides (add if projections annoy real users), surfacing projection UI of its own (it only ever appears through S14's payloads), unit conversion.
