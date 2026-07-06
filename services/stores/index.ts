import { createStore as createRedisStore } from "./redis";
import { createStore as createMemoryStore } from "./memory";

export function createStore(opts: { debug?: boolean }) {
  // Swaps in an in-memory store instead of real Upstash Redis, for local dev/tests.
  // NODE_ENV !== "production" is enforced in addition to the flag so a leaked env var
  // can never disable real persistence in a production deployment.
  const isMemoryStoreEnabled = process.env.NODE_ENV !== "production" && process.env.STORE_TYPE === "memory";

  return isMemoryStoreEnabled ? createMemoryStore(opts) : createRedisStore(opts);
}
