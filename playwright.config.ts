import { defineConfig, devices } from '@playwright/test';
import { smokeTestUserId } from './services/stores/memory';

// dedicated port so the test server doesn't collide with a manually-run `npm run dev` on 3000
const PORT = 3100;
const baseURL = `http://localhost:${PORT}`;

// ms delay between actions, e.g. SLOWMO=500 — 0 (default) keeps headless/CI runs fast
const slowMo = Number(process.env.SLOWMO) || 0;

export default defineConfig({
  testDir: './test',
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 2 : 0,
  reporter: 'list',
  use: {
    baseURL,
    trace: 'on-first-retry',
  },
  projects: [
    {
      name: 'chromium',
      use: {
        ...devices['Desktop Chrome'],
        launchOptions: { slowMo },
      },
    },
  ],
  webServer: {
    command: `npm run dev -- --port ${PORT}`,
    url: baseURL,
    reuseExistingServer: !process.env.CI,
    timeout: 120_000,
    // loads .env.local as-is (via Next.js), with these overrides taking precedence
    env: {
      NEXT_PUBLIC_MOCK_AUTH: 'true',
      // dedicated fake user id (not a real prod id) so its identity is obviously test-only;
      // services/stores/memory.ts's seed data is keyed to this same exact id
      IMPERSONATE_USER_ID: smokeTestUserId,
      // pinned to non-admin so admin-gated routes are deterministic regardless of the
      // developer's own .env.local (which is commonly set to "true" for local admin testing)
      IMPERSONATE_USER_IS_ADMIMN: 'false',
      STORE_TYPE: 'memory',
      // canned AI responses — tests must be deterministic and must not need/spend a real key
      AI_MOCK: 'true',
      // client-side uploads (lib/upload.ts) short-circuit to a fake result — tests must
      // not write to (or need) the real Blob store
      BLOB_MOCK: 'true',
    },
  },
});
