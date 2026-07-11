export type TrackingEventType =
  | "attachment-created" | "attachment-deleted" | "attachment-updated"
  | "log-created" | "log-deleted" | "log-updated"
  | "odometer-ocr"
  | "user-updated"
  | "vehicle-created" | "vehicle-deleted" | "vehicle-updated";

export type TrackingEventData = {
  userId: string,
  userIsAdmin: boolean,
} & Record<string, any>;
