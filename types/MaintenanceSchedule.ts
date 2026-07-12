// One maintenance-schedule row: a component plus what to do to it and how often.
// Extraction (S10) mints these from the owner's manual; S11's receipts and Phase 3's
// matcher reconcile against the same `key` vocabulary.
export type ScheduleItem = {
  key: string;            // canonical slug (see CANONICAL_COMPONENT_KEYS)
  name: string;           // display name as the manual phrases it
  action: "replace" | "inspect" | "adjust" | "lubricate" | "clean" | "other";
  intervalKm?: number;
  intervalMonths?: number;
  firstAtKm?: number;     // break-in/first-service items
  notes?: string;         // the manual's original phrasing (units, conditions, caveats)
};

export const ScheduleItemActions = ["replace", "inspect", "adjust", "lubricate", "clean", "other"] as const;

// Proposed vs. confirmed is a status field, not separate entities: extraction creates a
// `proposed` record the user reviews; confirming flips it — and deletes any previously-
// confirmed schedule for the vehicle (one confirmed schedule per vehicle; see
// services/schedules.ts's confirmSchedule, the ONLY code path that sets "confirmed").
// Phase 3 computations read confirmed schedules only, so a dangling proposal is inert.
export type MaintenanceSchedule = {
  id: string;
  createdAt: number;
  createdBy?: string;
  updatedAt?: number;
  updatedBy?: string;
  deletedAt?: number;
  userId: string;
  vehicleId: string;
  documentId?: string;               // absent for "generic"/hand-entered schedules
  source: "manual" | "generic" | "user";
  status: "proposed" | "confirmed";
  items: ScheduleItem[];
};

export const MaintenanceScheduleOptions = {
  lookups: {
    user: "userId",
    vehicle: "vehicleId",
  },
  hardDelete: true,
  fieldDisplayOrder: ["id", "createdAt", "createdBy", "updatedAt", "updatedBy", "userId", "vehicleId", "documentId", "source", "status", "items"],
};

// The preferred `key` vocabulary, interpolated into the S10 manual-extraction prompt and
// (S11) the receipt prompt so independently-extracted keys converge ("front tyre",
// "fr tire" → "front-tire"). Strict-mode JSON schemas can't use a dynamic enum, so this
// is guidance for the model plus server-side slugify/validation — keys outside this list
// are allowed, they just won't reconcile as nicely (Phase 3's matcher problem).
export const CANONICAL_COMPONENT_KEYS = [
  "engine-oil",
  "oil-filter",
  "air-filter",
  "fuel-line",
  "spark-plugs",
  "valve-clearance",
  "coolant",
  "chain",
  "clutch",
  "throttle",
  "front-tire",
  "rear-tire",
  "wheels",
  "brake-fluid",
  "brake-pads-front",
  "brake-pads-rear",
  "brake-hoses",
  "suspension-front",
  "suspension-rear",
  "steering-bearings",
  "battery",
  "lights",
];
