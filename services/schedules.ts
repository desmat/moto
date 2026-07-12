import { createStore } from "./stores";
import { MaintenanceSchedule } from "@/types/MaintenanceSchedule";
import { SessionUser } from "@/types/User";

const store = createStore({
  debug: true,
});

export async function getSchedules(query?: any): Promise<any> {
  console.log("services.schedules.getSchedules", { query });

  return store.schedules.find(query);
}

export async function getSchedule(id: string): Promise<MaintenanceSchedule | undefined> {
  console.log("services.schedules.getSchedule", { id });

  return store.schedules.get(id);
}

export async function saveSchedule(schedule: any, by: SessionUser): Promise<MaintenanceSchedule | undefined> {
  console.log("services.schedules.saveSchedule", { schedule, by });

  if (schedule.id && await store.schedules.exists(schedule.id)) {
    return store.schedules.update({ ...schedule, updatedBy: by.id });
  } else {
    return store.schedules.create({ ...schedule, userId: schedule.userId || by.id, createdBy: by.id });
  }
}

export async function deleteSchedule(id: string): Promise<MaintenanceSchedule | undefined> {
  console.log("services.schedules.deleteSchedule", { id });

  return store.schedules.delete(id);
}

// THE ONLY code path that sets status: "confirmed" (S0 review decision — see the S10
// plan's Design bullet). Every entrance funnels here so the one-confirmed-schedule-per-
// vehicle invariant always holds:
//   (a) PUT /api/schedules/[id] with a body status of "confirmed" applies its edits
//       keeping the stored status, then delegates here — it never writes "confirmed";
//   (b) POST /api/schedules arriving with status "confirmed" is created as "proposed"
//       then passed through here;
//   (c) confirming an already-confirmed schedule is an idempotent no-op (no update
//       write) — but the sweep below still runs, so the invariant is self-healing if a
//       crash between the promote and the sweep ever left two confirmed records behind.
// The promote happens BEFORE the sweep so a mid-flight failure can only leave an extra
// confirmed record (fixed by re-confirming), never zero.
export async function confirmSchedule(id: string, by: SessionUser): Promise<MaintenanceSchedule | undefined> {
  console.log("services.schedules.confirmSchedule", { id, by });

  const schedule = await store.schedules.get(id);

  if (!schedule) return undefined;

  const confirmed = schedule.status == "confirmed"
    ? schedule // (c) idempotent
    : await store.schedules.update({ ...schedule, status: "confirmed", updatedBy: by.id });

  // the swap: delete any OTHER confirmed schedule for the same vehicle (one confirmed
  // schedule per vehicle; the old one isn't versioned — deferred)
  const vehicleSchedules: MaintenanceSchedule[] = await store.schedules.find({ vehicle: schedule.vehicleId }) || [];
  for (const other of vehicleSchedules) {
    if (other.id != id && other.status == "confirmed") {
      console.log("services.schedules.confirmSchedule: deleting previously-confirmed schedule", { id: other.id, vehicleId: schedule.vehicleId });
      await store.schedules.delete(other.id);
    }
  }

  return confirmed;
}
