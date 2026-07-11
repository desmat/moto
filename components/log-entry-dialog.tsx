'use client'
import { sortBy } from "@desmat/utils"
import { FileText, LoaderIcon, Paperclip, X } from "lucide-react"
import { useEffect, useRef, useState } from "react"
import { Button } from "@/components/ui/button"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Textarea } from "@/components/ui/textarea"
import { useAttachment } from "@/hooks/use-attachment"
import { useUserRecord } from "@/hooks/use-user"
import { uploadFile } from "@/lib/upload"
import { LogTypeJournal, LogTypeMileage } from "@/types/Log"
import { Vehicle, vehicleName } from "@/types/Vehicle"

export type LogEntryMode = "journal" | "mileage" | "custom";

// a picked file's lifecycle in the dialog: `id` is a throwaway local key while
// uploading, then the Attachment record's id once the upload + record POST land
type PendingAttachment = {
  id: string,
  url: string,
  contentType: string,
  filename: string,
  status: "uploading" | "ready" | "error",
};

const ModeCopy: Record<LogEntryMode, { title: string, description: string }> = {
  journal: {
    title: "Journal Entry",
    description: "Record your thoughts, observations, issues to look into, work done, etc.",
  },
  mileage: {
    title: "Current Mileage",
    description: "Record the current odometer reading. This will also update the vehicle's mileage.",
  },
  custom: {
    title: "Custom Entry",
    description: "Record any other kind of entry: oil change, chain adjustment, new tires, etc.",
  },
};

