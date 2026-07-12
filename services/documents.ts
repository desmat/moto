import { extractText, getDocumentProxy } from "unpdf";
import { extractFromImage } from "./ai";
import { deleteAttachment, getAttachment } from "./attachments";
import { createStore } from "./stores";
import { Chunk, deleteByDocument, queryChunks, upsertChunks } from "./vector";
import { Attachment } from "@/types/Attachment";
import { Document } from "@/types/Document";
import { SessionUser } from "@/types/User";

const store = createStore({
  debug: true,
});

export async function getDocuments(query?: any): Promise<any> {
  console.log("services.documents.getDocuments", { query });

  return store.documents.find(query);
}

export async function getDocument(id: string): Promise<Document | undefined> {
  console.log("services.documents.getDocument", { id });

  return store.documents.get(id);
}

export async function saveDocument(document: any, by: SessionUser): Promise<Document | undefined> {
  console.log("services.documents.saveDocument", { document, by });

  if (document.id && await store.documents.exists(document.id)) {
    return store.documents.update({ ...document, updatedBy: by.id });
  } else {
    return store.documents.create({ ...document, userId: document.userId || by.id, createdBy: by.id });
  }
}

export async function deleteDocument(id: string): Promise<Document | undefined> {
  console.log("services.documents.deleteDocument", { id });

  const document = await store.documents.get(id);

  if (!document) return undefined;

  // cascade: a document's vectors and its attachment (record + blob) go with it; done
  // here in the service layer so every deletion path gets it (same pattern as
  // services/logs.ts's deleteLog). Order: vectors first (a failure leaves the document
  // intact and retryable), then the attachment (blob deletion is already best-effort),
  // then the record itself.
  //
  // ⚠ deleteByDocument deletes by vector-id prefix and cannot enforce tenant isolation
  // itself (see services/vector.ts) — callers of deleteDocument MUST have
  // ownership-checked the document first (the DELETE route canAccess-checks before
  // calling here).
  await deleteByDocument(id, document.userId);

  document.attachmentId && await deleteAttachment(document.attachmentId);

  return store.documents.delete(id);
}

// ---------------------------------------------------------------------------
// Ingestion (S9): extract → chunk → embed. ingestDocument() drives the whole pipeline
// synchronously and owns the uploaded → processing → ready | error status transitions
// (status writes go through the store here, not the routes, so every trigger — the
// ingest route today, S13's interview or admin scripts later — behaves identically).

// per-page transcription fallback for image uploads (and, if we ever can render them,
// scanned PDF pages): same strict leading-boolean-gate shape as services/odometer.ts —
// forcing the model to commit to "is the text actually legible?" before emitting any
// text is the repo's anti-hallucination convention (see the S6 note in odometer.ts).
type PageTranscription = {
  page_text_clearly_legible: boolean,
  text: string | null,
};

const pageTranscriptionSchema = {
  type: "object",
  properties: {
    page_text_clearly_legible: {
      type: "boolean",
      description: "true ONLY if the image is a document page (or sticker/placard/table) whose text you can actually read. false for anything else (photos without readable text, blur, glare, abstract images).",
    },
    text: {
      type: ["string", "null"],
      description: "A faithful transcription of ALL text visible on the page, in reading order, preserving paragraph breaks as blank lines. MUST be null when page_text_clearly_legible is false.",
    },
  },
  required: ["page_text_clearly_legible", "text"],
  additionalProperties: false,
};

const PAGE_TRANSCRIPTION_PROMPT = `You are a strict transcriber converting a photographed or scanned document page to plain text. You only transcribe text actually visible in the image — never summarize, infer, or invent content.

First decide: does the image clearly contain readable text? Set page_text_clearly_legible accordingly. If it is false, text MUST be null — null is the correct, expected answer for an unreadable or irrelevant image; fabricated content is the worst possible answer.

If text is readable: transcribe all of it in natural reading order. Preserve paragraph structure with blank lines between paragraphs, and keep tabular data line-by-line. Skip page furniture only if illegible; do not add commentary of your own.`;

async function transcribePage(imageUrl: string): Promise<string | null> {
  const result = await extractFromImage<PageTranscription>({
    imageUrl,
    prompt: PAGE_TRANSCRIPTION_PROMPT,
    schemaName: "pageTranscription",
    schema: pageTranscriptionSchema,
  });

  return (result.page_text_clearly_legible && result.text) || null;
}

// a PDF page whose extracted text has fewer non-whitespace chars than this is treated
// as image-only (scanned)
const MIN_PAGE_TEXT_CHARS = 32;

