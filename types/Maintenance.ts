import { ScheduleItem } from "./MaintenanceSchedule";

// S14 maintenance status — COMPUTED shapes, not a stored entity (no Options, no store
// config): lib/maintenance.ts's computeMaintenanceStatus derives these on every read
// from the confirmed schedule + logs + vehicle. Nothing here ever lands in Redis.

// Status of one schedule item against the vehicle's history:
// - "overdue": strictly past the due km (current mileage > nextDue.km) or due date
// - "upcoming": at/within UPCOMING_KM_FRACTION of the interval or UPCOMING_DAYS of the
//   due date (lib/maintenance.ts), whichever axis trips first
// - "ok": due is known and comfortably ahead
// - "unknown": due can't be determined (never done with no firstAtKm, months-based with
//   no history, or a matching log without a mileage on a km-only item)
export type MaintenanceItemStatus = {
  item: ScheduleItem;
  lastDone?: { date: string, mileage?: number, logId: string };
  nextDue: { km?: number, date?: string, estimated?: boolean }; // `estimated` date via S15's projection
  status: "overdue" | "upcoming" | "ok" | "unknown";
  overdueByKm?: number; overdueByDays?: number;                 // for S16's severity ranking
};

export type VehicleMaintenance = {
  vehicleId: string;
  scheduleId?: string;               // absent → "no schedule" (distinct, not an error)
  lastReading?: { mileage: number, date: string };
  items: MaintenanceItemStatus[];
};
