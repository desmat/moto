'use client'

import moment from "moment";
import Link from "next/link";
import LogEntryDialog from "@/components/log-entry-dialog";
import ServiceLogDialog from "@/components/service-log-dialog";
import { Button } from "@/components/ui/button";
import { useLog } from "@/hooks/use-log";
import { useMaintenance } from "@/hooks/use-maintenance";
import { useVehicle } from "@/hooks/use-vehicle";
import { rankMaintenanceItems, RankedMaintenanceItem } from "@/lib/maintenance";
import { STALE_DAYS } from "@/lib/mileage";
import { VehicleMaintenance } from "@/types/Maintenance";
import { Vehicle, vehicleName } from "@/types/Vehicle";

// S16: the "next due" dashboard card — replaces the placeholder 🤖 line with the top 3
// overdue/upcoming items across the whole garage (lib/maintenance.ts's ranking, shared
// with S17). Every row is actionable: it opens the S11 service-log dialog pre-filled
// with the item and vehicle, and saving invalidates ["maintenance"] (use-log.tsx) so
// the row clears without a reload.
//
// Below the ranked list, ADDITIVE per-vehicle funnel lines (deliberately not a
// garage-wide state cascade — one schedule-less bike must never mask the list):
// - no confirmed schedule → upload-the-manual link to the vehicle page (S8 documents);
// - schedule but stale/absent odometer signal → mileage nudge (log-entry-dialog).

const DATE_FORMAT = "YYYYMMDD";

// "overdue by 150 km" / "due in ~3 weeks" / "due in ~800 km". Approximation ("~") marks
// estimated dates (S15 projections) and all km-gap phrasings — the reader should never
// mistake a projection for a promise. Overdue always speaks in actuals (S14's rule:
// overdue is never declared on projected values).
function duePhrase(entry: RankedMaintenanceItem): string {
  const { status } = entry;

  if (status.status == "overdue") {
    if (status.overdueByKm != undefined) return `overdue by ${status.overdueByKm.toLocaleString()} km`;
    if (status.overdueByDays != undefined) return `overdue by ${moment.duration(status.overdueByDays, "days").humanize()}`;
    return "overdue";
  }

  if (status.nextDue.date) {
    const days = moment(status.nextDue.date, DATE_FORMAT).diff(moment().startOf("day"), "days");
    const approx = status.nextDue.estimated ? "~" : "";
    if (days <= 0) return `due ${approx}now`;
    return `due in ${approx}${moment.duration(days, "days").humanize()}`;
  }

  if (entry.kmGap != undefined) return `due in ~${entry.kmGap.toLocaleString()} km`;

  return "due soon";
}

