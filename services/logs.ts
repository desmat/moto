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
  // mileage in sync so it always reflects the latest recorded value
  if (saved?.type == LogTypeMileage) {
    const mileage = parseFloat(saved.entry);
    const vehicle = saved.vehicleId ? await store.vehicles.get(saved.vehicleId) : undefined;

    if (vehicle && vehicle.userId == saved.userId && Number.isFinite(mileage)) {
      await store.vehicles.update({ ...vehicle, mileage, updatedBy: user.id });
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
