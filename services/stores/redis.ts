import RedisStore from "@desmat/redis-store";
import { User } from "../../types/User";
import { Vehicle } from "../../types/Vehicle";
import { Log } from "../../types/Log";
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
  }
};
