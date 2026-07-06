# MotoGPT

MotoGPT is a Next.js app for tracking motorcycle maintenance — vehicles, mileage, and maintenance/journal logs — with AI-generated service recommendations planned.

## Getting Started

Install dependencies and start the development server:

```bash
npm install
npm run dev
```

Open [http://localhost:3000](http://localhost:3000) with your browser to see the result.

The app reads its required credentials from `.env.local`. See `AGENTS.md` for the full environment variable list.

## Tests

Playwright tests live under `test/`: `test/e2e` for browser-driven UI specs, `test/api` for HTTP-level API/integration specs. Both start their own Next.js development server on port 3100. Install the browser once:

```bash
npx playwright install chromium
```

Run the whole suite headlessly:

```bash
npm run test
```

Or scope it to one kind:

```bash
npm run test:e2e
npm run test:api
```

Watch the UI specs run in a headed browser with a short delay between actions:

```bash
npm run test:e2e:headed
```

The Playwright server loads `.env.local`, enables mock authentication, and supplies the test user configured in `playwright.config.ts`. A manually running server on port 3100 is reused outside CI.

## Bypassing auth in development

Set `NEXT_PUBLIC_MOCK_AUTH=true` in `.env.local` to skip Clerk entirely and use a mock user (see `lib/mock-auth.ts`).

The mock user's id and admin status can be customized with `IMPERSONATE_USER_ID` and `IMPERSONATE_USER_IS_ADMIMN`.

## Running without a real Redis instance

Set `STORE_TYPE=memory` in `.env.local` to swap the real Upstash-backed store for an in-memory one (`services/stores/memory.ts`, built on `@desmat/redis-store`'s `MemoryStore`) — no `KV_REST_API_URL`/`KV_REST_API_TOKEN` needed. Ignored when `NODE_ENV=production`.

It comes pre-seeded with a small fixed dataset — a couple of vehicles and a short history of logs for a dedicated `user_smoketest` user — so the dashboard has something to show right away. Data lives only in memory for the life of the process: nothing is persisted, and it resets on restart.

The Playwright suite (`npm run test`) always runs against this in-memory store, impersonating that same `user_smoketest` user, so it needs no Upstash credentials at all.
