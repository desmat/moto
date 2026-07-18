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

// lowercase alphanumerics only, so punctuation/spacing differences never block a match
// ("GSX-R750" on the record vs "GSXR750" on a receipt)
function flatten(value: unknown): string {
  return `${value ?? ""}`.toLowerCase().replace(/[^a-z0-9]/g, "");
}

// Resolve a free-text vehicle description (e.g. the "2021 HONDA CB500X" a shop prints
// on a service receipt) against a user's vehicles. The model appearing in the
// description is required; maker and year each add a point. Returns the single best
// match, or undefined when nothing matches or the top score is ambiguous (two bikes
// tie) — the caller should then fall back to asking the user rather than guessing.
export function matchVehicleDescription(description: string | undefined, vehicles: Vehicle[] | undefined): Vehicle | undefined {
  const flatDescription = flatten(description);
  if (!flatDescription) return undefined;

  const scored = (vehicles || [])
    .filter((vehicle) => {
      const model = flatten(vehicle.model);
      return model && flatDescription.includes(model);
    })
    .map((vehicle) => ({
      vehicle,
      score: 1
        + (flatten(vehicle.maker) && flatDescription.includes(flatten(vehicle.maker)) ? 1 : 0)
        + (vehicle.year && flatDescription.includes(`${vehicle.year}`) ? 1 : 0),
    }))
    .sort((a, b) => b.score - a.score);

  if (!scored.length) return undefined;
  if (scored.length > 1 && scored[0].score == scored[1].score) return undefined; // ambiguous

  return scored[0].vehicle;
}
