'use client'

import moment from "moment";
import { ChevronDown } from "lucide-react";
import Link from "next/link";
import { useState } from "react";
import ServiceLogDialog from "@/components/service-log-dialog";
import { Button } from "@/components/ui/button";
import { useLog } from "@/hooks/use-log";
import { compareRankedItems, RankedMaintenanceItem } from "@/lib/maintenance";
import { MaintenanceItemStatus } from "@/types/Maintenance";
import { Vehicle } from "@/types/Vehicle";

const DATE_FORMAT = "YYYYMMDD";

const statusStyle: Record<MaintenanceItemStatus["status"], { dot: string, label: string }> = {
  overdue: { dot: "bg-red-500", label: "Overdue" },
  upcoming: { dot: "bg-amber-500", label: "Upcoming" },
  ok: { dot: "bg-emerald-500", label: "Okay" },
  unknown: { dot: "bg-slate-400", label: "Unknown" },
};

function StatusBadge({ status }: { status: MaintenanceItemStatus["status"] }) {
  const style = statusStyle[status];
  return (
    <span className="inline-flex items-center gap-2 whitespace-nowrap text-sm">
      <span aria-hidden="true" className={`h-2.5 w-2.5 rounded-full ${style.dot}`} />
      {style.label}
    </span>
  );
}

function intervalText(status: MaintenanceItemStatus): string {
  const parts = [
    status.item.intervalKm && `${status.item.intervalKm.toLocaleString()} km`,
    status.item.intervalMonths && `${status.item.intervalMonths} mo`,
  ].filter(Boolean);
  if (parts.length) return parts.join(" / ");
  if (status.item.firstAtKm != undefined) return `First at ${status.item.firstAtKm.toLocaleString()} km`;
  return "—";
}

function DateMileage({ date, mileage, estimated = false }: { date?: string, mileage?: number, estimated?: boolean }) {
  if (!date && mileage == undefined) return <span>—</span>;
  return (
    <span className="flex flex-col">
      {mileage != undefined && <span>{mileage.toLocaleString()} km</span>}
      {date && <span>{estimated ? "~" : ""}{moment(date, DATE_FORMAT).format("MMM D, YYYY")}</span>}
    </span>
  );
}

function MaintenanceRow({ entry, vehicle, unknown }: {
  entry: RankedMaintenanceItem,
  vehicle: Vehicle,
  unknown: boolean,
}) {
  const { add: addLog } = useLog();
  const status = entry.status;
  const defaultItems = [{
    key: status.item.key,
    name: status.item.name,
    action: status.item.action,
  }];

  return (
    <div
      data-maintenance-key={status.item.key}
      className="grid grid-cols-1 gap-3 border-b border-input px-3 py-4 last:border-b-0 md:grid-cols-[7rem_minmax(11rem,1.5fr)_9rem_10rem_10rem_auto] md:items-center"
    >
      <div><span className="mb-1 block text-xs text-muted-foreground md:hidden">Status</span><StatusBadge status={status.status} /></div>
      <div>
        <span className="mb-1 block text-xs text-muted-foreground md:hidden">Item</span>
        <div className="font-medium capitalize-first">{status.item.name}</div>
        <div className="text-sm capitalize text-muted-foreground">{status.item.action}</div>
      </div>
      <div className="text-sm">
        <span className="mb-1 block text-xs text-muted-foreground md:hidden">Interval</span>
        {intervalText(status)}
      </div>
      <div className="text-sm">
        <span className="mb-1 block text-xs text-muted-foreground md:hidden">Last done</span>
        {status.lastDone
          ? <Link href={`/logs/${status.lastDone.logId}`} className="hover:underline"><DateMileage date={status.lastDone.date} mileage={status.lastDone.mileage} /></Link>
          : <span>—</span>
        }
      </div>
      <div className="text-sm">
        <span className="mb-1 block text-xs text-muted-foreground md:hidden">Next due</span>
        <DateMileage date={status.nextDue.date} mileage={status.nextDue.km} estimated={status.nextDue.estimated} />
      </div>
      <ServiceLogDialog
        vehicles={[vehicle]}
        defaultVehicleId={vehicle.id}
        defaultItems={defaultItems}
        historyDatePrompt={unknown}
        onSubmit={addLog}
      >
        <Button variant={unknown ? "outline" : "default"} size="sm" className="h-auto min-h-7 whitespace-normal py-1.5">
          {unknown ? "When did you last do this?" : "Log it"}
        </Button>
      </ServiceLogDialog>
    </div>
  );
}

export default function MaintenanceTable({ items, vehicle }: { items: MaintenanceItemStatus[], vehicle: Vehicle }) {
  const [unknownExpanded, setUnknownExpanded] = useState(false);
  const ranked: RankedMaintenanceItem[] = (items || []).map((status) => ({
    vehicleId: vehicle.id,
    status,
    ...status.nextDue.km != undefined && vehicle.mileage != undefined
      && { kmGap: status.nextDue.km - vehicle.mileage },
  })).sort(compareRankedItems);
  const known = ranked.filter((entry) => entry.status.status != "unknown");
  const unknown = ranked.filter((entry) => entry.status.status == "unknown");

  const header = (
    <div className="hidden grid-cols-[7rem_minmax(11rem,1.5fr)_9rem_10rem_10rem_auto] gap-3 border-b border-input bg-muted/40 px-3 py-2 text-xs font-medium text-muted-foreground md:grid">
      <span>Status</span><span>Item</span><span>Interval</span><span>Last done</span><span>Next due</span><span>Action</span>
    </div>
  );

  return (
    <div className="w-full overflow-hidden rounded-md border border-input">
      {header}
      {known.map((entry) => <MaintenanceRow key={`${entry.status.item.key}-${entry.status.item.action}`} entry={entry} vehicle={vehicle} unknown={false} />)}
      {unknown.length > 0 &&
        <>
          <button
            type="button"
            aria-expanded={unknownExpanded}
            aria-controls={`unknown-history-${vehicle.id}`}
            onClick={() => setUnknownExpanded((expanded) => !expanded)}
            className="flex w-full items-center justify-between border-y border-input bg-muted/50 px-3 py-2 text-left text-sm font-semibold first:border-t-0 hover:bg-muted"
          >
            <span>No history ({unknown.length} items)</span>
            <ChevronDown className={`h-4 w-4 transition-transform ${unknownExpanded ? "rotate-180" : ""}`} />
          </button>
          {unknownExpanded &&
            <div id={`unknown-history-${vehicle.id}`}>
              {unknown.map((entry) => <MaintenanceRow key={`${entry.status.item.key}-${entry.status.item.action}`} entry={entry} vehicle={vehicle} unknown />)}
            </div>
          }
        </>
      }
    </div>
  );
}
