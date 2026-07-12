// A Document is a *reference* to an uploaded file (via attachmentId) plus ingestion
// lifecycle state. Receipts are NOT documents — only "manual" | "other" for now.
export type Document = {
  id: string;
  createdAt: number;
  createdBy?: string;
  updatedAt?: number;
  updatedBy?: string;
  deletedAt?: number;
  userId: string;
  vehicleId: string;
  attachmentId: string;
  type: "manual" | "other";
  title: string;                // defaults to the uploaded filename; editable
  // state machine owned by the service layer: uploaded → processing → ready | error
  // (S9 drives the transitions; new records are always created in "uploaded")
  status: "uploaded" | "processing" | "ready" | "error";
  error?: string;               // populated when status == "error"
  pageCount?: number;           // set by ingestion (S9)
};

export const DocumentOptions = {
  lookups: {
    user: "userId",
    vehicle: "vehicleId",
  },
  hardDelete: true,
  fieldDisplayOrder: ["id", "createdAt", "createdBy", "updatedAt", "updatedBy", "userId", "vehicleId", "attachmentId", "type", "title", "status", "error", "pageCount"],
};

export const DocumentTypes = ["manual", "other"];
