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
import { useAuth, useUserRecord } from "@/hooks/use-user"
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

// the odometer-OCR call's lifecycle (mileage mode only): fires automatically when a
// photo finishes uploading, and only ever decorates the field — the input stays an
// ordinary editable input no matter what state this is in
type OcrStatus = "idle" | "reading" | "done" | "low" | "failed";

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
  const { getToken } = useAuth();
  const { add: addAttachment, delete: deleteAttachment } = useAttachment();
  const [open, setOpen] = useState(false);
  const [vehicleId, setVehicleId] = useState("");
  const [type, setType] = useState("");
  const [entry, setEntry] = useState("");
  const [attachments, setAttachments] = useState<PendingAttachment[]>([]);
  const [ocr, setOcr] = useState<OcrStatus>("idle");
  // first Save tap on a lower-than-current reading arms the inline "Save anyway"
  // confirm; the second tap actually submits
  const [saveWarningArmed, setSaveWarningArmed] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);
  // one OCR shot per attachment: guards the effect below against re-firing when the
  // attachments array changes for unrelated reasons (another upload, a removal, ...)
  const lastOcrAttachmentId = useRef<string | null>(null);

  const sortedVehicles = vehicles ? Object.values(vehicles).sort(sortBy('createdAt')) : [];

  useEffect(() => {
    if (open) {
      setVehicleId(defaultVehicleId || sortedVehicles[0]?.id || "");
      setType(defaultType || "");
      setEntry("");
      // uploads from a previous open are NOT deleted here: their records may already be
      // linked to a saved log, and unlinked ones are tolerated orphans (deferred cleanup)
      setAttachments([]);
      setOcr("idle");
      setSaveWarningArmed(false);
      lastOcrAttachmentId.current = null;
    }
  }, [open]);

  // changing the reading or the target vehicle invalidates an armed "Save anyway"
  useEffect(() => {
    setSaveWarningArmed(false);
  }, [entry, vehicleId]);

  const readOdometer = async (attachmentId: string) => {
    lastOcrAttachmentId.current = attachmentId;
    setOcr("reading");

    try {
      const token = await getToken();
      const res = await fetch("/api/ai/odometer", {
        headers: { Authorization: `Bearer ${token}` },
        body: JSON.stringify({ attachmentId }),
        method: "POST",
      });

      if (!res.ok) {
        throw `${res.statusText} (${res.status})`;
      }

      const { result } = await res.json();
      console.log("components.log-entry-dialog.readOdometer", { attachmentId, result });

      if (result?.reading != null) {
        setEntry(String(result.reading));
        setOcr(result.confidence == "high" ? "done" : "low");
      } else {
        setOcr("failed");
      }
    } catch (error) {
      // OCR is an accelerator, not a gate: any failure just leaves manual entry
      console.error("components.log-entry-dialog.readOdometer", { attachmentId, error });
      setOcr("failed");
    }
  }

  // auto-fire OCR (mileage mode only) when the newest attachment finishes uploading and
  // is an image, as long as the user hasn't already typed a reading
  useEffect(() => {
    if (mode != "mileage") return;

    const newest = attachments[attachments.length - 1];
    if (!newest || newest.status != "ready") return;
    if (!newest.contentType?.startsWith("image/")) return;
    if (newest.id == lastOcrAttachmentId.current) return;
    if (entry != "") return;

    readOdometer(newest.id);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [attachments]);

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

  // sanity check: a reading below the vehicle's current mileage is usually a wrong
  // bike or a mis-OCR, but corrections are legitimate — warn inline, don't block
  const currentVehicleMileage = sortedVehicles.find((v) => v.id == vehicleId)?.mileage ?? 0;
  const mileageBelowCurrent = mode == "mileage"
    && Number.isFinite(parseFloat(entry))
    && parseFloat(entry) < currentVehicleMileage;

  const submit = () => {
    if (!canSubmit) return;

    if (mileageBelowCurrent && !saveWarningArmed) {
      setSaveWarningArmed(true);
      return;
    }

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
                // a manual edit takes over from the OCR: clear its hint
                onChange={(e) => { setEntry(e.target.value); setOcr("idle"); }}
              />
              {/* one status line: the armed save warning wins over the OCR hint */}
              {saveWarningArmed &&
                <span className="text-sm text-amber-600">
                  Lower than the current {currentVehicleMileage.toLocaleString()} — save anyway?
                </span>
              }
              {!saveWarningArmed && ocr == "reading" &&
                <span className="flex flex-row items-center gap-1 text-sm text-muted-foreground">
                  <LoaderIcon className="h-4 w-4 animate-spin" />
                  Reading odometer…
                </span>
              }
              {!saveWarningArmed && ocr == "done" &&
                <span className="text-sm text-muted-foreground">
                  ✨ read from photo — check and save
                </span>
              }
              {!saveWarningArmed && ocr == "low" &&
                <span className="text-sm text-amber-600">
                  ✨ best guess from photo — please verify
                </span>
              }
              {!saveWarningArmed && ocr == "failed" &&
                <span className="text-sm text-muted-foreground">
                  Couldn&apos;t read the odometer — enter it manually
                </span>
              }
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
            {saveWarningArmed ? "Save anyway" : "Save"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
