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

**Test-isolation convention** (matters because `playwright.config.ts` runs `fullyParallel: true` against a single webServer, hence a single in-memory store shared by the whole run): **specs create their own records via the API — the seeds in `services/stores/memory.ts` are dev conveniences, not a test contract.** Mutating a seeded record (e.g. overwriting the CB500X's mileage) races other specs; but even read-only assertions against seed ids/values/ordering are brittle (they break when seeds change or when parallel specs shift list positions) — prefer creating a record with a unique id/href and asserting on that. A spec that needs a vehicle in a particular state (e.g. a known starting mileage) should POST one with that state, then act on it.

**Next 16 gotcha**: Next allows only one dev server per project directory — a second `next dev` refuses to start ("Another next dev server is already running"), *even on a different port*; the lock is per-directory, not per-port. In practice: `npm run test` fails at its webServer step whenever any dev server for this repo is already running (the usual `npm run dev`, or a throwaway one started for screenshots) — stop it first (the error message prints the PID to kill).

**Stale `.next` gotcha**: if e2e specs start failing with page content mysteriously not rendering (sidebar present, `<main>` empty) and the webServer output shows `[browser] ⨯ unhandledRejection: ChunkLoadError: Failed to load chunk …`, the Turbopack dev cache is corrupt — `rm -rf .next` and rerun. Seen after alternating dev-server sessions with different env (e.g. a manual `npm run dev` with real-key env between test runs); the failures look flaky and land on unrelated specs.

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

**Entity detail pages**: `/vehicles/[id]`, `/logs/[id]`, and `/user` all render `components/json-editor.tsx` — a textarea with the record's pretty-printed JSON that the user edits and PUTs back directly. The PUT routes pin identity fields (`id`, `userId`/`providerId`, `createdAt`, `createdBy`) to the existing record so those can't actually be changed from the editor. When replacing this (or the plain-`useState` record dialogs) with real field-level forms, read `docs/form-patterns.md` first — it documents the generic record-editing pattern from the Vice project this repo was forked from, and where to recover that code.

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
5. **API routes** (`app/api/.../route.ts` + `.../[id]/route.ts`): call `currentUser()` (`services/users.ts`) first and 403 if missing, scope reads by `user: user.id`, ownership-check on `[id]` routes, and pin identity fields on PUT. Use the shared helpers in `lib/api.ts` (`authorizationFailed()`/`notFound()`/`badRequest()`/`canAccess(user, record)`) rather than hand-rolling the JSON error responses — note `proxy.ts` already session-gates every non-public route, so the in-route check is defense-in-depth that falls out of needing `user.id` anyway. Copy `app/api/vehicles/route.ts` + `[id]/route.ts`. **Gotcha**: when stripping a client-supplied `id` before create, destructure it off the object — an explicit `id: undefined` key survives the store's spread in `create()` and clobbers the generated short UUID.
6. **Hook** (`hooks/use-some-entity.tsx`): `useQuery`/`useMutation` from `@tanstack/react-query` calling the API routes (never the services directly from client code). Copy `hooks/use-vehicle.tsx`.

If the entity needs dashboard-style aggregation (counts/totals over time), `@desmat/redis-store` supports it via a `counters` list on the entity's `Options` plus `store.<entity>.incCounters()`/`.queryCounter()` calls in service code — nothing in this app uses it yet (the dashboard charts are dummy data), but that's the mechanism to reach for when replacing them with real reports.

## Env-var-exposure footgun

Non-`NEXT_PUBLIC_`-prefixed vars read directly in client code (`hooks/use-user.tsx`, `app-sidebar.tsx`, `app-bottom-bar.tsx` all read `IMPERSONATE_USER_*`/`GIT_COMMIT_*`; `lib/upload.ts` reads `BLOB_MOCK`) only work because `next.config.mjs`'s `env` block explicitly whitelists those exact names — a new var added the same way without a matching `next.config.mjs` entry silently becomes `undefined` in the browser. The pattern to repeat for new vars is "whitelist the exact name in `next.config.mjs`", not a rename to `NEXT_PUBLIC_*`. (Historical note: the `IMPERSONATE_USER_IS_ADMIMN` name is a long-standing typo kept for consistency across `next.config.mjs`/`lib/mock-auth.ts`/`.env.local`.)

## Required environment variables

Set in `.env.local` (not committed): `CLERK_SECRET_KEY`, `NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY`, `API_KEY`, `KV_URL`, `KV_REST_API_URL`, `KV_REST_API_TOKEN`, `KV_REST_API_READ_ONLY_TOKEN`, `BLOB_READ_WRITE_TOKEN`, `OPENAI_API_KEY` (server-only, used by `services/ai.ts`; **must not** be added to `next.config.mjs`'s `env` whitelist — that block exposes vars to the browser, which is exactly wrong for a secret), `UPSTASH_VECTOR_REST_URL` / `UPSTASH_VECTOR_REST_TOKEN` (server-only, used by `services/vector.ts`; **must not** be added to `next.config.mjs`'s `env` whitelist for the same reason; create the Upstash Vector index with **cosine metric and 1536 dimensions** to match `text-embedding-3-small`, the embedding model in `services/ai.ts`'s `MODELS`), and optionally `IMPERSONATE_USER_ID` / `IMPERSONATE_USER_IS_ADMIMN`.

Also optional, for local dev/tests without a real Upstash instance: `STORE_TYPE=memory` swaps `createStore()` to an in-memory store (ignored when `NODE_ENV=production`), pre-populated with the small hard-coded fixture in `services/stores/memory.ts` (not loaded from a file, since `proxy.ts` runs in the Edge runtime, which has no `fs`). Writes made during the session are not persisted anywhere. Similarly `AI_MOCK=true` makes `services/ai.ts` return canned responses instead of calling OpenAI — same deterministic-and-free motivation; the canned responses live in `test/fixtures/ai-mocks.json` (keyed by `schemaName`, lazily `fs`-read only in mock mode — fine because `services/ai.ts` is Node-runtime-only, unlike `proxy.ts`); Playwright sets it in `playwright.config.ts`. The same knob also mocks embeddings and vector search (one knob on purpose — a mocked vector store is useless without mocked embeddings and vice versa): `services/ai.ts`'s `embed()` returns deterministic bag-of-words hash vectors (computed in code, not from the fixtures file — an embedding is a function of its input), and `services/vector.ts` swaps Upstash Vector for an in-memory store with brute-force cosine similarity — no Upstash Vector instance or env vars needed. And `BLOB_MOCK=true` makes `lib/upload.ts`'s `uploadFile()` return a fake result (unique mock pathname + data-URL of the file contents) instead of uploading to the real Blob store — this one is read in **client** code, so it's whitelisted by exact name in `next.config.mjs`'s `env` block (see the footgun above); Playwright sets it too.
