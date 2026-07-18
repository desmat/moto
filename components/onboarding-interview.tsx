'use client'
import { LoaderIcon } from "lucide-react"
import { useEffect, useRef, useState } from "react"
import { toast } from "sonner"
import ExtractedRows, { ExtractedRowsColumn } from "@/components/extracted-rows"
import { Button } from "@/components/ui/button"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import { Input } from "@/components/ui/input"
import VehicleDocuments from "@/components/vehicle-documents"
import { useLog } from "@/hooks/use-log"
import { useAuth } from "@/hooks/use-user"
import { cn } from "@/lib/utils"
import { LogTypeMileage } from "@/types/Log"
import { Vehicle, vehicleName } from "@/types/Vehicle"

// The S13 onboarding-interview dialog: a short AI chat about the vehicle's history
// (client-held transcript, one POST /api/ai/onboarding per turn), ending in a
// review-then-confirm table of proposed backdated logs. Nothing persists unless the
// user confirms — Skip/close at any point creates nothing. Opened by the forced
// first-vehicle flow (app/signed-in-page-main.tsx) and by the dashboard's
// finish-setup card (app/page.tsx); fully controlled via open/onOpenChange.

type Message = { role: "user" | "assistant", content: string };

const reviewColumns: ExtractedRowsColumn[] = [
  { label: "Date", field: "date", type: "text", width: "6.5rem" },
  { label: "Type", field: "type", type: "select", options: ["service", "mileage", "journal"], width: "6.5rem" },
  { label: "Entry", field: "entry", type: "text" },
  { label: "Est.", field: "estimated", type: "badge", width: "2.5rem" },
];