export default function LogEntryDialog({
  mode,
  vehicles,
  defaultVehicleId,
  defaultType,
  onSubmit,
  children,
}: {
  mode: LogEntryMode,
  vehicles?: Vehicle[],
  defaultVehicleId?: string,
  defaultType?: string,
  onSubmit?: (log: { vehicleId: string, type: string, entry: string, attachmentIds: string[] }) => void,
  children?: React.ReactNode,
}) {
  const { user } = useUserRecord();
  const { add: addAttachment, delete: deleteAttachment } = useAttachment();
  const [open, setOpen] = useState(false);
  const [vehicleId, setVehicleId] = useState("");
  const [type, setType] = useState("");
  const [entry, setEntry] = useState("");
  const [attachments, setAttachments] = useState<PendingAttachment[]>([]);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const sortedVehicles = vehicles ? Object.values(vehicles).sort(sortBy('createdAt')) : [];

  useEffect(() => {
    if (open) {
      setVehicleId(defaultVehicleId || sortedVehicles[0]?.id || "");
      setType(defaultType || "");
      setEntry("");
      // uploads from a previous open are NOT deleted here: their records may already be
      // linked to a saved log, and unlinked ones are tolerated orphans (deferred cleanup)
      setAttachments([]);
    }
  }, [open]);

  const uploadPickedFile = async (file: File) => {
    // throwaway local key until the Attachment record exists
    const localId = `local-${Date.now()}-${Math.random().toString(16).slice(2, 10)}`;

    setAttachments((previous) => [...previous, {
      id: localId,
      url: "",
      contentType: file.type,
      filename: file.name,
      status: "uploading",
    }]);

    try {
      // user.id is the INTERNAL short-uuid id (useUserRecord) -- see lib/upload.ts
      const uploadedBlob = await uploadFile(file, user.id);
      const attachment = await addAttachment({ ...uploadedBlob });
      console.log("components.log-entry-dialog.uploadPickedFile", { uploadedBlob, attachment });

      setAttachments((previous) => previous.map((a) => a.id == localId
        ? {
          id: attachment.id,
          url: attachment.url,
          contentType: attachment.contentType,
          filename: attachment.filename,
          status: "ready",
        }
        : a));
    } catch (error) {
      console.error("components.log-entry-dialog.uploadPickedFile", { error });
      setAttachments((previous) => previous.map((a) => a.id == localId
        ? { ...a, status: "error" }
        : a));
    }
  }

  const pickFiles = (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = Array.from(e.target.files || []);
    // reset so picking the same file again re-fires onChange
    e.target.value = "";
    files.forEach(uploadPickedFile);
  }

  const removeAttachment = (attachment: PendingAttachment) => {
    // "error" entries never got a record; "ready" ones delete record + blob
    if (attachment.status == "ready") {
      deleteAttachment(attachment.id);
    }
    setAttachments((previous) => previous.filter((a) => a.id != attachment.id));
  }

  const readyAttachments = attachments.filter((a) => a.status == "ready");
  const uploading = attachments.some((a) => a.status == "uploading");

  // journal/custom entries are savable with attachments and no text (the pic IS the
  // entry); mileage still requires a numeric reading; never save mid-upload
  const canSubmit = !!vehicleId
    && !uploading
    && (mode == "mileage"
      ? Number.isFinite(parseFloat(entry))
      : entry?.trim().length > 0 || readyAttachments.length > 0)
    && (mode != "custom" || type?.trim().length > 0);

  const submit = () => {
    if (!canSubmit) return;

    onSubmit && onSubmit({
      vehicleId,
      type: mode == "journal" ? LogTypeJournal : mode == "mileage" ? LogTypeMileage : type,
      entry,
      attachmentIds: readyAttachments.map((a) => a.id),
    });

    setOpen(false);
  }

  const handleKeyDown = (e: any) => {
    if (e.key == "Enter" && e.metaKey && canSubmit) {
      submit();
    }
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        {children}
      </DialogTrigger>
      <DialogContent className="sm:max-w-[425px]" >
        <DialogHeader>
          <DialogTitle>
            {ModeCopy[mode].title}
          </DialogTitle>
          <DialogDescription>
            {ModeCopy[mode].description}
          </DialogDescription>
        </DialogHeader>
        <div className="flex flex-col gap-3">
          {sortedVehicles.length > 1 &&
            <div className="flex flex-col gap-1">
              <Label htmlFor="log-vehicle">Vehicle</Label>
              <select
                id="log-vehicle"
                className="flex h-9 w-full rounded-md border border-input bg-transparent px-3 py-1 text-sm shadow-sm"
                value={vehicleId}
                onChange={(e) => setVehicleId(e.target.value)}
              >
                {sortedVehicles.map((v: Vehicle) => (
                  <option key={v.id} value={v.id}>{vehicleName(v)}</option>
                ))}
              </select>
            </div>
          }
          {mode == "custom" &&
            <div className="flex flex-col gap-1">
              <Label htmlFor="log-type">Type</Label>
              <Input
                id="log-type"
                placeholder="oil change, new tires, ..."
                value={type}
                onChange={(e) => setType(e.target.value)}
              />
            </div>
          }
          {mode == "mileage" &&
            <div className="flex flex-col gap-1">
              <Label htmlFor="log-entry">Odometer</Label>
              <Input
                id="log-entry"
                type="number"
                placeholder="18250"
                value={entry}
                onKeyDown={handleKeyDown}
                onChange={(e) => setEntry(e.target.value)}
              />
            </div>
          }
          {mode != "mileage" &&
            <div className="flex flex-col gap-1">
              <Label htmlFor="log-entry">Entry</Label>
              <Textarea
                id="log-entry"
                className="w-full h-[8rem]"
                value={entry}
                onKeyDown={handleKeyDown}
                onChange={(e) => setEntry(e.target.value)}
              />
            </div>
          }
          <div className="flex flex-col gap-2">
            {attachments.length > 0 &&
              <div className="flex flex-row flex-wrap gap-2">
                {attachments.map((attachment) => (
                  <div
                    key={attachment.id}
                    className="flex flex-row items-center gap-1 rounded-md border border-input p-1 text-sm"
                  >
                    {attachment.status == "uploading" &&
                      <LoaderIcon className="animate-spin" />
                    }
                    {attachment.status == "ready" && attachment.contentType?.startsWith("image/") &&
                      // eslint-disable-next-line @next/next/no-img-element
                      <img
                        src={attachment.url}
                        alt={attachment.filename}
                        className="h-14 w-14 rounded object-cover"
                      />
                    }
                    {attachment.status == "ready" && !attachment.contentType?.startsWith("image/") &&
                      <FileText className="h-4 w-4" />
                    }
                    {(attachment.status != "ready" || !attachment.contentType?.startsWith("image/")) &&
                      <span className="max-w-[8rem] truncate">
                        {attachment.filename}
                      </span>
                    }
                    {attachment.status == "error" &&
                      <span className="text-destructive">(failed)</span>
                    }
                    {attachment.status != "uploading" &&
                      <button
                        type="button"
                        aria-label={`Remove ${attachment.filename}`}
                        onClick={() => removeAttachment(attachment)}
                      >
                        <X className="h-4 w-4 opacity-60 hover:opacity-100" />
                      </button>
                    }
                  </div>
                ))}
              </div>
            }
            <Button
              variant="outline"
              // needs the internal user id (upload pathname prefix) before uploading
              disabled={!user?.id}
              onClick={() => fileInputRef.current?.click()}
            >
              <Paperclip />
              Add photo / file
            </Button>
            {/* no `capture` attribute on purpose: mobile then offers Camera / Photo
                Library / Files in one tap, instead of forcing straight to camera */}
            <input
              ref={fileInputRef}
              type="file"
              accept="image/*,application/pdf"
              multiple
              className="hidden"
              onChange={pickFiles}
            />
          </div>
        </div>
        <DialogFooter className="flex flex-row items-center justify-center sm:items-center sm:justify-center space-x-2">
          <Button variant="secondary" onClick={() => setOpen(false)}>
            Close
          </Button>
          <Button type="submit" onClick={submit} disabled={!canSubmit}>
            Save
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
