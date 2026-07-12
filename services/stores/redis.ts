import RedisStore from "@desmat/redis-store";
import { User } from "../../types/User";
import { Vehicle } from "../../types/Vehicle";
import { Log } from "../../types/Log";
import { Attachment } from "../../types/Attachment";
import { Document } from "../../types/Document";
import { MaintenanceSchedule } from "../../types/MaintenanceSchedule";
import { storeConfigs } from "./config";

export function createStore({
  debug
}: {
  debug?: boolean
}) {
  debug && console.log(`services.stores.redis.create`);
  return {
    users: new RedisStore<User>({ ...storeConfigs.users, debug }),
    vehicles: new RedisStore<Vehicle>({ ...storeConfigs.vehicles, debug }),
    logs: new RedisStore<Log>({ ...storeConfigs.logs, debug }),
    attachments: new RedisStore<Attachment>({ ...storeConfigs.attachments, debug }),
    documents: new RedisStore<Document>({ ...storeConfigs.documents, debug }),
    schedules: new RedisStore<MaintenanceSchedule>({ ...storeConfigs.schedules, debug }),
  }
};
