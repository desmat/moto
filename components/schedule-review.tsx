'use client'
import { sortBy } from "@desmat/utils"
import { Check, Copy, LoaderIcon } from "lucide-react"
import { useState } from "react"
import ExtractedRows, { ExtractedRowsColumn } from "@/components/extracted-rows"
import { Button } from "@/components/ui/button"
import { useDocument } from "@/hooks/use-document"
import { useSchedule } from "@/hooks/use-schedule"
import { MaintenanceSchedule, ScheduleItemActions } from "@/types/MaintenanceSchedule"

// The vehicle page's maintenance-schedule section (S10): when extraction (or a hand
// entry) leaves a *proposed* schedule, surface it as a review banner + editable table
// with Confirm/Discard — AI output only becomes canonical data after human sign-off.
// A *confirmed* schedule shows as a collapsed summary with an Edit toggle reopening the
// same table (saving keeps it confirmed). Confirming does the one-confirmed-per-vehicle
// swap server-side (services/schedules.ts's confirmSchedule).

const columns: ExtractedRowsColumn[] = [
  { label: "Key", field: "key", type: "text", width: "9rem" },
  { label: "Name", field: "name", type: "text" },
  { label: "Action", field: "action", type: "select", options: [...ScheduleItemActions], width: "7rem" },
  { label: "Km", field: "intervalKm", type: "number", width: "5.5rem" },
  { label: "Months", field: "intervalMonths", type: "number", width: "5.5rem" },
  { label: "First at km", field: "firstAtKm", type: "number", width: "5.5rem" },
  { label: "Notes", field: "notes", type: "text" },
];

// local-rows editor for one schedule; parent keys it by schedule.id so a different
// schedule (e.g. a fresh extraction) resets the edit state
// TEMPORARY (seed-data workflow, remove once enough real manuals have been captured):
// copies a confirmed schedule's `items` array as pretty JSON, ready to paste straight
// into services/stores/memory.ts's scheduleSeeds placeholder for that vehicle.
function CopyScheduleJsonButton({ items }: { items: any[] }) {
  const [copied, setCopied] = useState(false);

  const handleCopy = async () => {
    await navigator.clipboard.writeText(JSON.stringify(items, null, 2));
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  return (
    <Button variant="outline" size="sm" onClick={handleCopy}>
      {copied ? <Check className="h-4 w-4" /> : <Copy className="h-4 w-4" />}
      {copied ? "Copied" : "Copy schedule JSON"}
    </Button>
  );
}

function ScheduleEditor({ schedule, saveLabel, saving, onSave, onDiscard, discardLabel }: {
  schedule: MaintenanceSchedule,
  saveLabel: string,
  saving: boolean,
  onSave: (rows: any[]) => void,
  onDiscard: () => void,
  discardLabel: string,
}) {
  const [rows, setRows] = useState<any[]>(schedule.items || []);

  return (
    <div className="flex flex-col gap-2 w-full">
      <ExtractedRows columns={columns} rows={rows} onChange={setRows} />
      <div className="flex flex-row gap-2">
        <Button disabled={saving} onClick={() => onSave(rows)}>
          {saving && <LoaderIcon className="h-4 w-4 animate-spin" />}
          {saveLabel}
        </Button>
        <Button variant="outline" disabled={saving} onClick={onDiscard}>
          {discardLabel}
        </Button>
      </div>
    </div>
  )
}

export default function ScheduleReview({ vehicleId }: { vehicleId: string }) {
  // `confirm` renamed on destructure so window.confirm stays reachable below
  const { loaded, schedules, save, confirm: confirmSchedule, delete: deleteSchedule } = useSchedule({ vehicleId });
  // to resolve "extracted from ⟨document title⟩" in the review banner
  const { documents } = useDocument({ vehicleId });
  const [editingConfirmed, setEditingConfirmed] = useState(false);
  const [saving, setSaving] = useState(false);

  if (!loaded || !schedules) return null;

  const all = (Object.values(schedules) as MaintenanceSchedule[]).sort(sortBy('createdAt'));
  // newest proposed wins the review slot; at most one confirmed exists per vehicle
  // (server-side invariant)
  const proposed = [...all].reverse().find((schedule) => schedule.status == "proposed");
  const confirmed = all.find((schedule) => schedule.status == "confirmed");

  if (!proposed && !confirmed) return null;

  const documentTitle = (schedule?: MaintenanceSchedule) =>
    (schedule?.documentId && documents?.[schedule.documentId]?.title) || undefined;

  const handleConfirm = async (schedule: MaintenanceSchedule, rows: any[]) => {
    setSaving(true);
    try {
      await confirmSchedule({ ...schedule, items: rows });
    } finally {
      setSaving(false);
    }
  };

  const handleSaveConfirmed = async (schedule: MaintenanceSchedule, rows: any[]) => {
    setSaving(true);
    try {
      await save({ ...schedule, items: rows });
      setEditingConfirmed(false);
    } finally {
      setSaving(false);
    }
  };

  const handleDiscard = (schedule: MaintenanceSchedule) => {
    if (confirm("Discard this proposed maintenance schedule?")) {
      deleteSchedule(schedule.id);
    }
  };

  return (
    <div className="flex flex-col gap-3 items-center w-full max-w-[800px]">
      <div className="font-semibold">
        Maintenance schedule
      </div>
      {proposed &&
        <div className="flex flex-col gap-2 w-full rounded-md border border-input p-3">
          <div className="text-sm">
            Review the maintenance schedule extracted from{" "}
            <span className="font-medium">{documentTitle(proposed) || "the uploaded manual"}</span>
            {confirmed ? " — confirming will replace the current schedule." : "."}
          </div>
          <ScheduleEditor
            key={proposed.id}
            schedule={proposed}
            saveLabel="Confirm"
            discardLabel="Discard"
            saving={saving}
            onSave={(rows) => handleConfirm(proposed, rows)}
            onDiscard={() => handleDiscard(proposed)}
          />
        </div>
      }
      {confirmed &&
        <div className="flex flex-col gap-2 w-full rounded-md border border-input p-3">
          <div className="flex flex-row items-center gap-2 text-sm">
            <span>
              Maintenance schedule: {confirmed.items?.length || 0} items
              {documentTitle(confirmed) ? ` from ${documentTitle(confirmed)}` : ""}
            </span>
            {!editingConfirmed &&
              <div className="ml-auto flex flex-row gap-2">
                <CopyScheduleJsonButton items={confirmed.items || []} />
                <Button variant="outline" size="sm" onClick={() => setEditingConfirmed(true)}>
                  Edit
                </Button>
              </div>
            }
          </div>
          {editingConfirmed &&
            <ScheduleEditor
              key={confirmed.id}
              schedule={confirmed}
              saveLabel="Save"
              discardLabel="Cancel"
              saving={saving}
              onSave={(rows) => handleSaveConfirmed(confirmed, rows)}
              onDiscard={() => setEditingConfirmed(false)}
            />
          }
        </div>
      }
    </div>
  )
}
