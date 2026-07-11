"use client"

import { Paperclip } from "lucide-react";
import { useRouter } from "next/navigation";
import { use, useState } from "react";
import NotFound from "@/app/not-found";
import JsonEditor from "@/components/json-editor";
import { useAttachment } from "@/hooks/use-attachment";
import { useLog } from "@/hooks/use-log";

export default function Page({
  params,
}: {
  params: Promise<{ id: string }>
}) {
  const router = useRouter();
  const id = decodeURIComponent(use(params).id);
  const { loaded, logs, save, delete: deleteLog } = useLog({ id });
  const { attachments } = useAttachment({ logId: id });
  const [saving, setSaving] = useState(false);

  const log = loaded && logs && logs[id];
  const attachmentList: any[] = attachments ? Object.values(attachments) : [];

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
      {/* read-only attachments strip (view/download): add/remove waits for real forms,
          see docs/form-patterns.md */}
      {attachmentList.length > 0 &&
        <div className="flex flex-row flex-wrap gap-2 items-center max-w-full mb-4">
          {attachmentList.map((attachment: any) => (
            attachment.contentType?.startsWith("image/")
              ? (
                <a
                  key={attachment.id}
                  href={attachment.url}
                  target="_blank"
                  rel="noreferrer"
                  title={attachment.filename}
                >
                  {/* full-size blob URL as thumbnail for now; resizing is deferred */}
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img
                    src={attachment.url}
                    alt={attachment.filename}
                    className="h-24 max-w-full rounded-md object-cover"
                  />
                </a>
              )
              : (
                <a
                  key={attachment.id}
                  href={attachment.url}
                  target="_blank"
                  rel="noreferrer"
                  download={attachment.filename}
                  className="flex flex-row gap-1 items-center rounded-md border px-2 py-1 text-sm hover:underline"
                >
                  <Paperclip className="h-4 w-4 opacity-40" />
                  {attachment.filename}
                </a>
              )
          ))}
        </div>
      }
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
