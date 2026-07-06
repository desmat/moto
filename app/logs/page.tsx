"use client"

import { sortBy } from "@desmat/utils";
import { formatTimeFromNow } from "@desmat/utils/format";
import Link from "next/link";
import * as React from "react"
import { Button } from "@/components/ui/button"
import { defaultCount, useLog } from "@/hooks/use-log";
import { useVehicle } from "@/hooks/use-vehicle";
import { vehicleName } from "@/types/Vehicle";

export default function Page() {
  const [pageSize, setPageSize] = React.useState(defaultCount);
  const {
    loaded: logsLoaded,
    logs,
    delete: deleteLog,
    hasMore: hasMoreLogs,
  } = useLog({ count: pageSize });
  const { vehicles } = useVehicle();

  console.log("app.logs.page.Page", { logsLoaded, logs });

  const loadMore = () => {
    setPageSize((pageSize) => pageSize * 2);
  }

  return (
    <div className="_bg-yellow-200 flex flex-col gap-3 items-center w-full">
      <div className="flex flex-row gap-2">
        <b>Logs</b>
      </div>

      <div className="flex flex-col gap-2">
        {logsLoaded && logs &&
          Object
            .values(logs)
            .sort(sortBy('createdAt', 'desc'))
            .map((log: any) => {
              const vehicle = vehicles && vehicles[log.vehicleId];

              return (
                <div
                  key={log.id}
                  className="flex flex-row gap-2 items-center group"
                >
                  <Link
                    className="grid gap-0"
                    href={`/logs/${log.id}`}
                  >
                    <span className="group-hover:underline capitalize-first">{log.entry?.trim()}</span>
                    <div className="flex gap-2">
                      <span className="group-hover:underline opacity-40">
                        <span className="capitalize">{log.type}</span>
                        {vehicle ? ` - ${vehicleName(vehicle)}` : ""} - {formatTimeFromNow(log.createdAt)}
                      </span>
                      <Button
                        variant="outline"
                        size="sm"
                        href="#"
                        onClick={(e) => { e.preventDefault(); deleteLog(log.id); }}
                        disabled={log.id == "NEW"}
                        className="opacity-40 group-hover:opacity-100"
                      >
                        Delete
                      </Button>
                    </div>
                  </Link>
                </div>
              );
            })
        }
      </div>
      {hasMoreLogs &&
        <Button
          variant="outline"
          size="sm"
          type="button"
          onClick={loadMore}
        >
          Load More
        </Button>
      }
    </div>
  );
}
