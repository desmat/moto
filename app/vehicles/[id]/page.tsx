"use client"

import { useRouter } from "next/navigation";
import { use, useState } from "react";
import NotFound from "@/app/not-found";
import JsonEditor from "@/components/json-editor";
import { useVehicle } from "@/hooks/use-vehicle";

export default function Page({
  params,
}: {
  params: Promise<{ id: string }>
}) {
  const router = useRouter();
  const id = decodeURIComponent(use(params).id);
  const { loaded, vehicles, save, delete: deleteVehicle } = useVehicle(id);
  const [saving, setSaving] = useState(false);

  const vehicle = loaded && vehicles && vehicles[id];

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
    <div className="_bg-orange-200 flex flex-col items-center w-full">
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
