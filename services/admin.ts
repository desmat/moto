import { formatBytes } from '@desmat/utils/format';
import { put } from '@vercel/blob';
import moment from 'moment';
// always talks to real Redis: admin scripts operate on the live store, never the
// ephemeral in-memory one
import { createStore } from './stores/redis';
import { applyItemsToComponents } from './logs';
import { Log, LogTypeService } from '../types/Log';
import { Vehicle, VehicleComponentState } from '../types/Vehicle';

const store = createStore({
  debug: true,
});

async function backup() {
  console.log('services.admin.backup', {});

  const entities: any = [];
  const keys = Object.keys(store)
    .filter((key: string) => {
      return entities?.length
        ? entities.includes(key)
        : true
    });
  console.log("services.admin", { keys })

  if (!keys) throw 'No entities to backup';

  // TODO maybe do in chucks
  const values = await Promise.all(
    // @ts-ignore
    keys.map((key: string) => store[key].find({ scan: "*" }))
  );

  // @ts-ignore
  const keyValues = Object.fromEntries(
    await Promise.all(
      keys
        .map(async (k: string, i: number) => {
          const versionedValues = await Promise.all(
            values[i]
              .map(async (currentValue: any) => {

                const previousVersionIds = Array.from(Array(currentValue.version || 0).keys())
                  .map((version: number) => `${currentValue.id}:${version}`);

                const previousValues = previousVersionIds?.length > 0
                  // @ts-ignore
                  ? await store[k].find({ id: previousVersionIds })
                  : [];

                return [currentValue, ...previousValues];
              })
          );

          return [k, versionedValues.flat()]
        })
    )
  );

  const p = require('../package.json');
  const filename = `backups/${p.name}_${p.version}_${moment().format("YYYYMMDD_kkmmss")}.json`;

  // to blob
  const buffer = Buffer.from(JSON.stringify(keyValues), 'utf8');
  const blob = await put(filename, buffer, {
    access: 'public',
    addRandomSuffix: false,
  });
  const ret = { filename: blob.pathname, size: formatBytes(Buffer.byteLength(buffer)), url: blob.url };
  console.log("services.admin.backup", { ret });
  return ret;
}

export async function restore(filenameOrUrl: string) {
  console.log('services.admin.restore', { filenameOrUrl });

  const res = await fetch(filenameOrUrl);
  console.log('services.admin.restore', { res });

  if (res.status != 200) {
    console.error(`Error fetching '${filenameOrUrl}': ${res.statusText} (${res.status})`)
  }

  const data: any = await res.json();
  console.log('services.admin.restore', { data });

  const result = {} as any;
  await Promise.all(
    Object.entries(data).map(async ([key, values]: any) => {
      if (!Array.isArray(values)) {
        console.warn('>> app.services.admin.restore UNEXPECTED VALUES TYPE', { key, values });
        return;
      }

      return await Promise.all(
        values.map(async (value: any) => {
          // @ts-ignore
          const record = await store[key].get(value.id);
          const options = value.deprecated || value.deprecatedAt
            ? {
              noIndex: true,
              noLookup: true,
            }
            : {};

          if (record) {
            // for now don't restore if already exists
            result[`${key}_skipped`] = (result[`${key}_skipped`] || 0) + 1;
          } else {
            // @ts-ignore
            await store[key].create(value, options);
            result[`${key}_created`] = (result[`${key}_created`] || 0) + 1;
          }
        })
      );
    })
  );

  console.log('services.admin.restore >>>RESULTS<<<', { result });

  return result;
}

// S12 one-off/recovery: rebuild a user's `vehicle.components` snapshots by replaying
// their service logs oldest-first through the exact same pure update function saveLog
// uses (deleting a source log deliberately does NOT cascade, and the JSON editor can
// hand-mangle the snapshot — this is the way back to a logs-derived state).
export async function rebuildComponents(userId: string) {
  console.log('services.admin.rebuildComponents', { userId });

  const logs: Log[] = await store.logs.find({ user: userId });
  const vehicles: Vehicle[] = await store.vehicles.find({ user: userId });

  const serviceLogs = (logs || [])
    .filter((log: Log) => log.type == LogTypeService && Array.isArray(log.items) && log.items.length > 0)
    // oldest-first so the newer-wins rule replays the way it happened (YYYYMMDD string sort)
    .sort((a: Log, b: Log) => `${a.date}`.localeCompare(`${b.date}`));

  const result = {} as any;
  for (const vehicle of vehicles || []) {
    const components = serviceLogs
      .filter((log: Log) => log.vehicleId == vehicle.id)
      .reduce(
        (acc: Record<string, VehicleComponentState>, log: Log) => applyItemsToComponents(acc, log.items, log),
        {} as Record<string, VehicleComponentState>,
      );

    await store.vehicles.update({ ...vehicle, components });
    result[vehicle.id] = Object.keys(components).length;
  }

  console.log('services.admin.rebuildComponents >>>RESULTS<<<', { result });

  return result;
}

(async function () {
  // requires an explicit env var so an accidentally-uncommented destructive line below
  // can't run just because `npm run admin` was invoked
  if (!process.env.ADMIN_CONFIRM) {
    console.log("services.admin: skipping, ADMIN_CONFIRM not set");
    return;
  }

  const ret = await backup();
  // const ret = await restore("https://<blob-store>/backups/motogpt_1.0.0_20260101_000000.json");
  // const ret = await rebuildComponents("<internal-user-id>");

  console.log("services.admin", { ret });
})();
