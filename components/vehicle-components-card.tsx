'use client'
import moment from "moment"
import Link from "next/link"
import { Vehicle, VehicleComponentState } from "@/types/Vehicle"

// The vehicle page's "Current setup" section (S12): the vehicle.components snapshot —
// what's on the bike right now, per canonical component key. One row per entry: name,
// detail (what's installed, shown only when a replace-type action recorded one), and the
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

  // "replaced · …" reads better than "last: replace · …"; "other" says nothing
  // useful, so its rows show just the date/mileage. Unknown (hand-edited) actions pass
  // through as-is.
  const pastTense: Record<string, string> = {
    replace: "replaced", inspect: "inspected", adjust: "adjusted",
    lubricate: "lubricated", clean: "cleaned",
  };
  const actionLabel = (action: string) =>
    action == "other" ? "" : (pastTense[action] || action);

  return (
    <div className="flex flex-col gap-3 items-center w-full max-w-[800px]">
      <div className="font-semibold">
        Current setup
      </div>
      <div className="flex flex-col gap-1 w-full">
        {entries.map(([key, component]) => (
          <div
            key={key}
            className="flex flex-row items-center gap-x-2 rounded-md border border-input px-3 py-2 text-sm"
          >
            {/* one truncating block: "Front tire (replaced) - Anakee Wild"; the detail
                shows only when it says something the name doesn't (legacy/hand-edited
                snapshots may carry a name copy) */}
            <span className="flex-1 min-w-0 truncate">
              <span className="font-medium capitalize-first">{component.name || key}</span>
              {actionLabel(component.action) &&
                <span className="text-muted-foreground"> ({actionLabel(component.action)})</span>
              }
              {component.detail && component.detail.trim().toLowerCase() != `${component.name || key}`.trim().toLowerCase() &&
                <span> - {component.detail}</span>
              }
            </span>
            <span className="text-muted-foreground whitespace-nowrap">
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
