// Entity configs shared by services/stores/redis.ts and services/stores/memory.ts, so
// the two backends can never drift apart on `key`/`setKey`/`options` (lookups, counters).

import { UserOptions } from "../../types/User";
import { VehicleOptions } from "../../types/Vehicle";
import { LogOptions } from "../../types/Log";
import { AttachmentOptions } from "../../types/Attachment";
import { DocumentOptions } from "../../types/Document";

export const storeConfigs = {
  users: { key: "MotoUser", options: UserOptions },
  vehicles: { key: "MotoVehicle", options: VehicleOptions },
  logs: { key: "MotoLog", options: LogOptions },
  attachments: { key: "MotoAttachment", options: AttachmentOptions },
  documents: { key: "MotoDocument", options: DocumentOptions },
} as const;

export type StoreEntityName = keyof typeof storeConfigs;
