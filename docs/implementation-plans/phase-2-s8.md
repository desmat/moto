# S8 — `Document` entity + upload UI

Story: [phase-2.md](../phase-2.md) § S8. Depends on S2 (attachments) + S3 (upload). Unblocks S9/S10. Another run of the six-touchpoint pattern; the S2 plan is the template — this one lists only the deltas.

## Design

- A `Document` is a *reference* to an uploaded file (via `attachmentId`) plus ingestion lifecycle state. Receipts are **not** documents (phase-doc scoping call): only `"manual" | "other"` types exist for now.
- **Status is a state machine** owned by the service layer: `uploaded → processing → ready | error` (S9 drives the transitions; S8 creates records in `uploaded`).
- **Cascade on delete**: document → its vectors (S7 `deleteByDocument`), its attachment (record + blob, via S2's `deleteAttachment`). Service-layer, like S5's log cascade.
- **UI lives on the vehicle detail page** — no new route, no nav/breadcrumb changes. `/vehicles/[id]` currently renders only a `JsonEditor`; this adds the first real section above it (S12's "Current setup" card will join it).

## Files

### Create `types/Document.ts`

```ts
export type Document = {
  id: string; createdAt: number; createdBy?: string;
  updatedAt?: number; updatedBy?: string; deletedAt?: number;
  userId: string;
  vehicleId: string;
  attachmentId: string;
  type: "manual" | "other";
  title: string;                // defaults to the uploaded filename; editable via JSON editor
  status: "uploaded" | "processing" | "ready" | "error";
  error?: string;               // populated when status == "error"
  pageCount?: number;           // set by ingestion (S9)
};
export const DocumentOptions = {
  lookups: { user: "userId", vehicle: "vehicleId" },
  hardDelete: true,
  fieldDisplayOrder: [...],
};
```

### Touchpoints (per S2 template)

- `services/stores/config.ts`: `documents: { key: "MotoDocument", options: DocumentOptions }`; wire `RedisStore`/`MemoryStore` in both backends. Memory seed: none for now — S9's spec creates its own fixture document (a seeded "ready" doc would also need seeded mock vectors; not worth the coupling).
- `services/documents.ts`: standard CRUD wrappers + `deleteDocument(id)` performing the cascade (import `deleteByDocument` from `./vector`, `deleteAttachment` from `./attachments`; both are already safe against missing/fake targets). S9 extends this file with `ingestDocument`.
- `app/api/documents/route.ts` + `[id]/route.ts`: copy the vehicles routes. POST validates `vehicleId` ownership the same way `app/api/logs/route.ts` POST does (fetch vehicle, 400 unless `vehicle.userId == user.id`) and validates the attachment is owned by the caller; forces `status: "uploaded"`; destructures `id` off. PUT pins identity fields **plus `attachmentId`, `vehicleId`, `status`** (status belongs to the service/ingest flow; title/type are the editable bits). GET list supports `?vehicle=<id>`.
- `hooks/use-document.tsx`: modeled on `use-attachment` (S2) — `useDocument({ vehicleId })`, no localStorage layer. S9 adds the status-polling `refetchInterval`.

### Create `components/vehicle-documents.tsx`

Rendered by `app/vehicles/[id]/page.tsx` above the `JsonEditor`:
- Header "Documents", an "Upload manual / document" `Button variant="outline"` → hidden file input (`accept="application/pdf,image/*"`) → `uploadFile()` (S3) → POST `/api/attachments` → POST `/api/documents` `{ vehicleId, attachmentId, type, title: file.name }`. Type defaults to `"manual"` for PDFs with a small select to override.
- List rows: title, type, status badge (`uploaded`/`processing` with spinner/`ready ✓`/`error` with message tooltip), delete (confirm → DELETE, cascade). Row links to the source attachment URL (view the PDF).
- S9 wires the "ingest on upload" trigger + retry button into this component.

### Create `test/api/documents.spec.ts`

Per `ownership.spec.ts` conventions: POST with owned vehicle+attachment → record with `status: "uploaded"`, minted id; POST with `vehicleId: "does-not-exist"` → 400; PUT changes `title` but pinned fields (incl. `status`, `vehicleId`) survive a hostile payload; `?vehicle=` filtering; DELETE → attachment record gone too (assert via `GET /api/attachments/[id]` → 404); missing ids 404.

## Steps

1. Type → 2. store config + both backends → 3. service (CRUD + cascade) → 4. routes → 5. hook → 6. `vehicle-documents.tsx` + mount in vehicle page → 7. spec → 8. `npm run lint && npm run build && npm run test:api`; manual: upload a real PDF against a vehicle, see the `uploaded` row, delete it, confirm blob gone from the Vercel dashboard.

## Out of scope

Ingestion + status transitions + retry (S9), schedule extraction (S10), documents outside vehicles, multiple-file documents, a global Documents nav item.
