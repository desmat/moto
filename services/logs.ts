import moment from "moment";
import { deleteAttachment, getAttachments } from "./attachments";
import { createStore } from "./stores";
import { Log, LogTypeMileage } from "@/types/Log";
import { SessionUser } from "@/types/User";

const store = createStore({
  debug: true,
});

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

  if (saved?.vehicleId && (isMileageLog || Number.isFinite(mileage))) {
    const vehicle = await store.vehicles.get(saved.vehicleId);

    if (vehicle && vehicle.userId == saved.userId && typeof mileage == "number" && Number.isFinite(mileage)
      && (isMileageLog || mileage > (vehicle.mileage ?? 0))) {
      await store.vehicles.update({ ...vehicle, mileage, updatedBy: user.id });
    }

    // S12 appends its vehicle.components update here, in this same fetched-vehicle scope
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
