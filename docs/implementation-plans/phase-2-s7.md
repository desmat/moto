# S7 — Embedding + vector plumbing

Story: [phase-2.md](../phase-2.md) § S7. Depends on S1 (`services/ai.ts`). Unblocks S9. Decision already made: **Upstash Vector**.

## Design

- **`embed()` joins `services/ai.ts`** next to `extractFromImage` — model name added to the existing `MODELS` const (current OpenAI embedding model; its dimension count must match the Upstash Vector index, so record both in the same comment).
- **`services/vector.ts`** wraps `@upstash/vector` (new dependency). It owns tenant isolation: every query/delete builds its metadata filter from a required `userId` internally — callers cannot construct an unscoped query.
- **Chunk text lives in vector metadata** (`{ userId, vehicleId, documentId, page, chunkIndex, text }`) — query results are self-contained, no second Redis read. Vector ids are `"{documentId}:{chunkIndex}"`, making re-ingest upserts naturally idempotent.
- **Mock mode piggybacks on `AI_MOCK`** (one knob, not a separate `VECTOR_MOCK` — a mocked vector store is useless without mocked embeddings and vice versa; the phase doc allowed either). Mock `embed()` returns deterministic bag-of-words hash vectors (each token hashed into a fixed 256-dim vector, summed, normalized) so token overlap ≈ cosine similarity — real enough for "search finds the chunk containing the query words" in specs. Mock vector store: in-memory map cached on `globalThis` (same singleton pattern and rationale as `services/stores/memory.ts`) with brute-force cosine.
- **Index provisioning is manual/one-time** (Upstash console: cosine metric, dims = embedding model's) — documented, not automated.

## Files

### Modify `services/ai.ts`

```ts
export async function embed(texts: string[]): Promise<number[][]>
```
Batches of ≤ 100 inputs per API call (loop for more); `AI_MOCK` → hash vectors per above. Standard `console.log("services.ai.embed", { count: texts.length })`. (Handover note: Phase 1's canned mocks live in `test/fixtures/ai-mocks.json`, not a `MOCKS` const — but that registry is for static responses; the embed mock is a function of its input, so its hash-vector code lives in `services/ai.ts`'s mock branch directly.)

### Create `services/vector.ts`

```ts
export type Chunk = { documentId: string, chunkIndex: number, page: number,
                      text: string, userId: string, vehicleId: string };

export async function upsertChunks(chunks: Chunk[]): Promise<void>
  // embed(texts) → index.upsert([{ id: `${documentId}:${chunkIndex}`, vector, metadata }]) in batches
export async function queryChunks(text: string, filter: { userId: string, vehicleId?: string, documentId?: string, topK?: number })
  : Promise<(Chunk & { score: number })[]>
  // embed([text]) → index.query({ vector, topK: topK ?? 8, includeMetadata: true,
  //   filter: `userId = '${userId}'` + optional AND clauses })
export async function deleteByDocument(documentId: string, userId: string): Promise<void>
```

Lazy `Index` construction (throw a clear error naming `UPSTASH_VECTOR_REST_URL`/`UPSTASH_VECTOR_REST_TOKEN` if unset — same lazy-client pattern as S1). `deleteByDocument`: **delete by id prefix** — `index.delete({ prefix: \`${documentId}:\` })` — which the `"{documentId}:{chunkIndex}"` id scheme enables and which works on all Upstash tiers. (S0 review correction: the original "query ids by filter then delete" isn't a thing — Upstash queries need a query vector, and delete-by-metadata-filter is paid-tier only.) ⚠ Prefix delete ignores metadata, so it cannot enforce tenant isolation itself: the `userId` param exists as a documented contract that **callers must have ownership-checked the document before calling** (S8's delete path does — it loads the Document record and `canAccess`-checks it first). The mock store implements the same prefix semantics.

### Modify

- `package.json`: `npm i @upstash/vector`.
- `AGENTS.md`: add the two env vars to the required list (with "create the index with cosine metric and the embedding model's dimensions" note); extend the `AI_MOCK` sentence to say it also mocks embeddings + vector search.
- `.env.local` (user action): the two Upstash Vector values.

## Tests / verification

No standalone route exists yet, so:
- Mock-mode correctness is asserted through S9's ingest+search spec (this plan's deliverable is exercised there; don't build a throwaway route).
- Real-backend smoke: a `tsx` snippet (scratch, not committed) that upserts two chunks for two different `userId`s, queries as user A, asserts only A's chunk returns, then `deleteByDocument` and asserts empty. Run once against the real index before calling S7 done.
- `npm run build` type-checks.

## Steps

1. `npm i @upstash/vector` → 2. `embed()` + mock in `services/ai.ts` → 3. `services/vector.ts` + mock store → 4. AGENTS.md/env → 5. real-backend smoke snippet → 6. build.

## Out of scope

Ingestion/chunking (S9), any UI, delete-by-filter optimization, namespaces (single index + metadata filter is fine at this scale; revisit if a hard-isolation requirement appears).
