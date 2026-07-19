'use client'
import { sortBy } from "@desmat/utils"
import moment from "moment"
import { FileText, LoaderIcon, Paperclip, X } from "lucide-react"
import { useEffect, useRef, useState } from "react"
import ExtractedRows, { ExtractedRowsColumn } from "@/components/extracted-rows"
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
import { LogItem, LogTypeService } from "@/types/Log"
import { matchVehicleDescription, Vehicle, vehicleName } from "@/types/Vehicle"

// The S11 "Service / Receipt" record dialog: a structured service-log form
// (vendor/date/mileage/line items/costs) that a receipt photo pre-fills via
// POST /api/ai/receipt. The scan is an accelerator, not a gate — the form works fully
// manually, and an unreadable receipt degrades to the empty editable form with the
// photo still attached.
//
// NOTE: the attachment-strip code (PendingAttachment lifecycle, upload-on-pick,
// thumbnails, remove) is deliberately DUPLICATED from components/log-entry-dialog.tsx
// rather than extracted into a shared module — extraction would have destabilized the
// shipped S4/S6 dialog for ~90 lines of savings; revisit if a third dialog needs it.

// a picked file's lifecycle in the dialog: `id` is a throwaway local key while
// uploading, then the Attachment record's id once the upload + record POST land
type PendingAttachment = {
  id: string,
  url: string,
  contentType: string,
  filename: string,
  status: "uploading" | "ready" | "error",
};

// the receipt-OCR call's lifecycle: fires automatically when a photo finishes
// uploading, and only ever decorates the form — every field stays an ordinary editable
// input no matter what state this is in. "low" = the gate said the receipt isn't
// legible (fields stay empty/manual, photo stays attached).
type OcrStatus = "idle" | "reading" | "done" | "low" | "failed";

const itemActions = ["replace", "inspect", "adjust", "lubricate", "clean", "other"];

const itemColumns: ExtractedRowsColumn[] = [
  { label: "Key", field: "key", type: "text", width: "7rem" },
  { label: "Name", field: "name", type: "text" },
  { label: "Action", field: "action", type: "select", options: itemActions, width: "7rem" },
  { label: "Note", field: "note", type: "text" },
  { label: "Cost", field: "cost", type: "number", width: "5.5rem" },
];