export default function OnboardingInterview({ vehicle, open, onOpenChange }: {
  vehicle?: Vehicle,
  open: boolean,
  onOpenChange: (open: boolean) => void,
}) {
  const { getToken } = useAuth();
  const { add: addLog } = useLog();
  const [messages, setMessages] = useState<Message[]>([]);
  const [input, setInput] = useState("");
  const [sending, setSending] = useState(false);
  const [failed, setFailed] = useState(false);
  const [done, setDone] = useState(false);
  const [suggestUpload, setSuggestUpload] = useState(false);
  const [rows, setRows] = useState<any[]>([]);
  const [confirming, setConfirming] = useState(false);
  const bottomRef = useRef<HTMLDivElement>(null);

  const runTurn = async (transcript: Message[]) => {
    if (!vehicle) return;

    setSending(true);
    setFailed(false);

    try {
      const token = await getToken();
      const res = await fetch("/api/ai/onboarding", {
        headers: { Authorization: `Bearer ${token}` },
        body: JSON.stringify({ vehicleId: vehicle.id, messages: transcript }),
        method: "POST",
      });

      if (!res.ok) {
        throw `${res.statusText} (${res.status})`;
      }

      const turn = await res.json();
      console.log("components.onboarding-interview.runTurn", { transcript, turn });

      setMessages([...transcript, { role: "assistant", content: turn.message }]);
      setSuggestUpload(!!turn.suggestUpload && !turn.done);

      if (turn.done) {
        // mileage-ordering guard, part 1 (see confirm() for part 2): the prompt
        // constrains the model to at most ONE mileage-type log, but don't trust it —
        // keep only the newest-dated one, dropped from the review table right here
        const proposed: any[] = Array.isArray(turn.proposal?.logs) ? turn.proposal.logs : [];
        const newestMileageLog = proposed
          .filter((log) => log.type == LogTypeMileage)
          .sort((a, b) => `${b.date || ""}`.localeCompare(`${a.date || ""}`))[0];
        setRows([
          ...proposed.filter((log) => log.type != LogTypeMileage),
          ...newestMileageLog ? [newestMileageLog] : [],
        ]);
        setDone(true);
      }
    } catch (error) {
      console.error("components.onboarding-interview.runTurn", { error });
      setFailed(true);
    } finally {
      setSending(false);
    }
  }

  // reset and fire the opening turn (empty transcript → the AI asks first)
  useEffect(() => {
    if (!open || !vehicle) return;

    setMessages([]);
    setInput("");
    setFailed(false);
    setDone(false);
    setSuggestUpload(false);
    setRows([]);
    setConfirming(false);
    runTurn([]);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, vehicle?.id]);

  // keep the newest message in view
  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth", block: "nearest" });
  }, [messages, sending, suggestUpload, failed]);

  const send = () => {
    const text = input.trim();
    if (!text || sending || done) return;

    const transcript: Message[] = [...messages, { role: "user", content: text }];
    setMessages(transcript);
    setInput("");
    runTurn(transcript);
  }

  // rows with actual content — a row wiped by the user doesn't count
  const filledRows = rows.filter((row) => `${row.type || ""}`.trim() && `${row.date || ""}`.trim());

  const confirm = async () => {
    if (!vehicle || !filledRows.length || confirming) return;

    setConfirming(true);

    try {
      // mileage-ordering guard, part 2: mileage-type logs overwrite the vehicle's
      // mileage unconditionally, so they must be POSTed LAST (service logs update it
      // monotonically — their order doesn't matter)
      const ordered = [
        ...filledRows.filter((row) => row.type != LogTypeMileage),
        ...filledRows.filter((row) => row.type == LogTypeMileage),
      ];

      for (const row of ordered) {
        // `estimated` is review-screen provenance, not a Log field — don't persist it
        await addLog({
          vehicleId: vehicle.id,
          type: `${row.type}`.trim(),
          date: `${row.date}`.trim(),
          entry: `${row.entry ?? ""}`.trim(),
          ...Array.isArray(row.items) && row.items.length > 0 && { items: row.items },
          ...Number.isFinite(Number(row.mileage)) && row.mileage !== "" && row.mileage != null && { mileage: Number(row.mileage) },
        });
      }

      toast.success(`Recorded ${ordered.length} ${ordered.length == 1 ? "entry" : "entries"} for your ${vehicleName(vehicle)}`);
      onOpenChange(false);
    } catch (error) {
      console.error("components.onboarding-interview.confirm", { error });
      toast.error(`An error occured: ${error}`);
    } finally {
      setConfirming(false);
    }
  }

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key == "Enter") {
      e.preventDefault();
      send();
    }
  }

  if (!vehicle) return null;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-[560px] max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>
            {done ? "Review & confirm" : `Set up your ${vehicleName(vehicle)}`}
          </DialogTitle>
          <DialogDescription>
            {done
              ? "Here's what I'll record — edit or remove anything, then confirm. Nothing is saved until you do."
              : "A couple of quick questions to seed the maintenance history — skip anytime."
            }
          </DialogDescription>
        </DialogHeader>
        {!done &&
          <>
            <div className="flex flex-col gap-2 min-h-[8rem] max-h-[45vh] overflow-y-auto pr-1">
              {messages.map((message, i) => (
                <div
                  key={i}
                  className={cn("rounded-lg px-3 py-2 text-sm max-w-[85%] whitespace-pre-wrap", message.role == "user"
                    ? "self-end bg-primary text-primary-foreground"
                    : "self-start bg-muted text-muted-foreground")}
                >
                  {message.content}
                </div>
              ))}
              {sending &&
                <div className="self-start rounded-lg bg-muted px-3 py-2">
                  <LoaderIcon className="h-4 w-4 animate-spin opacity-60" />
                </div>
              }
              {suggestUpload && !sending &&
                // S8's upload affordance, inline: upload + ingestion proceed in the
                // background (S9 is status-driven) while the interview continues
                <div className="w-full rounded-lg border border-input p-2">
                  <VehicleDocuments vehicleId={vehicle.id} />
                </div>
              }
              {failed &&
                <span className="text-sm text-destructive">
                  Something went wrong —{" "}
                  <button type="button" className="underline" onClick={() => runTurn(messages)}>
                    try again
                  </button>
                </span>
              }
              <div ref={bottomRef} />
            </div>
            <div className="flex flex-row gap-2">
              <Input
                aria-label="Answer"
                placeholder="Type your answer…"
                value={input}
                disabled={sending}
                onKeyDown={handleKeyDown}
                onChange={(e) => setInput(e.target.value)}
              />
              <Button onClick={send} disabled={sending || !input.trim()}>
                Send
              </Button>
            </div>
          </>
        }
        {done &&
          <div className="flex flex-col gap-2">
            {messages.length > 0 &&
              <span className="text-sm text-muted-foreground">
                {messages[messages.length - 1].content}
              </span>
            }
            <ExtractedRows
              columns={reviewColumns}
              rows={rows}
              onChange={setRows}
              allowAdd={false}
            />
          </div>
        }
        <DialogFooter className="flex flex-row items-center justify-center sm:items-center sm:justify-center space-x-2">
          <Button variant="secondary" onClick={() => onOpenChange(false)} disabled={confirming}>
            Skip
          </Button>
          {done &&
            <Button onClick={confirm} disabled={confirming || !filledRows.length}>
              {confirming && <LoaderIcon className="animate-spin" />}
              Confirm
            </Button>
          }
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
