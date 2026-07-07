'use client'
import { sortBy } from "@desmat/utils"
import { useEffect, useState } from "react"
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
import { LogTypeJournal, LogTypeMileage } from "@/types/Log"
import { Vehicle, vehicleName } from "@/types/Vehicle"

export type LogEntryMode = "journal" | "mileage" | "custom";

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
  onSubmit?: (log: { vehicleId: string, type: string, entry: string }) => void,
  children?: React.ReactNode,
}) {
  const [open, setOpen] = useState(false);
  const [vehicleId, setVehicleId] = useState("");
  const [type, setType] = useState("");
  const [entry, setEntry] = useState("");

  const sortedVehicles = vehicles ? Object.values(vehicles).sort(sortBy('createdAt')) : [];

  useEffect(() => {
    if (open) {
      setVehicleId(defaultVehicleId || sortedVehicles[0]?.id || "");
      setType(defaultType || "");
      setEntry("");
    }
  }, [open]);

  const canSubmit = !!vehicleId
    && entry?.trim().length > 0
    && (mode != "custom" || type?.trim().length > 0)
    && (mode != "mileage" || Number.isFinite(parseFloat(entry)));

  const submit = () => {
    if (!canSubmit) return;

    onSubmit && onSubmit({
      vehicleId,
      type: mode == "journal" ? LogTypeJournal : mode == "mileage" ? LogTypeMileage : type,
      entry,
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