export default function ServiceLogDialog({
  vehicles,
  defaultVehicleId,
  defaultItems,
  onSubmit,
  children,
}: {
  vehicles?: Vehicle[],
  // S16: pre-select the picker (the dashboard card knows which bike the due item
  // belongs to). Pre-selecting is the only change — everything else about the picker
  // (Save gated on a chosen vehicle, receipt-scan resolution, mismatch warning) stands.
  defaultVehicleId?: string,
  // S16: pre-populate the line-items table (the due item's key/name/action); the rows
  // stay fully editable and save through the normal path
  defaultItems?: Partial<LogItem>[],
  onSubmit?: (log: {
    vehicleId: string,
    type: string,
    date: string,
    entry: string,
    items: LogItem[],
    mileage?: number,
    vendor?: string,
    totalCost?: number,
    attachmentIds: string[],
  }) => void,
  children?: React.ReactNode,
}) {
  const { user } = useUserRecord();
  const { getToken } = useAuth();
  const { add: addAttachment, delete: deleteAttachment } = useAttachment();
  const [open, setOpen] = useState(false);
  const [vehicleId, setVehicleId] = useState("");
  const [vendor, setVendor] = useState("");
  const [date, setDate] = useState(""); // YYYY-MM-DD (the input's format)
  const [mileage, setMileage] = useState("");
  const [totalCost, setTotalCost] = useState("");
  const [rows, setRows] = useState<any[]>([]);
  const [entry, setEntry] = useState("");
  const [attachments, setAttachments] = useState<PendingAttachment[]>([]);
  const [ocr, setOcr] = useState<OcrStatus>("idle");
  // the receipt printed a vehicle description that matched NONE of the user's vehicles
  // (or matched ambiguously) — surfaced as a warning so a wrong-bike save gets caught
  const [vehicleMismatch, setVehicleMismatch] = useState("");
  // first Save tap on a lower-than-current mileage arms the inline "Save anyway"
  // confirm; the second tap actually submits
  const [saveWarningArmed, setSaveWarningArmed] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);
  // ids the OCR has already been given: the effect below re-fires only when a NEW ready
  // image appears (a fresh page of the receipt), never on unrelated changes (removals,
  // non-image uploads). A multi-page receipt is one pic per page (S11b), so every fire
  // sends the FULL current set of ready images in one call.
  const ocrSentIds = useRef<Set<string>>(new Set());
  // the OCR only REPLACES the items table while the user hasn't touched it
  const rowsEdited = useRef(false);
  // a receipt-resolved vehicle auto-selects the picker ONLY while the user hasn't
  // touched it — an explicit selection is never overridden
  const vehicleEdited = useRef(false);
  const dateEdited = useRef(false);
  // scalar fields the USER typed into (vendor/mileage/totalCost) — a re-fired
  // extraction (more pages added) may overwrite its own earlier prefills, never these
  const fieldEdited = useRef<Set<string>>(new Set());

  const sortedVehicles = vehicles ? Object.values(vehicles).sort(sortBy('createdAt')) : [];

  useEffect(() => {
    if (open) {
      // deliberately UNSELECTED with multiple vehicles (no "most recent" guess): the
      // receipt scan auto-selects on a match, and Save stays disabled until a vehicle
      // is chosen — a receipt can't silently land on the wrong bike. An explicit
      // defaultVehicleId (S16's card, where the user tapped a specific bike's item)
      // pre-selects; Save gating and scan behavior are unchanged.
      setVehicleId(
        (defaultVehicleId && sortedVehicles.some((v) => v.id == defaultVehicleId) && defaultVehicleId)
        || (sortedVehicles.length == 1 ? sortedVehicles[0].id : ""));
      setVendor("");
      setDate(moment().format("YYYY-MM-DD")); // default today
      setMileage("");
      setTotalCost("");
      // S16: rows pre-populated from the tapped due item (copies — ExtractedRows edits
      // rows in place via onChange, never the caller's array)
      setRows(defaultItems?.length ? defaultItems.map((item) => ({ ...item })) : []);
      setEntry("");
      // uploads from a previous open are NOT deleted here: their records may already be
      // linked to a saved log, and unlinked ones are tolerated orphans (deferred cleanup)
      setAttachments([]);
      setOcr("idle");
      setVehicleMismatch("");
      setSaveWarningArmed(false);
      ocrSentIds.current = new Set();
      rowsEdited.current = false;
      vehicleEdited.current = false;
      dateEdited.current = false;
      fieldEdited.current = new Set();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  // changing the reading or the target vehicle invalidates an armed "Save anyway"
  useEffect(() => {
    setSaveWarningArmed(false);
  }, [mileage, vehicleId]);

  const readReceipt = async (attachmentIds: string[]) => {
    ocrSentIds.current = new Set(attachmentIds);
    setOcr("reading");

    try {
      const token = await getToken();
      const res = await fetch("/api/ai/receipt", {
        headers: { Authorization: `Bearer ${token}` },
        body: JSON.stringify({ attachmentIds }),
        method: "POST",
      });

      if (!res.ok) {
        throw `${res.statusText} (${res.status})`;
      }

      const { result } = await res.json();
      console.log("components.service-log-dialog.readReceipt", { attachmentIds, result });

      if (!result?.receipt_clearly_visible) {
        setOcr("low");
        return;
      }

      // pre-fill ONLY the fields the USER hasn't touched — a scan never clobbers manual
      // input. Fields a previous (partial, fewer-pages) extraction filled ARE fair game
      // for this fuller one: adding a page re-runs OCR over the whole set, and e.g. the
      // real grand total often lives on the last-added page.
      if (result.vendor && !fieldEdited.current.has("vendor")) setVendor(result.vendor);
      if (result.date && !dateEdited.current) {
        const parsed = moment(result.date, "YYYYMMDD", true);
        if (parsed.isValid()) setDate(parsed.format("YYYY-MM-DD"));
      }
      if (result.mileage != null && !fieldEdited.current.has("mileage")) setMileage(String(result.mileage));
      if (result.totalCost != null && !fieldEdited.current.has("totalCost")) setTotalCost(String(result.totalCost));
      // resolve the vehicle printed on the receipt against the user's garage:
      // unambiguous match → auto-select (unless the user already picked); no/ambiguous
      // match → warn, so the receipt doesn't get saved onto the wrong bike
      if (result.vehicle) {
        const matched = matchVehicleDescription(result.vehicle, sortedVehicles);
        if (matched) {
          setVehicleMismatch("");
          if (!vehicleEdited.current) setVehicleId(matched.id);
        } else {
          setVehicleMismatch(result.vehicle);
        }
      }
      if (Array.isArray(result.items) && result.items.length && !rowsEdited.current) {
        setRows(result.items);
      }
      setOcr("done");
    } catch (error) {
      // OCR is an accelerator, not a gate: any failure just leaves manual entry
      console.error("components.service-log-dialog.readReceipt", { attachmentIds, error });
      setOcr("failed");
    }
  }

  // auto-fire OCR when a NEW image finishes uploading: send the FULL set of ready
  // images (one receipt, page per pic) in one call. Waits until no image upload is in
  // flight so a multi-file pick lands as ONE extraction over all pages, not one per
  // page; removals alone never re-fire.
  useEffect(() => {
    const imageAttachments = attachments.filter((a) => a.contentType?.startsWith("image/"));
    if (imageAttachments.some((a) => a.status == "uploading")) return;

    const readyIds = imageAttachments.filter((a) => a.status == "ready").map((a) => a.id);
    if (!readyIds.length) return;
    if (!readyIds.some((id) => !ocrSentIds.current.has(id))) return;

    readReceipt(readyIds);
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
      console.log("components.service-log-dialog.uploadPickedFile", { uploadedBlob, attachment });

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
      console.error("components.service-log-dialog.uploadPickedFile", { error });
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

  // rows with any actual content — blank add-row placeholders don't count
  const filledRows = rows.filter((row) => `${row.key || ""}`.trim() || `${row.name || ""}`.trim());

  // savable with at least one line item, some notes text, or an attachment (the photo
  // IS the record); never save mid-upload
  const canSubmit = !!vehicleId
    && !uploading
    && (filledRows.length > 0 || entry.trim().length > 0 || readyAttachments.length > 0);

  // sanity check: a mileage below the vehicle's current value is usually a wrong bike
  // or a mis-OCR, but backdated receipts are legitimate — warn inline, don't block
  // (server-side the update is monotonic anyway, see services/logs.ts)
  const currentVehicleMileage = sortedVehicles.find((v) => v.id == vehicleId)?.mileage ?? 0;
  const mileageBelowCurrent = Number.isFinite(parseFloat(mileage))
    && parseFloat(mileage) < currentVehicleMileage;

  const submit = () => {
    if (!canSubmit) return;

    if (mileageBelowCurrent && !saveWarningArmed) {
      setSaveWarningArmed(true);
      return;
    }

    const items: LogItem[] = filledRows.map((row) => ({
      key: `${row.key || row.name}`.trim().toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, ""),
      name: `${row.name || row.key}`.trim(),
      action: itemActions.includes(row.action) ? row.action : "other",
      ...`${row.note || ""}`.trim() && { note: `${row.note}`.trim() },
      ...Number.isFinite(Number(row.cost)) && row.cost !== "" && row.cost != null && { cost: Number(row.cost) },
    }));

    onSubmit && onSubmit({
      vehicleId,
      type: LogTypeService,
      date: date ? moment(date, "YYYY-MM-DD").format("YYYYMMDD") : moment().format("YYYYMMDD"),
      entry,
      items,
      ...Number.isFinite(parseFloat(mileage)) && { mileage: parseFloat(mileage) },
      ...vendor.trim() && { vendor: vendor.trim() },
      ...Number.isFinite(parseFloat(totalCost)) && { totalCost: parseFloat(totalCost) },
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
      <DialogContent className="sm:max-w-[640px] max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>
            Service / Receipt
          </DialogTitle>
          <DialogDescription>
            Record service work — snap the shop receipt to pre-fill the details, or enter them manually.
          </DialogDescription>
        </DialogHeader>
        <div className="flex flex-col gap-3">
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
              Add receipt photo / file
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
          {sortedVehicles.length > 1 &&
            <div className="flex flex-col gap-1">
              <Label htmlFor="service-vehicle">Vehicle</Label>
              <select
                id="service-vehicle"
                className="flex h-9 w-full rounded-md border border-input bg-transparent px-3 py-1 text-sm shadow-sm"
                value={vehicleId}
                onChange={(e) => { vehicleEdited.current = true; setVehicleId(e.target.value); }}
              >
                <option value="" disabled>Select a vehicle…</option>
                {sortedVehicles.map((v: Vehicle) => (
                  <option key={v.id} value={v.id}>{vehicleName(v)}</option>
                ))}
              </select>
            </div>
          }
          <div className="flex flex-col sm:flex-row gap-3">
            <div className="flex flex-col gap-1 flex-1">
              <Label htmlFor="service-vendor">Vendor</Label>
              <Input
                id="service-vendor"
                placeholder="shop / vendor"
                value={vendor}
                onKeyDown={handleKeyDown}
                onChange={(e) => { fieldEdited.current.add("vendor"); setVendor(e.target.value); }}
              />
            </div>
            <div className="flex flex-col gap-1">
              <Label htmlFor="service-date">Date</Label>
              <Input
                id="service-date"
                type="date"
                value={date}
                onKeyDown={handleKeyDown}
                onChange={(e) => { setDate(e.target.value); dateEdited.current = true; }}
              />
            </div>
          </div>
          <div className="flex flex-col sm:flex-row gap-3">
            <div className="flex flex-col gap-1 flex-1">
              <Label htmlFor="service-mileage">Mileage (optional)</Label>
              <Input
                id="service-mileage"
                type="number"
                placeholder="18250"
                value={mileage}
                onKeyDown={handleKeyDown}
                onChange={(e) => { fieldEdited.current.add("mileage"); setMileage(e.target.value); }}
              />
            </div>
            <div className="flex flex-col gap-1 flex-1">
              <Label htmlFor="service-total">Total</Label>
              <Input
                id="service-total"
                type="number"
                placeholder="0.00"
                value={totalCost}
                onKeyDown={handleKeyDown}
                onChange={(e) => { fieldEdited.current.add("totalCost"); setTotalCost(e.target.value); }}
              />
            </div>
          </div>
          <div className="flex flex-col gap-1">
            <Label>Line items</Label>
            <ExtractedRows
              columns={itemColumns}
              rows={rows}
              onChange={(next) => { rowsEdited.current = true; setRows(next); }}
            />
          </div>
          <div className="flex flex-col gap-1">
            <Label htmlFor="service-entry">Notes</Label>
            <Textarea
              id="service-entry"
              className="w-full h-[5rem]"
              value={entry}
              onKeyDown={handleKeyDown}
              onChange={(e) => setEntry(e.target.value)}
            />
          </div>
          {/* one status line: the armed save warning wins over the OCR hint */}
          {saveWarningArmed &&
            <span className="text-sm text-amber-600">
              Mileage lower than the current {currentVehicleMileage.toLocaleString()} — save anyway?
            </span>
          }
          {!saveWarningArmed && ocr == "reading" &&
            <span className="flex flex-row items-center gap-1 text-sm text-muted-foreground">
              <LoaderIcon className="h-4 w-4 animate-spin" />
              Reading receipt…
            </span>
          }
          {!saveWarningArmed && ocr == "done" && vehicleMismatch &&
            <span className="text-sm text-amber-600">
              Receipt is for &ldquo;{vehicleMismatch}&rdquo; — no match in your vehicles, check the selection
            </span>
          }
          {!saveWarningArmed && ocr == "done" && !vehicleMismatch &&
            <span className="text-sm text-muted-foreground">
              ✨ pre-filled from the receipt — check and save
            </span>
          }
          {!saveWarningArmed && ocr == "low" &&
            <span className="text-sm text-amber-600">
              Couldn&apos;t read the receipt — fill in manually
            </span>
          }
          {!saveWarningArmed && ocr == "failed" &&
            <span className="text-sm text-muted-foreground">
              Couldn&apos;t read the receipt — fill in manually
            </span>
          }
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
