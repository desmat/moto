"use client"

import { sortBy } from "@desmat/utils";
import { formatTimeFromNow } from "@desmat/utils/format";
import Link from "next/link";
import SetupVehicleDialog from "@/components/setup-vehicle-dialog";
import { Button } from "@/components/ui/button";
import { useVehicle } from "@/hooks/use-vehicle";
import { vehicleName } from "@/types/Vehicle";

export default function Page() {
  const {
    loaded: vehiclesLoaded,
    vehicles,
    add: addVehicle,
  } = useVehicle();

  console.log("app.vehicles.page.Page", { vehiclesLoaded, vehicles });

  return (
    <div className="_bg-yellow-200 flex flex-col gap-3 items-center w-full">
      <div className="flex flex-row gap-2">
        <b>Vehicles</b>
      </div>

      <SetupVehicleDialog onSubmit={addVehicle}>
        <Button disabled={!vehiclesLoaded}>Add Vehicle</Button>
      </SetupVehicleDialog>

      <div className="flex flex-col gap-3">
        {vehiclesLoaded && vehicles &&
          Object
            .values(vehicles)
            .sort(sortBy('createdAt', 'desc'))
            .map((v: any) => (
              <div
                key={v.id}
                className="flex flex-row gap-2 items-center group"
              >
                <Link
                  className="grid gap-0"
                  href={`/vehicles/${v.id}`}
                >
                  <span className="group-hover:underline">{vehicleName(v)}</span>
                  <div className="flex gap-2">
                    <span className="group-hover:underline opacity-40 capitalize-first">
                      <span className="capitalize">{v.type}</span>
                      {typeof (v.mileage) == "number" ? ` - ${v.mileage} km` : ""} - added {formatTimeFromNow(v.createdAt)}
                    </span>
                  </div>
                </Link>
              </div>
            ))
        }
      </div>
    </div>
  );
}
