import moment from "moment";
import { MemoryStore } from "@desmat/redis-store";
import { User } from "../../types/User";
import { Vehicle } from "../../types/Vehicle";
import { Log } from "../../types/Log";
import { storeConfigs, StoreEntityName } from "./config";

// Keep in sync with playwright.config.ts's IMPERSONATE_USER_ID -- vehicles/logs are
// scoped by exact user id, so the seeded history below only shows up (record buttons,
// entries list, etc.) when this exact user is impersonated.
export const smokeTestUserId = "user_smoketest";

const smokeTestVehicleId = "vehicle-smoketest";

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
    mk(8, "journal", "Front brake lever feels spongy, bleed brakes soon.", "4"),
    mk(12, "mileage", "17980", "5"),
  ];
}

function buildStore({ debug }: { debug?: boolean }) {
  debug && console.log(`services.stores.memory.create`);

  return {
    users: new MemoryStore<User>({ ...storeConfigs.users, debug, seed: seed.users }),
    vehicles: new MemoryStore<Vehicle>({ ...storeConfigs.vehicles, debug, seed: seed.vehicles }),
    logs: new MemoryStore<Log>({ ...storeConfigs.logs, debug, seed: buildLogSeeds() }),
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
