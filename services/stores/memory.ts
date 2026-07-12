import moment from "moment";
import { MemoryStore } from "@desmat/redis-store";
import { User } from "../../types/User";
import { Vehicle } from "../../types/Vehicle";
import { Log } from "../../types/Log";
import { Attachment } from "../../types/Attachment";
import { Document } from "../../types/Document";
import { MaintenanceSchedule } from "../../types/MaintenanceSchedule";
import { storeConfigs, StoreEntityName } from "./config";

// Keep in sync with playwright.config.ts's IMPERSONATE_USER_ID -- vehicles/logs are
// scoped by exact user id, so the seeded history below only shows up (record buttons,
// entries list, etc.) when this exact user is impersonated.
export const smokeTestUserId = "user_smoketest";

const smokeTestVehicleId = "vehicle-smoketest";
// two more real bikes for the manual → schedule seeding pass (see scheduleSeeds below):
// upload each one's real owner's manual through the app once, confirm the extracted
// schedule, then use the vehicle page's temporary "Copy schedule JSON" button
// (components/schedule-review.tsx) to paste the result into scheduleSeeds.
const crf250rlVehicleId = "vehicle-crf250rl";
const gsxr750VehicleId = "vehicle-gsxr750";

// Hard-coded (rather than loaded from a file) so this module has no I/O: it needs to work
// identically whether it's pulled in from a Node.js API route or from middleware.ts, which
// Next.js runs in the Edge runtime -- and the Edge runtime has no `fs` module. The seeded
// vehicle also keeps the "add your first vehicle" onboarding dialog from blocking the
// Playwright suite (it only shows when the user has no vehicles).
const seed: Partial<Record<StoreEntityName, any[]>> = {
  users: [
    {
      id: smokeTestUserId,
      createdAt: 1700000000000,
      providerId: "provider_smoketest",
      authProvider: "mock",
      email: "smoketest@example.com",
      name: "Smoke Test",
    },
  ],
  vehicles: [
    {
      id: smokeTestVehicleId,
      createdAt: 1700000000000,
      userId: smokeTestUserId,
      type: "motorcycle",
      maker: "Honda",
      model: "CB500X",
      year: 2021,
      mileage: 18250,
      modifications: ["crash bars", "heated grips"],
    },
    {
      id: "vehicle-smoketest-2",
      createdAt: 1700000001000,
      userId: smokeTestUserId,
      type: "motorcycle",
      maker: "Yamaha",
      model: "XT250",
      year: 2018,
      mileage: 9400,
      modifications: [],
    },
    // added for the manual → schedule seeding pass (see scheduleSeeds below)
    {
      id: crf250rlVehicleId,
      createdAt: 1700000001500,
      userId: smokeTestUserId,
      type: "motorcycle",
      maker: "Honda",
      model: "CRF250RL",
      year: 2020,
      mileage: 3200,
      modifications: [],
    },
    {
      id: gsxr750VehicleId,
      createdAt: 1700000001600,
      userId: smokeTestUserId,
      type: "motorcycle",
      maker: "Suzuki",
      model: "GSX-R 750",
      year: 2009,
      mileage: 22500,
      modifications: [],
    },
  ],
  // one image attachment linked to the seeded "new tires" log (smoke-log-7, see
  // buildLogSeeds below) so attachment indicators/galleries have something to render out
  // of the box. The pathname is fake-but-well-formed (`moto/{userId}/...`); the url is a
  // tiny inline data-URL PNG so nothing depends on a real Blob store.
  attachments: [
    {
      id: "attachment-smoketest",
      createdAt: 1700000002000,
      userId: smokeTestUserId,
      logId: "smoke-log-7",
      vehicleId: smokeTestVehicleId,
      url: "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==",
      pathname: `moto/${smokeTestUserId}/seed-new-tires.png`,
      contentType: "image/png",
      size: 68,
      filename: "new-tires.png",
    },
  ],
};

