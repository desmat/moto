# AGENTS.md

This file provides guidance to coding agents working in this repository.

## Commands

- `npm run dev` — start the Next.js dev server
- `npm run build` — production build (also type-checks)
- `npm run start` — run the production build
- `npm run lint` — ESLint (`next/core-web-vitals`)
- `npm run admin` — run `services/admin.ts` directly via `tsx`, for one-off backup/restore scripts against the live Redis store (reads `.env.local` via `dotenv`). Requires `ADMIN_CONFIRM` to be set (any value) or it's a no-op — this is friction to stop an accidentally-uncommented destructive line from running just because the script was invoked.
- `npm run test` — run the full Playwright suite (`test/e2e` + `test/api`) headlessly in Chromium
- `npm run test:e2e` — run only the browser-driven smoke tests in `test/e2e`
- `npm run test:e2e:headed` — run `test/e2e` in a visible browser with slow motion enabled
- `npm run test:api` — run only the API-level integration tests in `test/api` (no browser/UI involved, hits routes directly via Playwright's `request` fixture)

Tests live under `test/`: `test/e2e` for browser-driven UI specs, `test/api` for HTTP-level API/integration specs. Playwright starts a dedicated Next.js server on port 3100, loads `.env.local`, and overrides auth with `NEXT_PUBLIC_MOCK_AUTH=true` plus the test user from `playwright.config.ts`. Install the browser with `npx playwright install chromium` before the first run. There is no unit-test runner configured.

## Architecture

MotoGPT is a Next.js 14 App Router app for tracking motorcycle maintenance (vehicles, mileage, maintenance/journal logs) with AI-generated service recommendations planned (`/insights` is currently a placeholder).

**Layering**: `app/api/*/route.ts` (HTTP handlers) → `services/*.ts` (domain logic) → `services/stores/index.ts` (`createStore()`, one store instance per entity, from `@desmat/redis-store`) → Upstash Redis. `createStore()` normally builds `RedisStore<T>` instances (`services/stores/redis.ts`), but switches to in-memory `MemoryStore<T>` instances (`services/stores/memory.ts`) when `STORE_TYPE=memory` — see "Required environment variables" below. Both backends share entity configs (`key`/`setKey`/`options`) from `services/stores/config.ts` so they can't drift apart. Redis keys are prefixed `Moto` (`MotoUser`, `MotoVehicle`, `MotoLog`). Client components call the API routes through hooks in `hooks/use-*.tsx` (built on `@tanstack/react-query`), never the services directly. Each domain has a matching type in `types/`, a service in `services/`, an API route in `app/api/`, and a hook in `hooks/`.

**Domain model**: three entities, all with short-UUID `id` (minted by the store's `create()`, 8 hex chars), `createdAt`, and optional `updatedAt`/`deletedAt`:
- `User` (`types/User.ts`) — the internal `id` is a short UUID, NOT the auth provider's user id; Clerk's id lives on `providerId` (resolved via the `provider` lookup) alongside snapshotted provider fields (`email`, `name`, `imageUrl`, `authData`). `services/users.ts`'s `resolveUser()` does the find-or-create; `currentUser()` returns a `SessionUser` whose `id` is the internal one.
- `Vehicle` (`types/Vehicle.ts`) — belongs to a user via `userId`; `type`/`maker`/`model`/`year`/`mileage`/`modifications`.
- `Log` (`types/Log.ts`) — belongs to a user (`userId`) and a vehicle (`vehicleId`); just `type`/`date` (YYYYMMDD)/`entry`. `type` is `"journal"`, `"mileage"`, or any user-entered custom string. Saving a `"mileage"` log also updates the owning vehicle's `mileage` field (`services/logs.ts`'s `saveLog()`), so the vehicle record always reflects the latest reading.

**Auth**: Clerk. `proxy.ts` (Next.js 16's rename of the `middleware.ts` file convention — same default-export shape) gates every route except `/`:
- `/api/admin*` is instead authorized via a static `x-api-key` header checked against `API_KEY` (no Clerk session), for server-to-server/admin calls (no such routes currently exist; the gate remains for when they do).
- All other non-public routes require a Clerk session; on success the proxy calls `resolveUser()` (`services/users.ts`) to upsert the user record (keyed by internal short UUID, looked up by `providerId`), then lets the request through. Missing auth returns 403 JSON for API routes and redirects to `/` otherwise.
- `IMPERSONATE_USER_ID` short-circuits `currentUser()` to that exact id (used directly as the internal user id, no provider mapping) for local/admin testing; mock-auth mode (`NEXT_PUBLIC_MOCK_AUTH=true`, see `lib/mock-auth.ts`) does the same with the mock identity.

**Onboarding**: `app/signed-in-page-main.tsx` forces the add-a-vehicle dialog (`components/setup-vehicle-dialog.tsx`) whenever the signed-in user has zero vehicles; the same component doubles as the Vehicles page's "Add Vehicle" dialog.

**Dashboard** (`app/page.tsx`): placeholder AI message at the top, Record buttons (Journal Entry / Current Mileage / Custom — all through `components/log-entry-dialog.tsx`, which includes a vehicle picker defaulting to the most recently logged vehicle), charts, and the latest-entries list. The charts (`components/charts/DailyGauge|HourlyPatternChart|DailySummaryChart.tsx`, built on echarts via `components/charts/Chart.tsx`) currently render **deterministic dummy data** (`components/charts/dummy-data.ts`) — there is no reporting/counter machinery wired up yet.

**Entity detail pages**: `/vehicles/[id]`, `/logs/[id]`, and `/user` all render `components/json-editor.tsx` — a textarea with the record's pretty-printed JSON that the user edits and PUTs back directly. The PUT routes pin identity fields (`id`, `userId`/`providerId`, `createdAt`, `createdBy`) to the existing record so those can't actually be changed from the editor.

**Nav**: sidebar items live in `app-sidebar.tsx`'s `NavItems` (Vehicles, Logs, Insights, User); `app-bottom-bar.tsx` imports and reuses `NavItems`; `app-breadcrumbs.tsx` has a separate `pageNames` map — keep both in sync by hand when routes change.

**Path alias**: `@/*` maps to the repo root (see `tsconfig.json`).

## Adding a new entity

Each domain entity touches six places. Use `Vehicle` as the reference for a plain CRUD entity (`types/Vehicle.ts`, `services/vehicles.ts`, `app/api/vehicles/{route.ts,[id]/route.ts}`, `hooks/use-vehicle.tsx`).

1. **Type** (`types/*.ts`): add the record type (must satisfy `RedisStoreRecord`: `id`, `createdAt`, plus optional `updatedAt`/`deletedAt`) and an `Options` const next to it — at minimum `{ hardDelete: true }`, plus `lookups: { name: "fieldOnRecord" }` for any field you'll want to query by (enables `store.<entity>.find({ name: value })`).
2. **Store config** (`services/stores/config.ts`): add one entry to `storeConfigs` — `{ key: "MotoSomeEntity", setKey?: "MotoSomeEntities", options: SomeEntityOptions }`. This is the single source of truth both backends read from; don't hardcode `key`/`options` again anywhere else. Keep the `Moto` key prefix.
3. **Wire both backends** — easy to miss since only one usually gets exercised in local dev:
   - `services/stores/redis.ts`: add `someEntity: new RedisStore<SomeEntity>({ ...storeConfigs.someEntity, debug })` to the returned object.
   - `services/stores/memory.ts`: add the equivalent `new MemoryStore<SomeEntity>({ ...storeConfigs.someEntity, debug, seed: seed.someEntity })` to `buildStore()`'s returned object. If you want the entity to have sample data when `STORE_TYPE=memory` (see below), add records to the hard-coded `seed` object at the top of that file, keyed to `smokeTestUserId`.
4. **Service** (`services/some-entity.ts`): `const store = createStore({ debug: true })` at module scope, then thin wrapper functions — `getSomeEntities(query)` → `store.someEntity.find(query)`, `getSomeEntity(id)` → `.get(id)`, `saveSomeEntity(value, by)` → `.exists()` then `.update()`/`.create()`, `deleteSomeEntity(id)` → `.delete(id)`. Copy `services/vehicles.ts` almost verbatim.
5. **API routes** (`app/api/.../route.ts` + `.../[id]/route.ts`): call `currentUser()` (`services/users.ts`) first and 403 if missing, scope reads by `user: user.id`, ownership-check (`record.userId == user.id || isAdmin`) on `[id]` routes, and pin identity fields on PUT. Copy `app/api/vehicles/route.ts` + `[id]/route.ts`. **Gotcha**: when stripping a client-supplied `id` before create, destructure it off the object — an explicit `id: undefined` key survives the store's spread in `create()` and clobbers the generated short UUID.
6. **Hook** (`hooks/use-some-entity.tsx`): `useQuery`/`useMutation` from `@tanstack/react-query` calling the API routes (never the services directly from client code). Copy `hooks/use-vehicle.tsx`.

If the entity needs dashboard-style aggregation (counts/totals over time), `@desmat/redis-store` supports it via a `counters` list on the entity's `Options` plus `store.<entity>.incCounters()`/`.queryCounter()` calls in service code — nothing in this app uses it yet (the dashboard charts are dummy data), but that's the mechanism to reach for when replacing them with real reports.

## Env-var-exposure footgun

Non-`NEXT_PUBLIC_`-prefixed vars read directly in client code (`hooks/use-user.tsx`, `app-sidebar.tsx`, `app-bottom-bar.tsx` all read `IMPERSONATE_USER_*`/`GIT_COMMIT_*`) only work because `next.config.mjs`'s `env` block explicitly whitelists those exact names — a new var added the same way without a matching `next.config.mjs` entry silently becomes `undefined` in the browser. The pattern to repeat for new vars is "whitelist the exact name in `next.config.mjs`", not a rename to `NEXT_PUBLIC_*`. (Historical note: the `IMPERSONATE_USER_IS_ADMIMN` name is a long-standing typo kept for consistency across `next.config.mjs`/`lib/mock-auth.ts`/`.env.local`.)

## Required environment variables

Set in `.env.local` (not committed): `CLERK_SECRET_KEY`, `NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY`, `API_KEY`, `KV_URL`, `KV_REST_API_URL`, `KV_REST_API_TOKEN`, `KV_REST_API_READ_ONLY_TOKEN`, `BLOB_READ_WRITE_TOKEN`, and optionally `IMPERSONATE_USER_ID` / `IMPERSONATE_USER_IS_ADMIMN`.

Also optional, for local dev/tests without a real Upstash instance: `STORE_TYPE=memory` swaps `createStore()` to an in-memory store (ignored when `NODE_ENV=production`), pre-populated with the small hard-coded fixture in `services/stores/memory.ts` (not loaded from a file, since `proxy.ts` runs in the Edge runtime, which has no `fs`). Writes made during the session are not persisted anywhere.
