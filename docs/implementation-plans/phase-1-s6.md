# S6 — Odometer photo → mileage log

Story: [phase-1.md](../phase-1.md) § S6. Depends on S1 (AI layer) + S4 (attach flow). The Phase 1 finish line: the full camera → blob → vision → confirm → save slice.

## Design

- **Route, not client-side AI**: `POST /api/ai/odometer` takes an `attachmentId`, verifies ownership, and calls S1's `extractFromImage` with the blob URL. The key never leaves the server; the route is the reusable shape for Phase 2's receipt endpoint (`/api/ai/receipt`).
- **Schema** (plain JSON Schema, `schemaName: "odometer"`):
  `{ reading: number | null, unit: "km" | "mi" | null, confidence: "high" | "low" }` — `null` reading is the model's honest "can't read it"; prompt instructs digits-only-from-the-display, no guessing, trip-meter vs odometer disambiguation (take the larger/labeled ODO value).
- **Auto-fire, never block**: in mileage mode, when an image attachment reaches `ready`, the OCR call fires automatically; the odometer field shows a subtle reading state. Whatever happens — filled, low-confidence, unreadable, route error — the field remains an ordinary editable input and manual entry always works. AI is an accelerator, not a gate.
- **Sanity check client-side**: a reading below the vehicle's current `mileage` (available on the dialog's `vehicles` prop) triggers an inline confirm ("lower than the current 18,250 km — save anyway?") requiring a second tap; legitimate corrections proceed. Server behavior unchanged (`saveLog`'s existing vehicle-mileage sync applies as-is).

## Files

### Create `app/api/ai/odometer/route.ts`

Standard route skeleton (copy the vehicles `[id]` GET shape): `currentUser()` → 403; `{ attachmentId } = await request.json()`; `getAttachment` → 404 missing, 403 not owner, 400 if `!contentType.startsWith("image/")`. Then:

```ts
const result = await extractFromImage<OdometerReading>({
  imageUrl: attachment.url,
  prompt: ODOMETER_PROMPT,
  schemaName: "odometer",
  schema: odometerSchema,
});
return NextResponse.json({ result });
```

Wrap the AI call: failure → 502 JSON `{ success: false, message }` (distinct from auth/validation 4xx so the client can message "couldn't read" vs "try again"). `trackEvent("odometer-ocr", { userId, attachmentId, confidence, readable: result.reading != null })` per convention.

### Modify `services/ai.ts` (S1)

Add `odometer: { reading: 12345, unit: "km", confidence: "high" }` to `MOCKS`.

### Modify `components/log-entry-dialog.tsx`

Mileage-mode additions (on top of S4's attachment support):

- New state: `ocr: "idle" | "reading" | "done" | "low" | "failed"`.
- Effect: mileage mode + newest attachment turns `ready` + is an image + `entry` still empty → POST `/api/ai/odometer`; on result: `reading != null` → `setEntry(String(reading))`, `ocr = confidence == "high" ? "done" : "low"`; else `failed`.
- Under the Odometer input, one muted status line: reading → spinner + "Reading odometer…"; done → "✨ read from photo — check and save"; low → amber "✨ best guess from photo — please verify"; failed → "Couldn't read the odometer — enter it manually". Field enabled throughout; user edits clear the hint.
- Save-time check: `parseFloat(entry) < (vehicles.find(v => v.id == vehicleId)?.mileage ?? 0)` → first Save tap swaps the hint line for the confirm warning and the button label to "Save anyway"; second tap submits. (Inline two-tap rather than `window.confirm`, consistent with the dialog's styling; `logs/[id]`'s `confirm()` precedent notwithstanding — this one's a soft warning, not a destructive action.)

### Tests

- `test/api/odometer.spec.ts`: create attachment record (fake image `contentType: "image/jpeg"`, prefix-valid pathname) → POST route → canned `{ reading: 12345, ... }` (AI_MOCK). Missing attachment → 404; non-image (`application/pdf`) → 400. (Always-authenticated test server, so 403 is design-review-only, per `ownership.spec.ts`'s standing note.)
- e2e (`BLOB_MOCK` + `AI_MOCK` + memory store): **create its own vehicle via the API first** (per AGENTS.md's test-isolation convention — do not mutate the seeded CB500X; parallel specs share one in-memory store and Phase 3 plans assert exact seed arithmetic on that bike). POST a vehicle with a known `mileage` **greater than the mock reading of 12345** (e.g. `mileage: 18250`, mirroring the old CB500X value) so the lower-than-current path is reachable, then select it in the dialog's vehicle picker. Scenario A: Record → Current Mileage → `setInputFiles(test/fixtures/odometer.jpg)` → odometer field becomes `12345` with the ✨ hint → Save → entry in list; vehicle mileage updated (assert via `/api/vehicles/<id>`). Scenario B (same freshly-created vehicle, `mileage: 18250` > 12345): the two-tap "Save anyway" path — assert the warning appears, second tap saves.

## Steps

1. Route + schema/prompt consts → 2. mock entry → 3. dialog OCR state/UX → 4. sanity-check two-tap → 5. specs → 6. `npm run lint && npm run build && npm run test`.
7. Manual with a real key (`AI_MOCK` unset): photo of an actual odometer (and one deliberately blurry shot for the failure path) through the phone flow; confirm reading, confidence behavior, and that `vehicle.mileage` updates.

## Out of scope

Receipt extraction (Phase 2 S11 — reuses this route shape), unit conversion (reading is recorded as-entered; the app doesn't yet model units), multi-image OCR, trip-computer readings.
