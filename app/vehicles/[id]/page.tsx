"use client"

import { useRouter } from "next/navigation";
import { use, useState } from "react";
import NotFound from "@/app/not-found";
import JsonEditor from "@/components/json-editor";
import SetupVehicleDialog from "@/components/setup-vehicle-dialog";
import { Button } from "@/components/ui/button";
import { useVehicle } from "@/hooks/use-vehicle";

export default function Page({
  params,
}: {
  params: Promise<{ id: string }>
}) {
  const router = useRouter();
  const id = decodeURIComponent(use(params).id);
  const { loaded, vehicles, save, delete: deleteVehicle } = useVehicle(id);
  // the full list, for the single-vehicle affordance below (separate cached query)
  const { loaded: allLoaded, vehicles: allVehicles, add: addVehicle } = useVehicle();
  const [saving, setSaving] = useState(false);

  const vehicle = loaded && vehicles && vehicles[id];
  // single-vehicle mode: the nav links straight here instead of the Vehicles list (see
  // useNavItems in app-sidebar.tsx), so this page carries the "add another" affordance
  const isOnlyVehicle = allLoaded && allVehicles && Object.keys(allVehicles).length == 1;

  if (loaded && !vehicle) {
    return (
      <NotFound />
    )
  }

  const handleSave = async (value: any) => {
    setSaving(true);
    await save({ ...value, id });
    setSaving(false);
  }

  const handleDelete = () => {
    if (confirm("Are you sure?")) {
      deleteVehicle(id);
      router.push("/vehicles");
    }
  }

  return (
    <div className="_bg-orange-200 flex flex-col gap-3 items-center w-full">
      {isOnlyVehicle &&
        <SetupVehicleDialog onSubmit={addVehicle}>
          <Button variant="outline">Add another vehicle</Button>
        </SetupVehicleDialog>
      }
      <JsonEditor
        title="Vehicle"
        value={vehicle || undefined}
        saving={saving}
        onSave={handleSave}
        onDelete={handleDelete}
        onBack={() => router.push("/vehicles")}
      />
    </div>
  );
}
