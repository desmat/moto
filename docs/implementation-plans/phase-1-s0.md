# S0 — Phase 1 pre-flight

Run this before starting any Phase 1 story. Phase 1 has no previous phase, so there is no handover to read — this pre-step instead pins down groundwork and resolves the flags raised in the plan review, so the fixes land in the plans before an implementing agent builds on the flawed lines.

## Groundwork checks

- [ ] Read AGENTS.md end to end — the six-touchpoint entity pattern, the env-var-exposure footgun, and the Next 16 one-dev-server-per-project lock all bite in this phase.
- [ ] Dependencies already in place per the phase doc: `openai` (v4), `@vercel/blob`, `moment`; `BLOB_READ_WRITE_TOKEN` already required. `OPENAI_API_KEY` in `.env.local` is a user action — confirm it's there before S1's real-key verification step.
- [ ] Baseline suite is green before any change: stop any running dev server, `npm run test`.

## Review flags to resolve (raised against these plans — fix the plans first)

1. **Internal user id on the client — S3/S4 name the wrong hook.** Both plans say the client gets the internal short-uuid from `useUser()`. Per `hooks/use-user.tsx`, `useUser()` returns the *auth provider's* session user — a Clerk `user_…` id in production; the internal id lives on `useUserRecord()`. A `moto/{userId}/` pathname built from `useUser()` never matches the `currentUser().id` prefix the server enforces, so every real-Clerk upload is rejected at token time — while mock-auth/impersonated dev and tests pass (the ids coincide there). Decide: use `useUserRecord()` client-side, or (stronger) have `onBeforeGenerateToken` derive/enforce the prefix from `currentUser()` server-side and stop trusting the client-built pathname at all. Correct the S3 and S4 plans before starting S3.
2. **`BLOB_MOCK` pathname collisions — S3's mock path is deterministic.** `moto/{userId}/mock-{file.name}` + the attachments POST's idempotency-by-pathname + S4's "never steal from another log" linking guard means the *second* spec to upload a shared fixture (S4 and S6 both use `test/fixtures/odometer.jpg`, by design) gets the first spec's already-linked record back and its log silently ends up with no attachment. Fix in the S3 plan: random/timestamp suffix in the mock path, mirroring the real flow's `addRandomSuffix`.
3. **Test isolation vs. the shared memory store — decide the convention now.** `playwright.config.ts` runs `fullyParallel: true` against one webServer and therefore one in-memory store per suite run. S6's e2e overwrites the seeded CB500X's mileage; Phase 3 plans assert exact seed arithmetic on that same vehicle. Adopt and write down (in AGENTS.md's test paragraph or a `test/README.md`) a suite-wide rule before specs accumulate: **specs that mutate vehicle/log state create their own vehicle via the API; seeded records are read-only fixtures.** Annotate S6's e2e accordingly (create a fresh vehicle instead of mutating the CB500X).

## Output

The S3/S4/S6 plan files corrected per the above, the test-isolation convention recorded, and the baseline suite green. Then start S1.