export default function NextDueCard() {
  const { loaded: maintenanceLoaded, vehicles: maintenance } = useMaintenance();
  const { loaded: vehiclesLoaded, vehicles } = useVehicle();
  const { add: addLog } = useLog();

  const loaded = maintenanceLoaded && vehiclesLoaded;
  const vehicleList: Vehicle[] = vehicles ? Object.values(vehicles) : [];
  const nameOf = (vehicleId: string) => vehicleName(vehicles?.[vehicleId]);

  // extra structured fields (date/items/mileage/...) ride along untouched, same as the
  // dashboard's other record flows
  const recordLog = async (log: any) => {
    const ret = await addLog(log);
    console.log("components.next-due-card.recordLog", { ret });
  };

  const ranked = rankMaintenanceItems(maintenance);
  const due = ranked.filter((entry) => entry.status.status == "overdue" || entry.status.status == "upcoming");
  const top = due.slice(0, 3);

  // funnel lines (additive, per vehicle)
  const today = moment().startOf("day");
  const noSchedule: VehicleMaintenance[] = (maintenance || []).filter((vehicle) => !vehicle.scheduleId);
  const staleMileage: VehicleMaintenance[] = (maintenance || []).filter((vehicle) => vehicle.scheduleId
    && (!vehicle.lastReading
      || today.diff(moment(vehicle.lastReading.date, DATE_FORMAT), "days") > STALE_DAYS
      || vehicle.projection?.confidence == "none"));

  // "next up" for the all-caught-up state: the ranked list keeps ok items in order
  // right after the due ones, so the first ok entry is the soonest
  const nextUp = due.length == 0 ? ranked.find((entry) => entry.status.status == "ok") : undefined;
  const allCaughtUp = loaded && due.length == 0 && noSchedule.length == 0 && staleMileage.length == 0;

  return (
    <div className="flex flex-col items-center gap-1 mb-2 -mt-2 w-full max-w-2xl">
      {!loaded &&
        /* loading: the old placeholder sentence doubles as skeleton text so the
           dashboard doesn't rearrange while the statuses load */
        <div className="flex flex-row gap-3">
          <span className="text-[1.2rem]">🤖 </span>
          <span className="italic opacity-50 animate-pulse">Looking good! Keep logging your rides and maintenance and I&apos;ll keep an eye on what&apos;s due next.</span>
        </div>
      }

      {loaded && top.map((entry) => (
        <ServiceLogDialog
          key={`${entry.vehicleId}-${entry.status.item.key}-${entry.status.item.action}`}
          vehicles={vehicleList}
          defaultVehicleId={entry.vehicleId}
          defaultItems={[{
            key: entry.status.item.key,
            name: entry.status.item.name,
            action: entry.status.item.action,
          }]}
          onSubmit={recordLog}
        >
          <button
            type="button"
            className="flex flex-row items-baseline gap-2 text-left group"
          >
            <span aria-hidden="true">⚠️</span>
            <span className="min-w-0">
              <span className="group-hover:underline">
                <span className="capitalize-first">{entry.status.item.name}</span> {duePhrase(entry)}
              </span>
              <span className="opacity-40"> — {nameOf(entry.vehicleId)}</span>
            </span>
          </button>
        </ServiceLogDialog>
      ))}
      {loaded && top.length > 0 &&
        /* S17's full-schedule route; when items span vehicles this follows the top
           (most urgent) item's vehicle */
        <Button
          variant="link"
          href={`/vehicles/${top[0].vehicleId}/schedule`}
          className="self-center h-auto p-0"
        >
          (More)
        </Button>
      }

      {allCaughtUp &&
        <div className="flex flex-row gap-3">
          <span className="text-[1.2rem]">🤖 </span>
          <span className="italic">
            All caught up ✓
            {nextUp && ` — next up: ${nextUp.status.item.name} ${duePhrase(nextUp)} (${nameOf(nextUp.vehicleId)})`}
          </span>
        </div>
      }

      {loaded && noSchedule.map((vehicle) => (
        <div key={vehicle.vehicleId} className="flex flex-row gap-3">
          <span className="text-[1.2rem]">🤖 </span>
          <Link
            href={`/vehicles/${vehicle.vehicleId}`}
            className="text-left opacity-70 hover:opacity-100 hover:underline"
          >
            {/* one template-literal child on purpose: SWC's JSX transform drops the
                space between an expression and a following text segment here */}
            {`Upload the owner's manual for your ${nameOf(vehicle.vehicleId)} and I'll track what's due`}
          </Link>
        </div>
      ))}
      {loaded && staleMileage.map((vehicle) => (
        <div key={vehicle.vehicleId} className="flex flex-row gap-3">
          <span className="text-[1.2rem]">🤖 </span>
          <LogEntryDialog
            mode="mileage"
            vehicles={vehicleList}
            defaultVehicleId={vehicle.vehicleId}
            onSubmit={recordLog}
          >
            <button
              type="button"
              className="text-left opacity-70 hover:opacity-100 hover:underline"
            >
              When did you last check the odometer on your {nameOf(vehicle.vehicleId)}?
            </button>
          </LogEntryDialog>
        </div>
      ))}
    </div>
  );
}
