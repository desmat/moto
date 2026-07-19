'use client'

import { sortBy } from "@desmat/utils";
import Link from "next/link";
import { use } from "react";
import NotFound from "@/app/not-found";
import { AppBreadcrumbs } from "@/components/app-breadcrumbs";
import MaintenanceTable from "@/components/maintenance-table";
import ScheduleReview from "@/components/schedule-review";
import { Button } from "@/components/ui/button";
import { useDocument } from "@/hooks/use-document";
import { useMaintenance } from "@/hooks/use-maintenance";
import { useSchedule } from "@/hooks/use-schedule";
import { useVehicle } from "@/hooks/use-vehicle";
import { MaintenanceSchedule } from "@/types/MaintenanceSchedule";
import { vehicleName } from "@/types/Vehicle";
import { useState } from "react";

export default function Page({ params }: { params: Promise<{ id: string }> }) {
  const id = decodeURIComponent(use(params).id);
  const { loaded: vehicleLoaded, vehicles } = useVehicle(id);
  const { loaded: maintenanceLoaded, vehicles: maintenance } = useMaintenance({ vehicleId: id });
  const { loaded: schedulesLoaded, schedules } = useSchedule({ vehicleId: id });
  const { loaded: documentsLoaded, documents } = useDocument({ vehicleId: id });
  const [editingSchedule, setEditingSchedule] = useState(false);

  const vehicle = vehicleLoaded && vehicles?.[id];
  const status = maintenance?.[0];
  const confirmed = schedulesLoaded && schedules
    ? (Object.values(schedules) as MaintenanceSchedule[]).sort(sortBy("createdAt")).find((schedule) => schedule.status == "confirmed")
    : undefined;
  const document = confirmed?.documentId && documents?.[confirmed.documentId];
  const loaded = vehicleLoaded && maintenanceLoaded && schedulesLoaded && documentsLoaded;

  if (vehicleLoaded && !vehicle) return <NotFound />;

  return (
    <div className="flex w-full flex-col items-center gap-5">
      {loaded && vehicle && status &&
        <>
          <div className="w-full max-w-6xl"><AppBreadcrumbs /></div>
          <div className="flex w-full max-w-6xl flex-col gap-2 sm:flex-row sm:items-start sm:justify-between">
            <div>
              <h1 className="text-2xl font-semibold">Maintenance schedule</h1>
              <div className="text-sm text-muted-foreground">
                <Link href={`/vehicles/${id}`} className="font-medium text-foreground hover:underline">{vehicleName(vehicle)}</Link>
                {document &&
                  <> · from <Link href={`/vehicles/${id}#documents`} className="hover:underline">{document.title}</Link></>
                }
              </div>
            </div>
            {confirmed && !editingSchedule &&
              <Button variant="outline" onClick={() => setEditingSchedule(true)}>Edit schedule</Button>
            }
          </div>

          {editingSchedule &&
            <ScheduleReview
              vehicleId={id}
              startEditingConfirmed
              onEditingConfirmedChange={setEditingSchedule}
            />
          }

          {status.scheduleId
            ? <div className="w-full max-w-6xl"><MaintenanceTable items={status.items} vehicle={vehicle} /></div>
            : <div className="rounded-md border border-input p-5 text-center">
                No confirmed maintenance schedule yet. <Link href={`/vehicles/${id}#documents`} className="underline">Upload an owner&apos;s manual</Link> to create one.
              </div>
          }
        </>
      }
    </div>
  );
}
