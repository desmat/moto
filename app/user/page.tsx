"use client"

import { useState } from "react";
import JsonEditor from "@/components/json-editor";
import { useUserRecord } from "@/hooks/use-user";

export default function Page() {
  const { loaded, user, save } = useUserRecord();
  const [saving, setSaving] = useState(false);

  const handleSave = async (value: any) => {
    setSaving(true);
    await save(value);
    setSaving(false);
  }

  return (
    <div className="_bg-orange-200 flex flex-col items-center w-full">
      <JsonEditor
        title="User"
        value={(loaded && user) || undefined}
        saving={saving}
        onSave={handleSave}
      />
    </div>
  );
}
