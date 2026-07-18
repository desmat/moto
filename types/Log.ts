// One line item on a service log (S11): a component plus what was done to it. `key`
// shares the CANONICAL_COMPONENT_KEYS vocabulary with MaintenanceSchedule's items so
// Phase 3's matcher can reconcile receipts against the schedule by key equality.
export type LogItem = {
  key: string;            // canonical slug (see CANONICAL_COMPONENT_KEYS)
  name: string;           // display name as the receipt/user phrases it
  action: "replace" | "inspect" | "adjust" | "lubricate" | "clean" | "other";
  note?: string;          // brand/part detail ("Michelin Anakee Adventure")
  cost?: number;
};

export type Log = {
  id: string;
  createdAt: number;
  createdBy?: string;
  updatedAt?: number;
  updatedBy?: string;
  deletedAt?: number;
  userId: string;
  vehicleId: string;
  type: string; // "journal", "mileage", "service", or a user-entered custom type
  date: string; // YYYYMMDD
  entry: string;
  // structured service-log fields (S11) -- all optional, so every pre-existing log
  // remains valid untouched
  items?: LogItem[];
  mileage?: number;       // odometer reading, e.g. printed on a service receipt
  vendor?: string;
  totalCost?: number;
  // S14: schedule keys the write-time classifier mapped this journal/custom log's free
  // text onto (["chain"] for "lubed the chain"), so the maintenance engine only ever
  // does key equality at read time. Possibly empty (= classified, nothing matched);
  // absent = never classified. Hand-correctable via the JSON editor — saveLog skips
  // re-classification whenever the incoming payload already carries scheduleKeys.
  scheduleKeys?: string[];
};

export const LogOptions = {
  lookups: {
    user: "userId",
    vehicle: "vehicleId",
    date: "date",
    type: "type",
  },
  hardDelete: true,
  fieldDisplayOrder: ["id", "createdAt", "createdBy", "updatedAt", "updatedBy", "userId", "vehicleId", "type", "date", "entry", "vendor", "mileage", "items", "totalCost", "scheduleKeys"],
};

// built-in log types; anything else is a user-entered custom type
export const LogTypeJournal = "journal";
export const LogTypeMileage = "mileage";
export const LogTypeService = "service";