// Two-tier extraction (phase-doc economics): unpdf handles PDF text per page — free and
// fast, so a 200-page text PDF costs zero AI calls; image uploads (their attachment URL
// is already an image the vision model can read) go through transcribePage().
//
// DOCUMENTED DEVIATION for scanned/text-less PDF *pages*: the planned fallback was
// unpdf's renderPageAsImage → transcribePage, but renderPageAsImage requires
// @napi-rs/canvas (an optional native-binary peer dep of unpdf, not installed; it throws
// 'Parameter "canvasImport" is required in Node.js environment' without it), which isn't
// viable for the serverless target. Such pages are skipped with a per-page log note —
// they still count toward pageCount, they just contribute no chunks.
async function extractPages(attachment: Attachment): Promise<{ page: number, text: string }[]> {
  if (attachment.contentType?.startsWith("image/")) {
    console.log("services.documents.extractPages: image attachment → vision transcription fallback", { attachmentId: attachment.id });
    const text = await transcribePage(attachment.url);
    if (text == null) {
      console.log("services.documents.extractPages: image not legible, no text extracted", { attachmentId: attachment.id });
    }
    return [{ page: 1, text: text || "" }];
  }

  // Node fetch handles both real blob URLs and the data: URLs BLOB_MOCK fixtures use
  const res = await fetch(attachment.url);
  if (!res.ok) {
    throw new Error(`fetching attachment failed (${res.status})`);
  }
  const buffer = new Uint8Array(await res.arrayBuffer());

  const pdf = await getDocumentProxy(buffer);
  const { totalPages, text } = await extractText(pdf);

  let skippedPages = 0;
  const pages = text.map((pageText, i) => {
    const trimmed = pageText.trim();
    if (trimmed.replace(/\s/g, "").length < MIN_PAGE_TEXT_CHARS) {
      skippedPages++;
      console.log("services.documents.extractPages: page yielded ~no text (scanned?), skipping — no renderPageAsImage fallback without @napi-rs/canvas", { page: i + 1 });
      return { page: i + 1, text: "" };
    }
    return { page: i + 1, text: trimmed };
  });

  console.log("services.documents.extractPages", { totalPages, skippedPages });

  return pages;
}

// ~3,200 chars ≈ 800 tokens per chunk, ~15% overlap so a fact straddling a cut is fully
// inside at least one chunk
const CHUNK_TARGET_CHARS = 3200;
const CHUNK_OVERLAP_CHARS = 480;

// splits one page's text into ≤CHUNK_TARGET_CHARS pieces, preferring paragraph
// boundaries (blank lines), then line breaks, then word breaks — only cutting in the
// back half of the window so boundary-seeking never produces degenerately small chunks
function chunkPageText(text: string): string[] {
  if (!text) return [];
  if (text.length <= CHUNK_TARGET_CHARS) return [text];

  const chunks: string[] = [];
  let start = 0;
  while (start < text.length) {
    let end = Math.min(start + CHUNK_TARGET_CHARS, text.length);
    if (end < text.length) {
      const window = text.slice(start, end);
      for (const boundary of ["\n\n", "\n", " "]) {
        const cut = window.lastIndexOf(boundary);
        if (cut > CHUNK_TARGET_CHARS / 2) {
          end = start + cut;
          break;
        }
      }
    }
    const chunk = text.slice(start, end).trim();
    if (chunk) chunks.push(chunk);
    if (end >= text.length) break;
    start = end - CHUNK_OVERLAP_CHARS;
  }
  return chunks;
}

// chunkIndex is global across the document (vector ids are `${documentId}:${chunkIndex}`
// — see services/vector.ts — so they must be unique document-wide, not per-page)
function chunkPages(pages: { page: number, text: string }[]): { page: number, chunkIndex: number, text: string }[] {
  const chunks: { page: number, chunkIndex: number, text: string }[] = [];
  for (const { page, text } of pages) {
    for (const chunkText of chunkPageText(text)) {
      chunks.push({ page, chunkIndex: chunks.length, text: chunkText });
    }
  }
  return chunks;
}

export async function ingestDocument(id: string): Promise<Document | undefined> {
  console.log("services.documents.ingestDocument", { id });

  const document = await store.documents.get(id);

  if (!document) return undefined;

  await store.documents.update({ ...document, status: "processing", error: undefined });

  try {
    const attachment = await getAttachment(document.attachmentId);
    if (!attachment) {
      throw new Error(`attachment ${document.attachmentId} not found`);
    }

    const pages = await extractPages(attachment);
    const chunks: Chunk[] = chunkPages(pages).map((chunk) => ({
      ...chunk,
      documentId: document.id,
      userId: document.userId,
      vehicleId: document.vehicleId,
    }));

    // zero chunks means ingestion accomplished nothing — a fully-scanned PDF (all pages
    // skipped, see extractPages) or an illegible image. Landing "ready" would be a
    // silent no-op (search finds nothing, user none the wiser): fail loudly instead.
    // Thrown BEFORE the vector wipe so a previously-good ingest's chunks survive a
    // degenerate re-ingest.
    if (!chunks.length) {
      throw new Error("no readable text found in the document (scanned/image-only PDFs aren't supported yet — try a text-based PDF)");
    }

    // wipe old vectors FIRST so re-ingest is idempotent (a shrunken re-extraction must
    // not leave stale higher-index chunks behind), then upsert the fresh set
    await deleteByDocument(document.id, document.userId);
    await upsertChunks(chunks);

    console.log("services.documents.ingestDocument: done", { id, pageCount: pages.length, chunkCount: chunks.length });

    return store.documents.update({ ...document, status: "ready", error: undefined, pageCount: pages.length });
  } catch (err: any) {
    // deliberately NOT rethrown: status is the source of truth — the route returns the
    // errored document and the UI surfaces document.error with a retry affordance
    console.error("services.documents.ingestDocument: failed", { id, error: err });
    return store.documents.update({ ...document, status: "error", error: err.message || String(err) });
  }
}

// thin wrapper over the vector store's query (the query embedding happens inside
// queryChunks); primarily Phase 3's chat-tool surface, but also S9's verification
// instrument via /api/documents/search
export async function searchDocuments(query: string, { userId, vehicleId, documentId }: {
  userId: string,      // required — tenant isolation is enforced inside queryChunks
  vehicleId?: string,
  documentId?: string,
}): Promise<(Chunk & { score: number })[]> {
  console.log("services.documents.searchDocuments", { query, userId, vehicleId, documentId });

  return queryChunks(query, { userId, vehicleId, documentId });
}
