'use client'
import { sortBy } from "@desmat/utils"
import { Check, FileText, LoaderIcon, RotateCw, Trash2, X } from "lucide-react"
import { useRef, useState } from "react"
import { Button } from "@/components/ui/button"
import { Label } from "@/components/ui/label"
import { useAttachment } from "@/hooks/use-attachment"
import { useDocument } from "@/hooks/use-document"
import { useUserRecord } from "@/hooks/use-user"
import { uploadFile } from "@/lib/upload"
import { Document } from "@/types/Document"

// The vehicle page's Documents section (S8): upload a manual/document against the
// vehicle (blob upload → attachment record → document record, riding the S2/S3 chain),
// list the vehicle's documents with their ingestion status, delete (cascades to
// vectors + attachment server-side). Ingestion (S9) kicks off automatically after the
// document record is created; "error" rows get a Retry button (re-ingest is idempotent
// server-side). Status badges update live via the hook's processing-status polling.

// a picked file's lifecycle while the upload + record POSTs are in flight; on success
// the row disappears in favor of the real document row from the refetched list
type PendingUpload = {
  id: string,
  filename: string,
  status: "uploading" | "error",
};

export default function VehicleDocuments({ vehicleId }: { vehicleId: string }) {
  const { user } = useUserRecord();
  // also exposes the whole user's attachments, keyed by id, to resolve row file URLs
  const { add: addAttachment, attachments } = useAttachment();
  const { loaded, documents, add: addDocument, ingest: ingestDocument, delete: deleteDocument } = useDocument({ vehicleId });
  const [pending, setPending] = useState<PendingUpload[]>([]);
  // "manual" is the right default for PDFs; if the user hasn't explicitly picked a type,
  // non-PDF files (photos of a sticker, a scanned page, ...) fall back to "other"
  const [docType, setDocType] = useState<"manual" | "other">("manual");
  const [docTypeTouched, setDocTypeTouched] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const sortedDocuments: Document[] = documents
    ? (Object.values(documents) as Document[]).sort(sortBy('createdAt'))
    : [];

  const uploadPickedFile = async (file: File) => {
    const localId = `local-${Date.now()}-${Math.random().toString(16).slice(2, 10)}`;

    setPending((previous) => [...previous, {
      id: localId,
      filename: file.name,
      status: "uploading",
    }]);

    try {
      // user.id is the INTERNAL short-uuid id (useUserRecord) -- see lib/upload.ts
      const uploadedBlob = await uploadFile(file, user.id);
      const attachment = await addAttachment({ ...uploadedBlob });
      console.log("components.vehicle-documents.uploadPickedFile", { uploadedBlob, attachment });

      const isPdf = file.type == "application/pdf";
      const document = await addDocument({
        vehicleId,
        attachmentId: attachment.id,
        type: docTypeTouched ? docType : (isPdf ? "manual" : "other"),
        title: file.name,
      });

      // fire-and-forget: the server runs the whole pipeline in-route and the hook's
      // polling tracks the processing → ready | error transitions
      document?.id && ingestDocument(document.id);

      setPending((previous) => previous.filter((p) => p.id != localId));
    } catch (error) {
      console.error("components.vehicle-documents.uploadPickedFile", { error });
      setPending((previous) => previous.map((p) => p.id == localId
        ? { ...p, status: "error" }
        : p));
    }
  }

  const pickFiles = (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = Array.from(e.target.files || []);
    // reset so picking the same file again re-fires onChange
    e.target.value = "";
    files.forEach(uploadPickedFile);
  }

  const handleDelete = (document: Document) => {
    if (confirm("Delete this document? Its uploaded file will be deleted too.")) {
      deleteDocument(document.id);
    }
  }

  return (
    <div className="flex flex-col gap-3 items-center w-full max-w-[800px]">
      <div className="font-semibold">
        Documents
      </div>
      {loaded && sortedDocuments.length == 0 && pending.length == 0 &&
        <div className="text-sm text-muted-foreground">
          No documents yet — upload the owner&apos;s manual to get started.
        </div>
      }
      {(sortedDocuments.length > 0 || pending.length > 0) &&
        <div className="flex flex-col gap-1 w-full">
          {sortedDocuments.map((document) => (
            <div
              key={document.id}
              className="flex flex-row items-center gap-2 rounded-md border border-input px-3 py-2 text-sm"
            >
              <FileText className="h-4 w-4 shrink-0 opacity-60" />
              {attachments?.[document.attachmentId]?.url
                ? <a
                    href={attachments[document.attachmentId].url}
                    target="_blank"
                    rel="noreferrer"
                    className="truncate underline-offset-4 hover:underline"
                  >
                    {document.title}
                  </a>
                : <span className="truncate">{document.title}</span>
              }
              <span className="text-muted-foreground capitalize">{document.type}</span>
              <span className="ml-auto flex flex-row items-center gap-1">
                {document.status == "uploaded" &&
                  <span className="text-muted-foreground">uploaded</span>
                }
                {document.status == "processing" &&
                  <span className="flex flex-row items-center gap-1 text-muted-foreground">
                    <LoaderIcon className="h-4 w-4 animate-spin" />
                    processing
                  </span>
                }
                {document.status == "ready" &&
                  <span className="flex flex-row items-center gap-1 text-green-600">
                    <Check className="h-4 w-4" />
                    ready
                  </span>
                }
                {document.status == "error" &&
                  <>
                    <span
                      className="text-destructive cursor-help"
                      title={document.error || "processing failed"}
                    >
                      error
                    </span>
                    <button
                      type="button"
                      aria-label={`Retry processing ${document.title}`}
                      title="Retry processing"
                      onClick={() => ingestDocument(document.id)}
                    >
                      <RotateCw className="h-4 w-4 opacity-60 hover:opacity-100" />
                    </button>
                  </>
                }
              </span>
              <button
                type="button"
                aria-label={`Delete ${document.title}`}
                onClick={() => handleDelete(document)}
              >
                <Trash2 className="h-4 w-4 opacity-60 hover:opacity-100" />
              </button>
            </div>
          ))}
          {pending.map((upload) => (
            <div
              key={upload.id}
              className="flex flex-row items-center gap-2 rounded-md border border-input px-3 py-2 text-sm"
            >
              {upload.status == "uploading" && <LoaderIcon className="h-4 w-4 animate-spin" />}
              <span className="truncate">{upload.filename}</span>
              {upload.status == "error" &&
                <>
                  <span className="text-destructive">(upload failed)</span>
                  <button
                    type="button"
                    aria-label={`Dismiss ${upload.filename}`}
                    className="ml-auto"
                    onClick={() => setPending((previous) => previous.filter((p) => p.id != upload.id))}
                  >
                    <X className="h-4 w-4 opacity-60 hover:opacity-100" />
                  </button>
                </>
              }
            </div>
          ))}
        </div>
      }
      <div className="flex flex-row items-center gap-2">
        <Button
          variant="outline"
          // needs the internal user id (upload pathname prefix) before uploading
          disabled={!user?.id}
          onClick={() => fileInputRef.current?.click()}
        >
          <FileText />
          Upload manual / document
        </Button>
        <Label htmlFor="document-type" className="sr-only">Type</Label>
        <select
          id="document-type"
          className="flex h-9 rounded-md border border-input bg-transparent px-3 py-1 text-sm shadow-sm"
          value={docType}
          onChange={(e) => { setDocType(e.target.value as "manual" | "other"); setDocTypeTouched(true); }}
        >
          <option value="manual">Manual</option>
          <option value="other">Other</option>
        </select>
      </div>
      {/* no `capture` attribute on purpose, same as log-entry-dialog: mobile then
          offers Camera / Photo Library / Files in one tap */}
      <input
        ref={fileInputRef}
        type="file"
        accept="application/pdf,image/*"
        multiple
        className="hidden"
        onChange={pickFiles}
      />
    </div>
  )
}
