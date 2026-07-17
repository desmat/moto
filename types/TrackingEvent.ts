export type TrackingEventType =
  | "attachment-created" | "attachment-deleted" | "attachment-updated"
  | "document-created" | "document-deleted" | "document-ingested" | "document-updated"
  | "log-created" | "log-deleted" | "log-updated"
  | "odometer-ocr"
  | "receipt-ocr"
  | "schedule-created" | "schedule-deleted" | "schedule-extracted" | "schedule-updated"
  | "user-updated"
  | "vehicle-created" | "vehicle-deleted" | "vehicle-updated";

export type TrackingEventData = {
  userId: string,
  userIsAdmin: boolean,
} & Record<string, any>;
