'use client'
import moment from "moment"
import Link from "next/link"
import { Vehicle, VehicleComponentState } from "@/types/Vehicle"

// The vehicle page's "Current setup" section (S12): the vehicle.components snapshot —
// what's on the bike right now, per canonical component key. One row per entry: name,
// detail (what's installed; muted "—" until a replace-type action sets it), and the
// "last touched" line whose date links to the source log (a deleted source log leaves
// the snapshot standing by design, so that link may plain-404 — acceptable). Hidden
// entirely when the vehicle has no components yet.

export default function VehicleComponentsCard({ vehicle }: { vehicle?: Vehicle }) {
  const components = vehicle?.components;
  const entries: [string, VehicleComponentState][] = components
    ? Object.entries(components)
    : [];

  if (!entries.length) return null;

  // most recently touched first (YYYYMMDD string compare)
  entries.sort(([, a], [, b]) => `${b.date}`.localeCompare(`${a.date}`));

  const formatDate = (date: string) => {
    const parsed = moment(date, "YYYYMMDD", true);
    return parsed.isValid() ? parsed.format("ll") : date;
  };

  return (
    <div className="flex flex-col gap-3 items-center w-full max-w-[800px]">
      <div className="font-semibold">
        Current setup
      </div>
      <div className="flex flex-col gap-1 w-full">
        {entries.map(([key, component]) => (
          <div
            key={key}
            className="flex flex-row flex-wrap items-center gap-x-2 gap-y-0 rounded-md border border-input px-3 py-2 text-sm"
          >
            <span className="font-medium capitalize-first">{component.name || key}</span>
            {component.detail
              ? <span className="truncate">{component.detail}</span>
              : <span className="text-muted-foreground">—</span>
            }
            <span className="ml-auto text-muted-foreground whitespace-nowrap">
              last: {component.action}
              {" · "}
              <Link
                href={`/logs/${component.logId}`}
                className="underline-offset-4 hover:underline"
              >
                {formatDate(component.date)}
              </Link>
              {typeof component.mileage == "number" && ` · ${component.mileage} km`}
            </span>
          </div>
        ))}
      </div>
    </div>
  )
}
