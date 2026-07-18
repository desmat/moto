// Snapshot of one component's current state on the bike (S12), keyed under
// `vehicle.components` by the item's canonical key (CANONICAL_COMPONENT_KEYS, shared
// with LogItem / MaintenanceSchedule). Written by saveLog for `service`-type logs;
// rebuildable from logs (see services/admin.ts) and hand-editable via the JSON editor.
export type VehicleComponentState = {
  name: string;        // display name from the last touching item
  detail?: string;     // what's installed — set by replace-type actions only
  action: string;      // last action performed
  date: string;        // YYYYMMDD of that log
  mileage?: number;
  logId: string;
};

export type Vehicle = {
  id: string;
  createdAt: number;
  createdBy?: string;
  updatedAt?: number;
  updatedBy?: string;
  deletedAt?: number;
  userId: string;
  type: string; // e.g. "motorcycle", "scooter", "atv"
  maker: string;
  model: string;
  year: number;
  mileage?: number;
  modifications?: string[];
  components?: Record<string, VehicleComponentState>; // keyed by canonical item key
};

export const VehicleOptions = {
  lookups: {
    user: "userId",
  },
  hardDelete: true,
  fieldDisplayOrder: ["id", "createdAt", "createdBy", "updatedAt", "updatedBy", "userId", "type", "maker", "model", "year", "mileage", "modifications", "components"],
};

export const DefaultVehicleType = "motorcycle";

export const VehicleTypes = ["motorcycle", "scooter", "atv", "snowmobile", "other"];

export function vehicleName(vehicle?: Partial<Vehicle>) {
  if (!vehicle) return "";
  return [vehicle.year, vehicle.maker, vehicle.model].filter(Boolean).join(" ");
}
