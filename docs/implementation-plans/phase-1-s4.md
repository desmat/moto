# S4 — Attach pics/files in the log dialog

Story: [phase-1.md](../phase-1.md) § S4. Depends on S2 + S3. Unblocks S5, S6.

## Design

- **Upload on pick, link on save.** Files upload the moment they're picked (S3's `uploadFile` → S2's POST creates a pending record with no `logId`), so Save itself stays instant. The log POST then carries `attachmentIds`, and **linking happens server-side** in the logs route — more robust than client-side follow-up PUTs (one request, no half-linked states if the client dies mid-sequence).
- **File input**: `accept="image/*,application/pdf"`, `multiple`, **no `capture` attribute** — on mobile the browser then offers Camera / Photo Library / Files in one tap, whereas `capture="environment"` forces straight to camera and hides the library. Camera stays one tap away either way; the library matters ("that photo I took at the shop earlier").
- **`canSubmit` relaxation**: journal/custom entries become savable with attachments and no text (the pic *is* the entry); mileage still requires a numeric reading (S6 automates filling it). Save disabled while any upload is in flight.
- **Remove before save** = DELETE the attachment (record + blob, via S2). Dialog closed/cancelled after upload → pending records with no `logId` are tolerated orphans (deferred cleanup, per phase doc).

## Files

### Modify `components/log-entry-dialog.tsx`

- New state: `attachments: { id, url, contentType, filename, status: "uploading" | "ready" | "error" }[]`, reset in the existing `useEffect` on open.
- New prop: none — but `onSubmit`'s payload type gains `attachmentIds: string[]`.
- UI, below the entry field: a row of thumbnails (images: `<img>` from `url`; PDFs: filename chip with a file icon), each with an ✕ remove button and an uploading spinner (`LoaderIcon` + `animate-spin`, per `setup-vehicle-dialog.tsx`), plus an "Add photo / file" `Button variant="outline"` (Paperclip icon from `lucide-react`) triggering a hidden `<input type="file" accept="image/*,application/pdf" multiple>`.
- On file pick (per file): append `{ status: "uploading" }` entry → `uploadFile(file, user.id)` (`lib/upload.ts`; internal user id via `useUser()` — the dialog doesn't currently import it, add it) → POST `/api/attachments` via `useAttachment().add` → update entry to `ready` with the record id. Failure → `error` state on the chip with retry/remove.
- Remove click: `useAttachment().delete(id)`, drop from state.
- `canSubmit`:
  ```
  vehicleId && no attachment "uploading"
    && (mode == "mileage" ? Number.isFinite(parseFloat(entry))
        : entry.trim() || attachments.some(ready))
    && (mode != "custom" || type.trim())
  ```
- `submit()`: include `attachmentIds: attachments.filter(ready).map(a => a.id)`.
- Dev note: this component is also instantiated per recent-custom-type shortcut on the dashboard — state is per-instance and resets on open, so no cross-dialog bleed.

### Modify `app/api/logs/route.ts` (POST)

Accept `{ log, attachmentIds? }`. After `saveLog` succeeds, for each id: `getAttachment` → skip unless `attachment.userId == user.id && (!attachment.logId || attachment.logId == newLog.id)` (never re-link someone else's, never steal from another log) → `saveAttachment({ ...attachment, logId: newLog.id, vehicleId: newLog.vehicleId }, user)`. Return the log as today.

### Modify `app/page.tsx` + `hooks/use-log.tsx`

- `recordLog` / the dialog `onSubmit` type: pass `attachmentIds` through.
- `use-log.tsx` `addMutation`: include `attachmentIds` in the POST body (`{ log, attachmentIds }`); `onSuccess` additionally invalidates `["attachments"]`.

## Tests

- Extend `test/api/ownership.spec.ts`-style coverage in `attachments.spec.ts`: POST `/api/logs` with `attachmentIds` → attachments' `logId`/`vehicleId` set; with an id already linked to another log → left untouched; response still the log.
- New e2e in `test/e2e/` (runs under `BLOB_MOCK` + memory store): dashboard → Journal Entry → `setInputFiles` with a small fixture image (`test/fixtures/odometer.jpg`, shared with S6) → thumbnail appears → Save enabled with empty text → save → entry appears in the list. Second scenario: remove the pending thumbnail → Save disabled again (text empty).

## Steps

1. Dialog state + UI + upload wiring → 2. logs POST linking → 3. `app/page.tsx`/hook plumbing → 4. API + e2e specs → 5. `npm run lint`, `npm run build`, `npm run test` (dev server stopped first — Next 16 single-dev-server lock).
6. Manual: real phone (or devtools device mode) — camera option appears, photo-only journal entry saves, `GET /api/attachments?log=<id>` returns it.

## Out of scope

Displaying attachments on existing logs/lists (S5), OCR autofill (S6), edit-time attachment management on the log detail page (JSON editor era — revisit with real forms per `docs/form-patterns.md`), orphan reaping.
