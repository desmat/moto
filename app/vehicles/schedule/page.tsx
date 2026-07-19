'use client'

import Link from "next/link";
import { AppBreadcrumbs } from "@/components/app-breadcrumbs";
import MaintenanceTable from "@/components/maintenance-table";
import { Button } from "@/components/ui/button";
import { useMaintenance } from "@/hooks/use-maintenance";
import { useVehicle } from "@/hooks/use-vehicle";
import { VehicleMaintenance } from "@/types/Maintenance";
import { Vehicle, vehicleName } from "@/types/Vehicle";

export default function Page() {
  const { loaded: maintenanceLoaded, vehicles: maintenance } = useMaintenance();
  const { loaded: vehiclesLoaded, vehicles } = useVehicle();
  const loaded = maintenanceLoaded && vehiclesLoaded;
  const vehicleList: Vehicle[] = vehicles ? Object.values(vehicles) : [];
  const maintenanceByVehicle = new Map<string, VehicleMaintenance>(
    (maintenance || []).map((status) => [status.vehicleId, status]),
  );

  return (
    <div className="flex w-full flex-col items-center gap-6">
      {loaded &&
        <>
          <div className="w-full max-w-6xl"><AppBreadcrumbs /></div>
          <div className="w-full max-w-6xl">
            <h1 className="text-2xl font-semibold">Maintenance schedules</h1>
            <p className="text-sm text-muted-foreground">All vehicles</p>
          </div>

          {vehicleList.map((vehicle) => {
            const status = maintenanceByVehicle.get(vehicle.id);
            return (
              <section key={vehicle.id} data-maintenance-vehicle={vehicle.id} className="flex w-full max-w-6xl flex-col gap-3">
                <div className="flex flex-row items-center justify-between gap-3">
                  <h2 className="text-lg font-semibold">
                    <Link href={`/vehicles/${vehicle.id}/schedule`} className="hover:underline">{vehicleName(vehicle)}</Link>
                  </h2>
                  <Button variant="outline" size="sm" href={`/vehicles/${vehicle.id}/schedule`}>Vehicle schedule</Button>
                </div>
                {status?.scheduleId
                  ? <MaintenanceTable items={status.items} vehicle={vehicle} />
                  : <div className="rounded-md border border-input p-4 text-sm text-muted-foreground">
                      No confirmed maintenance schedule. <Link href={`/vehicles/${vehicle.id}#documents`} className="underline">Upload an owner&apos;s manual</Link>.
                    </div>
                }
              </section>
            );
          })}
        </>
      }
    </div>
  );
}
