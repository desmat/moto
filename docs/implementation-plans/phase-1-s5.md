# S5 — Show attachments on logs

Story: [phase-1.md](../phase-1.md) § S5. Depends on S2 (entity/hook) and S4 (things to show). Independent of S6.

## Design

- **Detail page**: an attachments strip on `/logs/[id]` alongside the existing `JsonEditor` — read-only display (view/download); add/remove at edit time waits for real forms (`docs/form-patterns.md`).
- **List indicators without N+1**: the logs list GET response gets an `attachmentCount` merged onto each log server-side — one `store.attachments.find({ user })` per request, grouped by `logId` in the route. At this app's scale (a user's own attachments) that's one extra lookup, not a scaling problem; denormalizing a count onto `Log` records is the later optimization if it ever matters. Counts ride on the existing response shape, so hooks/localStorage caching need no changes.
- **Cascade delete**: deleting a log deletes its attachments (records + blobs) in `services/logs.ts` — service layer, not route layer, so every deletion path gets it.

## Files

### Modify `services/logs.ts`

`deleteLog(id)`: before `store.logs.delete(id)`, `getAttachments({ log: id })` → `deleteAttachment(a.id)` for each (import from `./attachments`; its blob deletion is already best-effort so a fake/missing blob can't block the log delete). Keep the existing `console.log` convention.

### Modify `app/api/logs/route.ts` (GET)

After fetching logs: `const attachments = await getAttachments({ user: user.id })`; build `counts: Record<logId, number>`; return `logs.map(l => ({ ...l, attachmentCount: counts[l.id] || 0 }))`. (`attachmentCount` is a computed, response-only field — deliberately **not** added to `types/Log.ts`'s stored shape; type the enriched response inline or as `Log & { attachmentCount?: number }`.)

### Modify `app/logs/[id]/page.tsx`

- `useAttachment({ logId: id })` (S2 hook).
- Above the `JsonEditor`: when attachments exist, a horizontal strip — images as thumbnail `<img>`s (fixed height, `max-width:100%`, `object-cover`) wrapped in `<a href={url} target="_blank">`; non-images as a filename chip linking to the blob URL (`download` attribute). No lightbox — new tab is the v1 (per phase doc AC).

### Modify list surfaces

- `app/page.tsx` (dashboard Entries): logs already flow from `use-log`; when `log.attachmentCount > 0`, render a small `Paperclip` icon (lucide) after the entry text, matching the existing muted styling. If the entry text is empty (S4's photo-only entries), fall back to showing `📷 ${filename or "photo"}`-style placeholder text so the row isn't blank — simplest: `log.entry?.trim() || "(photo)"`.
- `app/logs/page.tsx` (Logs list): same paperclip treatment (inspect the file at implementation time; it renders the same log rows pattern).

## Tests

- `test/api`: extend `attachments.spec.ts` — create log + linked attachment → `GET /api/logs` includes `attachmentCount: 1` on that log; `DELETE /api/logs/[id]` → subsequent `GET /api/attachments?log=<id>` returns empty (cascade ran).
- e2e: with the S2 memory-store seed (one attachment on the "new tires" log), dashboard/logs list shows a paperclip on that row out of the box; navigating to the log detail shows the thumbnail. (Seeded `url` is a data-URL, so no Blob dependency.)

## Steps

1. `services/logs.ts` cascade → 2. logs GET `attachmentCount` → 3. detail-page strip → 4. list indicators (dashboard + logs page) → 5. specs → 6. `npm run lint && npm run build && npm run test`.
7. Manual: log with a real blob image renders and opens full-size; photo-only entry shows the placeholder text in lists; deleting that log removes the blob (check Vercel dashboard).

## Out of scope

Lightbox/gallery UI, image thumbnails/resizing (full-size blob URLs in `<img>` for now), attachment management from the detail page, per-vehicle photo galleries (Phase 2+ item using `vehicleId` already denormalized in S4).
