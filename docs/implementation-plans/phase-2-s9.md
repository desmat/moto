# S9 — Ingestion pipeline (extract → chunk → embed)

Story: [phase-2.md](../phase-2.md) § S9. Depends on S7 (vector) + S8 (documents). Unblocks S10, Phase 3 S18.

## Design

- **`ingestDocument(id)` in `services/documents.ts`** does the whole pipeline synchronously: status → `processing`; fetch the file from `attachment.url` (Node `fetch` — also handles the `data:` URLs that `BLOB_MOCK` fixtures use); extract text; chunk; wipe old vectors (`deleteByDocument` — makes re-ingest idempotent); `upsertChunks`; status → `ready` + `pageCount`. Any throw → status `error` with the message. Status writes go through the store directly, not the route, so every future trigger (S13's interview, admin scripts) behaves identically.
- **Extraction is two-tier** (phase-doc economics): `unpdf` (new dependency, serverless-friendly) for PDF text per page — free and fast; pages that yield ~no text (scanned pages) and image uploads fall back to S1's `extractFromImage` with a "transcribe this page" prompt. The fallback is per-page and counted, so a 200-page text PDF costs zero AI calls.
- **Chunking**: ~3,200 chars (≈800 tokens) with ~15% overlap, splitting on paragraph boundaries where possible; each chunk carries `page` (for later citations) and `chunkIndex`.
- **No queue**: the trigger route runs in-process with `export const maxDuration = 300`. The client treats the POST as fire-and-forget (it may time out at proxies for big manuals — that's fine) and **polls document status** as the source of truth. Deferred: background jobs, if a real manual blows 300s.

## Files

### Modify `services/documents.ts`

```ts
export async function ingestDocument(id: string): Promise<Document | undefined>
// helpers (module-private): extractPages(buffer, contentType) → { page, text }[]
//                           chunkPages(pages) → { page, chunkIndex, text }[]
```

### Create `app/api/documents/[id]/ingest/route.ts`

`export const maxDuration = 300;` POST: standard auth/404/ownership preamble (copy the vehicles `[id]` shape) + 409 if already `processing`; then `await ingestDocument(id)` and return the updated document. `trackEvent("document-ingested", { userId, id, status, pageCount })`.

### Create `app/api/documents/search/route.ts`

GET `?q=...&vehicle=...&document=...`: auth → `searchDocuments(q, { userId: user.id, vehicleId, documentId })` (new thin wrapper in `services/documents.ts` over `queryChunks`) → `{ results: [{ documentId, page, chunkIndex, text, score }] }`. Primarily Phase 3's tool surface, but it's also this story's verification instrument and the AC's proof. **Route must be defined before `[id]`-matching concerns**: Next resolves the static `search` segment over `[id]` automatically — no special handling, just noting it's safe.

### Modify

- `hooks/use-document.tsx`: add `ingest` mutation (POST, invalidates on settle) and `refetchInterval: (query) => anyDocProcessing(query) ? 2000 : false` so status badges update live.
- `components/vehicle-documents.tsx` (S8): call `ingest(document.id)` immediately after the document POST succeeds; `error` rows get a "Retry" button → same mutation.
- `package.json`: `npm i unpdf`.

### Create `test/api/ingest.spec.ts`

Runs under `AI_MOCK` + `BLOB_MOCK` + memory store:
1. Fixture: a tiny real one-page PDF checked in at `test/fixtures/mini-manual.pdf` (contains a distinctive sentence, e.g. "valve clearance check every 24000 km"), embedded as a `data:` URL in the attachment record so `ingestDocument`'s fetch works with no Blob store.
2. Create attachment + document → POST ingest → document `ready`, `pageCount: 1`.
3. GET `/api/documents/search?q=valve+clearance&vehicle=...` → top result's `text` contains the sentence, `documentId`/`page` correct (hash-vector mock embeddings make token-overlap queries deterministic).
4. Re-ingest → still one set of chunks (idempotency: search returns no duplicates).
5. DELETE document → same search returns empty (cascade through S8's `deleteDocument`).

## Steps

1. `npm i unpdf` → 2. extract/chunk helpers + `ingestDocument` → 3. ingest route → 4. search route + `searchDocuments` → 5. hook polling + UI trigger/retry → 6. fixture + spec → 7. `npm run lint && npm run build && npm run test:api`.
8. Manual, real backends (real key + vector index): upload an actual owner's manual PDF, watch `processing → ready` in the UI, hit the search route for a known phrase from the manual, confirm page number is plausible. Then delete and confirm vector count drops (Upstash console).

## Out of scope

Schedule extraction (S10 — separate AI pass, separate plan), background job queue, OCR quality tuning for scanned manuals, citation UI (page metadata is stored; surfacing is Phase 3), partial/incremental re-ingest.
