'use client'
import { LoaderIcon } from "lucide-react"
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
import { DefaultVehicleType, VehicleTypes } from "@/types/Vehicle"

// Doubles as the first-run onboarding dialog (forced open via `show` when the user has no
// vehicles yet, no way to dismiss) and the Vehicles page's "Add Vehicle" dialog (opened
// via the trigger `children`).
export default function SetupVehicleDialog({
  show,
  forced,
  onSubmit,
  children,
}: {
  show?: boolean,
  forced?: boolean,
  onSubmit?: (vehicle: any) => Promise<any> | void,
  children?: React.ReactNode,
}) {
  const [open, setOpen] = useState(false);
  const [type, setType] = useState(DefaultVehicleType);
  const [maker, setMaker] = useState("");
  const [model, setModel] = useState("");
  const [year, setYear] = useState("");
  const [mileage, setMileage] = useState("");
  const [submitting, setSubmitting] = useState(false);

  const isOpen = forced ? !!show : open;

  useEffect(() => {
    setType(DefaultVehicleType);
    setMaker("");
    setModel("");
    setYear("");
    setMileage("");
    setSubmitting(false);
  }, [isOpen]);

  const canSubmit = !submitting
    && maker.trim().length > 0
    && model.trim().length > 0
    && !!parseInt(year);

  const submit = async () => {
    if (!canSubmit) return;

    setSubmitting(true);

    await (onSubmit && onSubmit({
      type,
      maker: maker.trim(),
      model: model.trim(),
      year: parseInt(year),
      ...Number.isFinite(parseFloat(mileage)) && { mileage: parseFloat(mileage) },
      modifications: [],
    }));

    setSubmitting(false);
    setOpen(false);
  }

  return (
    <Dialog open={isOpen} onOpenChange={forced ? undefined : setOpen}>
      {children &&
        <DialogTrigger asChild>
          {children}
        </DialogTrigger>
      }
      <DialogContent
        className="sm:max-w-[425px] sm:min-w-[400px] min-w-0"
        // forced onboarding: no click-outside/escape dismissal
        {...forced && {
          onPointerDownOutside: (e: any) => e.preventDefault(),
          onEscapeKeyDown: (e: any) => e.preventDefault(),
        }}
      >
        {/* hide the close button in forced mode - radix doesn't make this configurable */}
        {forced &&
          <style dangerouslySetInnerHTML={{
            __html: `.ring-offset-background { display: none; }`
          }} />
        }
        <DialogHeader>
          <DialogTitle>
            {forced ? "Welcome to MotoGPT" : "Add Vehicle"}
          </DialogTitle>
          <DialogDescription>
            {forced
              ? "Let's start with your ride:"
              : "Add another vehicle to track:"
            }
          </DialogDescription>
        </DialogHeader>
        <div className="flex flex-col gap-3 py-2">
          <div className="flex flex-col gap-1">
            <Label htmlFor="vehicle-type">Type</Label>
            <select
              id="vehicle-type"
              className="flex h-9 w-full rounded-md border border-input bg-transparent px-3 py-1 text-sm shadow-sm capitalize"
              value={type}
              onChange={(e) => setType(e.target.value)}
            >
              {VehicleTypes.map((t) => (
                <option key={t} value={t}>{t}</option>
              ))}
            </select>
          </div>
          <div className="flex flex-col gap-1">
            <Label htmlFor="vehicle-maker">Maker</Label>
            <Input id="vehicle-maker" placeholder="Honda" value={maker} onChange={(e) => setMaker(e.target.value)} />
          </div>
          <div className="flex flex-col gap-1">
            <Label htmlFor="vehicle-model">Model</Label>
            <Input id="vehicle-model" placeholder="CB500X" value={model} onChange={(e) => setModel(e.target.value)} />
          </div>
          <div className="flex flex-col gap-1">
            <Label htmlFor="vehicle-year">Year</Label>
            <Input id="vehicle-year" type="number" placeholder="2021" value={year} onChange={(e) => setYear(e.target.value)} />
          </div>
          <div className="flex flex-col gap-1">
            <Label htmlFor="vehicle-mileage">Mileage (optional)</Label>
            <Input id="vehicle-mileage" type="number" placeholder="18250" value={mileage} onChange={(e) => setMileage(e.target.value)} />
          </div>
        </div>
        <DialogFooter className="flex flex-row items-center justify-center sm:items-center sm:justify-center space-x-2">
          {!forced &&
            <Button variant="secondary" onClick={() => setOpen(false)} disabled={submitting}>
              Close
            </Button>
          }
          <Button type="submit" onClick={submit} disabled={!canSubmit}>
            {submitting && <LoaderIcon className="animate-spin" />}
            {forced ? "Let's Go" : "Save"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
