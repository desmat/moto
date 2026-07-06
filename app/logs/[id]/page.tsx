"use client"

import { useRouter } from "next/navigation";
import { useState } from "react";
import NotFound from "@/app/not-found";
import JsonEditor from "@/components/json-editor";
import { useLog } from "@/hooks/use-log";

export default function Page({
  params,
}: {
  params: { id: string }
}) {
  const router = useRouter();
  const id = decodeURIComponent(params.id);
  const { loaded, logs, save, delete: deleteLog } = useLog({ id });
  const [saving, setSaving] = useState(false);

  const log = loaded && logs && logs[id];

  if (loaded && !log) {
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
      deleteLog(id);
      router.push("/logs");
    }
  }

  return (
    <div className="_bg-orange-200 flex flex-col items-center w-full">
      <JsonEditor
        title="Log"
        value={log || undefined}
        saving={saving}
        onSave={handleSave}
        onDelete={handleDelete}
        onBack={() => router.push("/logs")}
      />
    </div>
  );
}
