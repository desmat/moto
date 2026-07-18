import moment from "moment";
import { deleteAttachment, getAttachments } from "./attachments";
import { createStore } from "./stores";
import { Log, LogItem, LogTypeMileage, LogTypeService } from "@/types/Log";
import { SessionUser } from "@/types/User";
import { VehicleComponentState } from "@/types/Vehicle";

const store = createStore({
  debug: true,
});

// Fold a service log's structured items into a vehicle's `components` snapshot (S12).
// Pure so the admin rebuild script and tests replay the exact same rules saveLog applies:
// - an item never overwrites a NEWER state entry (`existing.date > log.date`, YYYYMMDD
//   string compare) — backdated receipts must not clobber fresher state; a same-day
//   re-log ties and the write wins
// - `replace` (and `other` with no prior entry, i.e. a first install) sets `detail`
//   from `item.note` — that's where "Michelin Anakee Adventure" lives; no name
//   fallback (the name renders on the card anyway, a copy in detail is just noise)
// - every applied action refreshes the "last touched" fields: name/action/date/mileage/logId
export function applyItemsToComponents(
  components: Record<string, VehicleComponentState> | undefined,
  items: LogItem[] | undefined,
  log: Pick<Log, "id" | "date"> & { mileage?: number },
): Record<string, VehicleComponentState> {
  const next = { ...(components || {}) };

  for (const item of items || []) {
    const key = `${item?.key || ""}`.trim();
    if (!key || !log?.date) continue;

    const existing = next[key];
    if (existing?.date && existing.date > log.date) continue; // newer state wins

    const action = `${item.action || "other"}`;
    const installs = action == "replace" || (action == "other" && !existing);
    const detail = installs ? item.note : existing?.detail;
    const mileage = typeof log.mileage == "number" && Number.isFinite(log.mileage)
      ? log.mileage
      : undefined;

    next[key] = {
      name: item.name || existing?.name || key,
      ...detail && { detail },
      action,
      date: log.date,
      ...mileage != undefined && { mileage },
      logId: log.id,
    };
  }

  return next;
}

export async function getLogs(query: any = {}): Promise<any> {
  console.log("services.logs.getLogs", { query });

  return store.logs.find(query);
}

export async function getLog(id: string): Promise<Log | undefined> {
  console.log("services.logs.getLog", { id });

  return store.logs.get(id);
}

export async function saveLog(data: any, user: SessionUser): Promise<Log | undefined> {
  console.log("services.logs.saveLog", { data });

  const log = {
    ...data,
    type: `${data.type || "journal"}`.trim().toLowerCase(),
    date: data.date || moment().format("YYYYMMDD"),
    entry: `${data.entry || ""}`.trim(),
  };

  // a service log saved without notes still deserves a readable entry (lists render
  // log.entry): compose one from its structured data — the first 3 item names, then
  // "+N more" (real shop invoices run 25+ lines; a full join floods the entries
  // list; visual overflow is the renderers' job, so no literal ellipsis here), plus
  // the vendor when known. User-typed notes always win; done
  // here in the service so every entrance (receipt dialog, API, S13's proposed logs)
  // gets it.
  if (log.type == LogTypeService && !log.entry && Array.isArray(log.items) && log.items.length) {
    const names = log.items.map((item: any) => `${item?.name || item?.key || ""}`.trim()).filter(Boolean);
    const shown = names.slice(0, 3);
    const summary = shown.join(", ")
      + (names.length > shown.length ? ` +${names.length - shown.length} more` : "");
    log.entry = [summary, log.vendor].filter(Boolean).join(" — ");
  }

  const exists = log.id && await store.logs.exists(log.id);

  const saved = await store.logs[exists ? "update" : "create"]({
    ...log,
    ...!exists && { userId: user.id },
    [exists ? "updatedBy" : "createdBy"]: user.id,
  });

  // a mileage log doubles as the vehicle's odometer reading: keep the vehicle record's
  // mileage in sync so it always reflects the latest recorded value. Two rules by type:
  // - mileage-type logs overwrite ALWAYS (the entry IS an odometer reading; deliberate
  //   downward corrections stay possible here)
  // - any other log type carrying a numeric `mileage` field (e.g. an S11 service log
  //   with the odometer printed on the receipt) updates the vehicle MONOTONICALLY --
  //   only when it's higher than the current value -- because receipts are frequently
  //   backdated and must never clobber a newer reading
  const isMileageLog = saved?.type == LogTypeMileage;
  const mileage = isMileageLog ? parseFloat(saved.entry) : saved?.mileage;
  // S12: only SERVICE logs update vehicle.components — hostile/hand-added items[] on a
  // journal log stays stored-but-inert (the extraction flow always produces "service")
  const hasComponentItems = saved?.type == LogTypeService && Array.isArray(saved?.items) && saved.items.length > 0;

  if (saved?.vehicleId && (isMileageLog || Number.isFinite(mileage) || hasComponentItems)) {
    const vehicle = await store.vehicles.get(saved.vehicleId);

    if (vehicle && vehicle.userId == saved.userId) {
      const updateMileage = typeof mileage == "number" && Number.isFinite(mileage)
        && (isMileageLog || mileage > (vehicle.mileage ?? 0));
      const components = hasComponentItems
        ? applyItemsToComponents(vehicle.components, saved.items, saved)
        : undefined;

      if (updateMileage || components) {
        // one update carries both concerns: latest odometer reading + component state
        await store.vehicles.update({
          ...vehicle,
          ...updateMileage && { mileage },
          ...components && { components },
          updatedBy: user.id,
        });
      }
    }
  }

  console.log("services.logs.saveLog", { saved });

  return saved;
}

export async function deleteLog(id: string): Promise<Log | undefined> {
  console.log("services.logs.deleteLog", { id });

  // cascade: a log's attachments (records + blobs) go with it; done here in the service
  // layer so every deletion path gets it. deleteAttachment's blob deletion is already
  // best-effort, so a fake/missing blob can't block the log delete.
  const attachments = await getAttachments({ log: id });

  for (const attachment of attachments || []) {
    await deleteAttachment(attachment.id);
  }

  return store.logs.delete(id);
}
