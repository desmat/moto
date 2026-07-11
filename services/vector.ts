import { Index } from "@upstash/vector";
import { embed } from "./ai";

// Vector-store plumbing for document search (Upstash Vector). Chunk text lives in the
// vector metadata alongside its ids, so query results are self-contained — no second
// Redis read at query time. Vector ids are `${documentId}:${chunkIndex}`, which makes
// re-ingest upserts naturally idempotent and enables delete-by-id-prefix.
//
// Tenant isolation lives HERE: every query builds its metadata filter from a required
// userId internally — callers cannot construct an unscoped query.

export type Chunk = {
  documentId: string,
  chunkIndex: number,
  page: number,
  text: string,
  userId: string,
  vehicleId: string,
};

// Upstash upsert accepts up to 1000 vectors per call; 100 keeps request bodies sane and
// matches services/ai.ts's embed batch size.
const UPSERT_BATCH_SIZE = 100;

// Same motivation as services/ai.ts: AI_MOCK=true (one knob — a mocked vector store is
// useless without mocked embeddings and vice versa) swaps the real index for the
// in-memory mock store below. Deterministic, zero network.
const mock = () => process.env.AI_MOCK == "true";

// Lazily constructed so importing this module without the env vars set (builds, mock
// mode) doesn't throw — only actually calling it does. Explicit url/token rather than
// Index.fromEnv() magic, so the error below names exactly what's missing.
let index: Index | undefined;
function getIndex(): Index {
  if (!index) {
    const url = process.env.UPSTASH_VECTOR_REST_URL;
    const token = process.env.UPSTASH_VECTOR_REST_TOKEN;
    if (!url || !token) {
      throw new Error("services.vector: UPSTASH_VECTOR_REST_URL and/or UPSTASH_VECTOR_REST_TOKEN is not set");
    }
    index = new Index({ url, token });
  }
  return index;
}

// ---------------------------------------------------------------------------
// AI_MOCK in-memory store: brute-force cosine over stored vectors, honoring the same
// filter semantics as the real queries (userId equality + optional vehicleId/documentId)
// and the same delete-by-id-prefix semantics. Like services/stores/memory.ts, the data
// only lives in JS objects and multiple modules/routes may import this module
// independently — caching on globalThis (rather than a module-level variable) survives
// Next.js dev's per-route module duplication, the same reason Prisma clients are cached
// there this way.

type MockVector = { id: string, vector: number[], metadata: Chunk };

const globalForMockVectorStore = globalThis as unknown as { __motoMockVectorStore?: Map<string, MockVector> };

function mockStore(): Map<string, MockVector> {
  if (!globalForMockVectorStore.__motoMockVectorStore) {
    globalForMockVectorStore.__motoMockVectorStore = new Map();
  }
  return globalForMockVectorStore.__motoMockVectorStore;
}

function cosine(a: number[], b: number[]): number {
  let dot = 0, normA = 0, normB = 0;
  for (let i = 0; i < a.length; i++) {
    dot += a[i] * b[i];
    normA += a[i] * a[i];
    normB += b[i] * b[i];
  }
  const denominator = Math.sqrt(normA) * Math.sqrt(normB);
  return denominator ? dot / denominator : 0;
}

// ---------------------------------------------------------------------------

export async function upsertChunks(chunks: Chunk[]): Promise<void> {
  console.log("services.vector.upsertChunks", { count: chunks.length });

  if (!chunks.length) return;

  const vectors = await embed(chunks.map((chunk) => chunk.text));
  const records = chunks.map((chunk, i) => ({
    id: `${chunk.documentId}:${chunk.chunkIndex}`,
    vector: vectors[i],
    metadata: chunk,
  }));

  if (mock()) {
    for (const record of records) {
      mockStore().set(record.id, record);
    }
    return;
  }

  try {
    for (let i = 0; i < records.length; i += UPSERT_BATCH_SIZE) {
      await getIndex().upsert(records.slice(i, i + UPSERT_BATCH_SIZE));
    }
  } catch (err: any) {
    throw new Error(`services.vector.upsertChunks: ${err.message}`);
  }
}

export async function queryChunks(text: string, { userId, vehicleId, documentId, topK }: {
  userId: string,      // required — every query is scoped to one user's chunks
  vehicleId?: string,
  documentId?: string,
  topK?: number,
}): Promise<(Chunk & { score: number })[]> {
  console.log("services.vector.queryChunks", { userId, vehicleId, documentId, topK });

  const [vector] = await embed([text]);

  if (mock()) {
    return Array.from(mockStore().values())
      .filter(({ metadata }) =>
        metadata.userId == userId
        && (!vehicleId || metadata.vehicleId == vehicleId)
        && (!documentId || metadata.documentId == documentId))
      .map(({ vector: stored, metadata }) => ({ ...metadata, score: cosine(vector, stored) }))
      .sort((a, b) => b.score - a.score)
      .slice(0, topK ?? 8);
  }

  // Upstash metadata filter string (see @upstash/vector README / upstash.com/docs/vector/
  // features/filtering): `field = 'value'` clauses joined with AND. Values here are
  // store-minted ids (internal short-uuids), never raw user input.
  let filter = `userId = '${userId}'`;
  if (vehicleId) filter += ` AND vehicleId = '${vehicleId}'`;
  if (documentId) filter += ` AND documentId = '${documentId}'`;

  try {
    const results = await getIndex().query<Chunk>({
      vector,
      topK: topK ?? 8,
      includeMetadata: true,
      filter,
    });
    return results
      .filter((result) => result.metadata)
      .map((result) => ({ ...(result.metadata as Chunk), score: result.score }));
  } catch (err: any) {
    throw new Error(`services.vector.queryChunks: ${err.message}`);
  }
}

// ⚠ Deletes by vector-id prefix (`${documentId}:` — every chunk id starts with it),
// which works on all Upstash tiers but IGNORES METADATA — it cannot enforce tenant
// isolation itself. The userId param is a documented caller contract, not enforced
// here: callers MUST have ownership-checked the document before calling (S8's document
// delete path loads the Document record and canAccess-checks it first).
export async function deleteByDocument(documentId: string, userId: string): Promise<void> {
  console.log("services.vector.deleteByDocument", { documentId, userId });

  if (mock()) {
    for (const id of Array.from(mockStore().keys())) {
      if (id.startsWith(`${documentId}:`)) {
        mockStore().delete(id);
      }
    }
    return;
  }

  try {
    await getIndex().delete({ prefix: `${documentId}:` });
  } catch (err: any) {
    throw new Error(`services.vector.deleteByDocument: ${err.message}`);
  }
}
