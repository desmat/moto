import { deleteAttachment } from "./attachments";
import { createStore } from "./stores";
import { deleteByDocument } from "./vector";
import { Document } from "@/types/Document";
import { SessionUser } from "@/types/User";

const store = createStore({
  debug: true,
});

// S9 extends this file with ingestDocument() (PDF → text → chunks → vectors), which
// drives the uploaded → processing → ready | error status transitions.

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
