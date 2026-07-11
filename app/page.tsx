'use client'

import { sortBy } from "@desmat/utils";
import { formatTimeFromNow } from "@desmat/utils/format";
import { Gauge, NotebookPen, Paperclip, Wrench } from "lucide-react";
import Link from "next/link";
import LogEntryDialog, { LogEntryMode } from "@/components/log-entry-dialog";
import DailyGauge from "@/components/charts/DailyGauge";
import DailySummaryChart from "@/components/charts/DailySummaryChart";
import HourlyPatternChart from "@/components/charts/HourlyPatternChart";
import { Button } from "@/components/ui/button";
import { useLog } from "@/hooks/use-log";
import { useUser } from "@/hooks/use-user";
import { useVehicle } from "@/hooks/use-vehicle";
import { LogTypeJournal, LogTypeMileage } from "@/types/Log";
import { vehicleName } from "@/types/Vehicle";

function logIcon(type: string) {
  return type == LogTypeJournal
    ? NotebookPen
    : type == LogTypeMileage
      ? Gauge
      : Wrench;
}

export default function Page() {
  const { user, isLoaded: userLoaded } = useUser();
  const {
    loaded: vehiclesLoaded,
    vehicles,
  } = useVehicle();
  const {
    loaded: logsLoaded,
    logs,
    add: addLog,
  } = useLog();

  const loaded = userLoaded && vehiclesLoaded && logsLoaded;

  const latestLogs = logsLoaded && logs &&
    Object.values(logs)
      .sort(sortBy('createdAt', 'desc'));

  // default the record dialogs to the most recently logged vehicle
  const defaultVehicleId = (latestLogs && latestLogs[0] as any)?.vehicleId;

  // the most recently used custom log types, as quick-record shortcuts under the
  // main Record buttons (latestLogs is already sorted newest-first, so keeping each
  // type's first occurrence keeps its most recent position)
  const recentCustomTypes = (latestLogs || [])
    .map((log: any) => log.type as string)
    .filter((type: string, index: number, types: string[]) =>
      type != LogTypeJournal && type != LogTypeMileage && types.indexOf(type) == index)
    .slice(0, 3);

  console.log("app.page.Page", { loaded, vehicles, logs });

  const recordLog = async (log: { vehicleId: string, type: string, entry: string, attachmentIds: string[] }) => {
    const ret = await addLog(log);
    console.log("app.page.Page.recordLog", { ret });
  }

  const recordButtons: { mode: LogEntryMode, label: string }[] = [
    { mode: "journal", label: "Journal Entry" },
    { mode: "mileage", label: "Current Mileage" },
    { mode: "custom", label: "Custom" },
  ];

  return (
    <div className="_bg-yellow-200 flex flex-col gap-4 items-center w-full">
      {/* TODO dummy placeholder -- AI-generated maintenance insights will go here */}
      <div className="_flex flex-row gap-3 mb-2 -mt-2 pl-[1rem]">
        <span className="ml-[-1rem] text-[1.2rem]">🤖 </span>
        <span className="italic">Looking good! Keep logging your rides and maintenance and I&apos;ll keep an eye on what&apos;s due next.</span>
      </div>

      <div className="flex flex-row gap-2">
        <b>Record</b>
      </div>
      <div className="flex flex-col gap-1">
        <div className="flex flex-col md:flex-row justify-center gap-1">
          {recordButtons.map(({ mode, label }) => (
            <LogEntryDialog
              key={mode}
              mode={mode}
              vehicles={vehicles && Object.values(vehicles)}
              defaultVehicleId={defaultVehicleId}
              onSubmit={recordLog}
            >
              <Button
                disabled={!loaded}
                href="#"
              >
                {label}
              </Button>
            </LogEntryDialog>
          ))}
        </div>
        {recentCustomTypes.length > 0 &&
          <div className="flex flex-col md:flex-row justify-center gap-1">
            {recentCustomTypes.map((type: string) => (
              <LogEntryDialog
                key={type}
                mode="custom"
                defaultType={type}
                vehicles={vehicles && Object.values(vehicles)}
                defaultVehicleId={defaultVehicleId}
                onSubmit={recordLog}
              >
                <Button
                  variant="outline"
                  disabled={!loaded}
                  href="#"
                >
                  <span className="capitalize">{type}</span>
                </Button>
              </LogEntryDialog>
            ))}
          </div>
        }
      </div>

      <div className="flex flex-row gap-2">
        <b>Charts</b>
      </div>
      <div className="_bg-orange-200 flex flex-col lg:flex-row items-center justify-items-center">
        <div className="_bg-pink-200 flex flex-col my-[-40px] mx-[-20px]">
          <DailyGauge />
        </div>
        <div className="_bg-yellow-200 flex flex-col my-[-10px] mx-[-20px]">
          <HourlyPatternChart />
        </div>
      </div>
      <div className="_bg-pink-200 flex flex-col w-full">
        <DailySummaryChart />
      </div>

      <div className="flex flex-col items-center gap-2">
        <div className="flex flex-row gap-2 relative">
          <b>Entries</b>
        </div>
        <div className="flex flex-col gap-3 max-w-full">
          {latestLogs && latestLogs.slice(0, 5).map((log: any) => {
            const Icon = logIcon(log.type);
            const vehicle = vehicles && vehicles[log.vehicleId];

            return (
              <div
                key={log.id}
                className="flex flex-row gap-2 items-top group"
              >
                <Link
                  className="grid gap-0"
                  href={`/logs/${log.id}`}
                >
                  <span className="group-hover:underline capitalize-first _flex _items-top gap-0">
                    <Icon className="h-[1.2rem] float-left mt-[0.15rem] ml-[-0.35rem] mr-[0.15rem]" />
                    {/* photo-only entries (S4) have no text: fall back to a placeholder so the row isn't blank */}
                    <span className="capitalize-first">{log.entry?.trim() || "(photo)"}</span>
                    {log.attachmentCount > 0 &&
                      <Paperclip
                        aria-label="Has attachments"
                        className="inline h-[0.9rem] ml-[0.1rem] mt-[-0.15rem] opacity-40"
                      />
                    }
                  </span>
                  <div className="flex gap-1">
                    <span className="group-hover:underline opacity-40">
                      <span className="capitalize">{log.type}</span>
                      {vehicle ? ` - ${vehicleName(vehicle)}` : ""} - {formatTimeFromNow(log.createdAt)}
                    </span>
                  </div>
                </Link>
              </div>
            );
          })}
          {latestLogs && latestLogs.length > 5 &&
            <Button
              variant="link"
              href="/logs"
            >
              (More)
            </Button>
          }
        </div>
      </div>
    </div>
  );
}
