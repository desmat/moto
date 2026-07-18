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

// longest prefix of `needle` that appears anywhere in `haystack` (monotone: once a
// prefix stops matching, longer ones can't)
function longestContainedPrefix(needle: string, haystack: string): number {
  let length = 0;
  for (let i = 1; i <= needle.length; i++) {
    if (!haystack.includes(needle.slice(0, i))) break;
    length = i;
  }
  return length;
}

// Resolve a free-text vehicle description (e.g. the "Honda CRF250 Rally - MLHMD..."
// a shop prints on a service receipt) against a user's vehicles. Model evidence is
// required but LOOSE: a long-enough prefix of the flattened model appearing in the
// description counts, so "CRF250RL" on the record still matches "CRF250 Rally" on the
// receipt (and vice versa). Longer model overlap outranks shorter; maker and year each
// add a point. Returns the single best match, or undefined when nothing matches or the
// top score is ambiguous (two bikes tie) — the caller should then fall back to asking
// the user rather than guessing.
export function matchVehicleDescription(description: string | undefined, vehicles: Vehicle[] | undefined): Vehicle | undefined {
  const flatDescription = flatten(description);
  if (!flatDescription) return undefined;

  const scored = (vehicles || [])
    .map((vehicle) => {
      const model = flatten(vehicle.model);
      const overlap = model ? longestContainedPrefix(model, flatDescription) : 0;
      // enough model evidence: at least 4 chars (or the whole model when shorter),
      // and at least 60% of it — "CRF250" carries "CRF250RL", "C" carries nothing
      const required = Math.min(model.length, Math.max(4, Math.ceil(model.length * 0.6)));

      return {
        vehicle,
        score: !model || overlap < required
          ? 0
          : overlap / model.length
            + (flatten(vehicle.maker) && flatDescription.includes(flatten(vehicle.maker)) ? 1 : 0)
            + (vehicle.year && flatDescription.includes(`${vehicle.year}`) ? 1 : 0),
      };
    })
    .filter((entry) => entry.score > 0)
    .sort((a, b) => b.score - a.score);

  if (!scored.length) return undefined;
  if (scored.length > 1 && scored[0].score == scored[1].score) return undefined; // ambiguous

  return scored[0].vehicle;
}