// A handful of Log records for smokeTestUserId spread over the last couple of weeks so
// the dashboard's Entries section has something to show out of the box. Computed relative
// to "now" (not literal date strings) so this stays meaningful whenever the dev server
// happens to start.
function buildLogSeeds(): any[] {
  const mk = (daysAgo: number, type: string, entry: string, suffix: string) => {
    const createdAt = moment().subtract(daysAgo, "days").hour(10).minute(0).second(0).valueOf();

    return {
      id: `smoke-log-${suffix}`,
      createdAt,
      userId: smokeTestUserId,
      vehicleId: smokeTestVehicleId,
      type,
      date: moment(createdAt).format("YYYYMMDD"),
      entry,
    };
  };

  return [
    mk(0, "journal", "Chain cleaned and lubed after the weekend ride.", "1"),
    mk(1, "mileage", "18250", "2"),
    mk(3, "oil change", "Full synthetic 10W-30, new filter.", "3"),
    mk(5, "chain adjustment", "Tightened to 35mm slack, cleaned and lubed.", "6"),
    mk(8, "journal", "Front brake lever feels spongy, bleed brakes soon.", "4"),
    mk(10, "new tires", "Michelin Anakee Adventure front and rear.", "7"),
    mk(12, "mileage", "17980", "5"),
  ];
}

// ---------------------------------------------------------------------------
// TEMPORARY (S10 follow-up): real extracted-and-confirmed maintenance schedules,
// pasted in by hand after running each bike's actual owner's manual through the real
// pipeline (AI_MOCK=false). Workflow: upload the manual on the vehicle's page → wait
// for the schedule review banner → correct/confirm it → click the confirmed summary's
// "Copy schedule JSON" button (components/schedule-review.tsx, itself temporary) →
// paste the array of ScheduleItem objects below for that bike. Once filled in, the
// vehicle has real seed data instead of nothing; empty arrays are simply skipped (no
// document/vector coupling to fake, same reasoning as the "no seeded documents" note
// below). Remove this whole block (and the copy button) once enough seed data exists
// and the mechanism is no longer needed.
const scheduleSeeds: Record<string, any[]> = {
  [crf250rlVehicleId]: [
    // paste the CRF250RL's confirmed schedule items here
  ],
  [gsxr750VehicleId]: [
    // paste the GSX-R750's confirmed schedule items here
  ],
};

function buildScheduleSeeds(): any[] {
  return Object.entries(scheduleSeeds)
    .filter(([, items]) => items.length > 0)
    .map(([vehicleId, items], i) => ({
      id: `schedule-seed-${i}`,
      createdAt: 1700000002500 + i,
      userId: smokeTestUserId,
      vehicleId,
      source: "manual",
      status: "confirmed",
      items,
    }));
}

function buildStore({ debug }: { debug?: boolean }) {
  debug && console.log(`services.stores.memory.create`);

  return {
    users: new MemoryStore<User>({ ...storeConfigs.users, debug, seed: seed.users }),
    vehicles: new MemoryStore<Vehicle>({ ...storeConfigs.vehicles, debug, seed: seed.vehicles }),
    logs: new MemoryStore<Log>({ ...storeConfigs.logs, debug, seed: buildLogSeeds() }),
    attachments: new MemoryStore<Attachment>({ ...storeConfigs.attachments, debug, seed: seed.attachments }),
    // no seeded documents on purpose: a seeded "ready" doc would also need seeded mock
    // vectors (not worth the coupling); S9's spec creates its own fixture document
    documents: new MemoryStore<Document>({ ...storeConfigs.documents, debug, seed: seed.documents }),
    // seeded only from scheduleSeeds above (empty until real manuals are copied in);
    // S10's spec still creates its own fixtures via the API regardless
    schedules: new MemoryStore<MaintenanceSchedule>({ ...storeConfigs.schedules, debug, seed: buildScheduleSeeds() }),
  };
}

type MemoryStoreInstance = ReturnType<typeof buildStore>;

// Unlike RedisStore (a stateless client against one shared external Redis server, so it
// doesn't matter how many separate instances get constructed), a MemoryStore's data only
// lives in its own JS Maps -- every services/*.ts module calls createStore() independently
// at import time, so without a true process-wide singleton each module would get its own
// disconnected copy of "the store" and writes in one service would be invisible to
// another. Caching on globalThis (rather than a module-level variable) also survives
// Next.js dev's per-route module duplication, the same reason Prisma clients are cached
// there this way.
const globalForMemoryStore = globalThis as unknown as { __motoMemoryStore?: MemoryStoreInstance };

export function createStore({
  debug
}: {
  debug?: boolean
}) {
  if (!globalForMemoryStore.__motoMemoryStore) {
    globalForMemoryStore.__motoMemoryStore = buildStore({ debug });
  }

  return globalForMemoryStore.__motoMemoryStore;
};
