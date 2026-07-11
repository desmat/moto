export type Attachment = {
  id: string;
  createdAt: number;
  createdBy?: string;
  updatedAt?: number;
  updatedBy?: string;
  deletedAt?: number;
  userId: string;
  logId?: string;        // set when the owning log is saved (S4); absent = pending/unlinked
  vehicleId?: string;    // denormalized from the log for future per-vehicle galleries
  url: string;           // blob public URL
  pathname: string;      // blob pathname, needed for deletion; always `moto/{userId}/...`
  contentType: string;
  size: number;
  filename: string;
};

export const AttachmentOptions = {
  lookups: {
    user: "userId",
    log: "logId",
    pathname: "pathname",
  },
  hardDelete: true,
  fieldDisplayOrder: ["id", "createdAt", "createdBy", "updatedAt", "updatedBy", "userId", "logId", "vehicleId", "url", "pathname", "contentType", "size", "filename"],
};
