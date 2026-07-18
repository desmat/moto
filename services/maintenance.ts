import moment from "moment";
import { getLogs } from "./logs";
import { getSchedules } from "./schedules";
import { getVehicle } from "./vehicles";
import { computeMaintenanceStatus } from "@/lib/maintenance";
import { VehicleMaintenance } from "@/types/Maintenance";
import { MaintenanceSchedule } from "@/types/MaintenanceSchedule";

// S14 assembly: fetch what the pure engine needs and call it. The determinism lives in
// lib/maintenance.ts (client-safe, store-free); this module is the ONLY side of the
// split that touches services — client components must never import it. S15 threads
// mileage projection in here.

// undefined = vehicle missing or not owned by userId (routes 404/403 before calling,
// so this is defense-in-depth). No confirmed schedule is NOT an error — the engine
// returns the distinct scheduleId-less shape.
export async function getVehicleMaintenance(vehicleId: string, userId: string): Promise<VehicleMaintenance | undefined> {
  console.log("services.maintenance.getVehicleMaintenance", { vehicleId, userId });

  const vehicle = await getVehicle(vehicleId);

  if (!vehicle || vehicle.userId != userId) return undefined;

  const [schedules, logs] = await Promise.all([
    getSchedules({ vehicle: vehicleId }),
    getLogs({ vehicle: vehicleId }),
  ]);

  // confirmed schedules only (at most one exists — confirmSchedule's invariant); a
  // dangling proposal is inert by design
  const schedule = ((schedules || []) as MaintenanceSchedule[])
    .find((candidate) => candidate.status == "confirmed" && candidate.userId == userId);

  return computeMaintenanceStatus({
    schedule,
    logs: logs || [],
    vehicle,
    now: moment().format("YYYYMMDD"),
  });
}
