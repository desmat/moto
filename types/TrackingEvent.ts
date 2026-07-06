export type TrackingEventType =
  | "log-created" | "log-deleted" | "log-updated"
  | "user-updated"
  | "vehicle-created" | "vehicle-deleted" | "vehicle-updated";

export type TrackingEventData = {
  userId: string,
  userIsAdmin: boolean,
} & Record<string, any>;
