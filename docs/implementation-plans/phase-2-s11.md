# S11 — Receipt scan → structured service log

Story: [phase-2.md](../phase-2.md) § S11. Depends on S1 + S4 (attach flow); shares `extracted-rows.tsx` + `CANONICAL_COMPONENT_KEYS` with S10 (build S10's component first, or extract it here if S11 leads). Unblocks S12.

## Design

- **`Log` grows optional structured fields; nothing existing changes.** New built-in `LogTypeService = "service"` joins journal/mileage. All new fields optional, so every existing log remains valid and the JSON editor keeps working.
- **A dedicated dialog, not more modes in `log-entry-dialog.tsx`.** That component is deliberately tiny (one entry field + type); the service form is structurally different (vendor/date/mileage/line-items table/costs). New `components/service-log-dialog.tsx`, reusing the S4 attachment strip and the S10 review table. The dashboard gets a fourth Record button.
- **Scan is an accelerator, not a gate**: the form is fully usable with no photo and no AI; a receipt photo just pre-fills it (S6's pattern: auto-fire on image-ready, degrade to empty editable form on failure).
- **Vehicle-mileage side effect is monotonic for service logs** — a decision this plan makes explicitly: receipts are frequently *backdated* (S13 will seed months-old ones), and the existing overwrite-always rule would let an old receipt clobber a newer odometer reading. So in `saveLog`: mileage-type logs keep today's overwrite-always semantics; service logs update `vehicle.mileage` only when `log.mileage > vehicle.mileage`. Deliberate downward corrections remain possible via a mileage log. (S6's client-side "lower than current" confirm still applies in this dialog too.)

## Files

### Modify `types/Log.ts`

```ts
export type LogItem = { key: string, name: string,
  action: "replace" | "inspect" | "adjust" | "lubricate" | "clean" | "other",
  note?: string, cost?: number };
// on Log: items?: LogItem[]; mileage?: number; vendor?: string; totalCost?: number;
export const LogTypeService = "service";
```
Extend `fieldDisplayOrder`. (`lookups` unchanged — `type: "type"` already enables `find({ type: "service" })`.)

### Modify `services/logs.ts` (`saveLog`)

Refactor the existing mileage-sync block: fetch the vehicle once; compute the candidate reading (`type == mileage` → `parseFloat(entry)`, overwrite-always; `saved.mileage` present on other types → monotonic guard per Design); same ownership/`isFinite` guards. Keep the existing comment and extend it with the monotonic rationale. (S12 extends this same block with the components update — coordinate if landing together.)

### Create `app/api/ai/receipt/route.ts`

Copy `app/api/ai/odometer/route.ts` (S6) verbatim in shape: auth → attachment → ownership → image check → `extractFromImage` → 502 on AI failure → `trackEvent("receipt-ocr", ...)`. Schema (`schemaName: "receipt"`):
```
{ date: string | null (YYYYMMDD), vendor: string | null, mileage: number | null,
  totalCost: number | null,
  items: [{ key (from CANONICAL_COMPONENT_KEYS or best kebab-case), name, action, note, cost: number | null }] }
```
Prompt shares `CANONICAL_COMPONENT_KEYS` with S10's (import the const; the convergence of "front tyre"/"fr tire" → `front-tire` across receipts and manuals is what makes Phase 3 matching key-equality). Add a `receipt` entry to `MOCKS` (2–3 line items incl. one `replace`, a vendor, a backdated date, mileage below the seeded 18,250).

### Create `components/service-log-dialog.tsx`

Same Dialog skeleton as `log-entry-dialog.tsx` (vehicle picker, reset-on-open, cmd-enter). Fields: scan/attach strip (S4 pieces) at top → auto-OCR on image-ready with S6's status-line treatment; Vendor (`Input`); Date (`Input type="date"`, default today, stored YYYYMMDD); Mileage (number, optional, with the lower-than-current two-tap warn from S6); line items via `extracted-rows.tsx` (columns: name, action select, cost); Total (number, prefilled from extraction, editable); Notes (`Textarea` → `entry`). `canSubmit`: vehicle + (≥1 item or entry text or attachment). Submit payload: `{ vehicleId, type: LogTypeService, date, entry, items, mileage?, vendor?, totalCost?, attachmentIds }`.

### Modify

- `app/page.tsx`: `recordButtons` gains "Service / Receipt" rendering the new dialog (others untouched); `logIcon` already defaults non-journal/mileage to `Wrench` — fine.
- `app/api/logs/route.ts`: no change needed (POST already passes the whole `log` object through; the S4 `attachmentIds` linking applies).
- `services/stores/memory.ts`: retype the "new tires"/"oil change" seeds as proper `service` logs with `items` (keyed `front-tire`/`rear-tire`/`engine-oil`…) — gives S12 and Phase 3 seeded structure to render out of the box, and the dashboard's recent-custom-type shortcuts adjust naturally.

## Tests

- `test/api/receipts.spec.ts`: OCR route with fake image attachment → canned extraction (`AI_MOCK`); non-image → 400. POST a service log with items + `mileage: 5000` against a fresh vehicle (`mileage: 1000`) → vehicle at 5000; then a backdated service log with `mileage: 3000` → vehicle *stays* 5000; then a mileage-type log `"2500"` → vehicle 2500 (overwrite-always preserved). Hostile structured fields on a journal log are simply stored-but-inert (documented behavior, assert no crash).
- e2e: dashboard → Service / Receipt → `setInputFiles(test/fixtures/receipt.jpg)` → form pre-fills from mock → edit one line → save → entry appears with Wrench icon and paperclip.

## Steps

1. Types → 2. `saveLog` refactor (+ spec first if landing separately from S12) → 3. AI route + mock → 4. dialog → 5. dashboard button → 6. memory-seed upgrade → 7. specs → 8. lint/build/test; manual run with a real shop invoice photo (prompt tuning pass — second-highest-leverage prompt after S10's).

## Out of scope

`vehicle.components` update (S12 — same `saveLog` block, next story), currency handling (bare numbers), multi-page receipts, `attachmentCount`-style cost rollups (Phase 4 charts), editing structured items on existing logs outside the JSON editor.
