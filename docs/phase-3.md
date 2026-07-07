# Phase 3 — The assistant earns its name: implementable stories

Breakdown of [roadmap](./roadmap.md) Phase 3, continuing the numbering from [phase-2](./phase-2.md) (S7–S13). Assumes Phase 2 is done: `MaintenanceSchedule` exists per vehicle (S10), service logs carry structured `items` with canonical keys (S11), `vehicle.components` tracks current state (S12), and manual chunks are searchable (S9).

**Pre-step**: before any story, run [implementation-plans/phase-3-s0.md](./implementation-plans/phase-3-s0.md) — verify the Phase 2 handover against the code and resolve the flags raised in the plan review.

Ordering within the phase differs slightly from the roadmap: the **status engine (S14) and mileage projection (S15) come first** as pure service-layer work, because both dashboard surfaces (S16, S17) and the chat's tools (S18) consume them. Projection moved ahead of the roadmap's 3.4 slot so "next due" is time-aware from day one instead of retrofitted.

---

## S14 — Maintenance status engine (`services/maintenance.ts`)

The deterministic core: given a vehicle, compute per-schedule-item status. No AI at read time.

**Inputs**: the vehicle's `MaintenanceSchedule.items`, its logs (structured `items[].key` from S11, mileage readings, dates), `vehicle.mileage`, `vehicle.components`. **Output** per schedule item: `{ item, lastDone?: { date, mileage?, logId }, nextDue: { km?, months? → date }, status: "ok" | "upcoming" | "overdue" | "unknown" }`. `lastDone` = the newest log whose item keys match the schedule item's key; no match → due from `firstAtKm`/vehicle age, or `unknown` if that's indeterminable. "Upcoming" threshold: within 10% of the interval or 30 days, whichever is sooner (constant in one place, tune later).

**AI as gap-filler only, at write time**: free-text journal/custom logs (pre-Phase-2 history, or riders who type "lubed and adjusted chain" instead of scanning receipts) don't carry keys. On save of journal/custom logs, a cheap classification call (S1 layer, `AI_MOCK`-able) proposes `scheduleKeys?: string[]` stored on the `Log` — the engine then only ever does key equality. Plus a one-time backfill pass over existing logs (an `npm run admin` script, gated by `ADMIN_CONFIRM` per existing convention). Misclassification is low-stakes: keys are visible on the log detail page and hand-correctable via the JSON editor.

**Acceptance criteria**
- [ ] Pure-function core (schedule + logs + mileage in, statuses out) with `test/api`-level coverage of: interval by km only, by months only, by both (earlier wins), never-done items, `firstAtKm`, overdue vs. upcoming boundaries.
- [ ] `GET /api/vehicles/[id]/maintenance` returns statuses; auth/ownership per existing contract.
- [ ] Saving a custom log "lubed chain" then querying status shows chain-lube `lastDone` pointing at that log (mocked classifier in tests).
- [ ] Vehicle with no schedule → distinct "no schedule" result (not an error, not an empty success) so UIs can funnel to manual upload.
- [ ] Backfill admin script exists, is idempotent, and is a no-op without `ADMIN_CONFIRM`.

## S15 — Mileage projection (`services/mileage.ts` or within maintenance.ts)

Estimate current/future odometer between actual readings so km-based due items get dates.

- Fit km/day over the trailing window of odometer observations (mileage logs + service-log `mileage` values, newest ~6 or 90 days); `projectedMileage(vehicle, date)` and `estimatedDate(vehicle, targetKm)`.
- **Confidence is part of the contract**: `{ value, confidence: "high" | "low" | "none" }` — fewer than 2 readings or a stale window → `low`/`none`, and consumers render "~1,200 km away" without a date rather than inventing one. Never *store* projections; always computed.
- S14 uses this to convert km-due into estimated dates, making every surface time-aware ("in ~3 weeks").

**Acceptance criteria**
- [ ] Reasonable fit on synthetic fixtures (steady rider, bursty rider, single reading, no readings) with the right confidence downgrades.
- [ ] Projection never runs backward (a projected value below the last actual reading clamps to it).
- [ ] Status output (S14) includes estimated dates for km-based items when confidence permits, omits them when it doesn't.

## S16 — "Next due" on the dashboard

Replace the placeholder 🤖 message at the top of `app/page.tsx` with the real thing.

- **Card content**: across the user's vehicles, the top ~3 overdue/upcoming items — "⚠️ Oil change overdue by 400 km — CB500X" / "Chain lube due in ~2 weeks". One `GET /api/maintenance` (all vehicles) feeding a new `hooks/use-maintenance.tsx` (react-query, per existing hook conventions).
- **Every line is actionable**: tapping an item opens the service-log dialog (S11's) pre-filled with that item's key/type and vehicle — see it, do it, log it, and the engine immediately clears it. "(More)" links to the full schedule page (S17), matching the existing Entries "(More)" pattern.
- **Empty states are the funnel**: no schedule → "Upload your owner's manual and I'll track what's due" linking to the vehicle's Documents section (S8); schedule but stale mileage → prompt a mileage snap (S6); all clear → an "all caught up ✓" line (the placeholder's optimism, now earned).

**Acceptance criteria**
- [ ] Vehicle with an overdue item shows it at the top of the dashboard within one refetch of the triggering log/mileage save.
- [ ] Tapping an item → pre-filled dialog → save → item leaves the card without a manual refresh.
- [ ] Each empty state renders its funnel CTA (no schedule / stale mileage / all clear).
- [ ] Multi-vehicle: items ranked by severity (most-overdue first) across vehicles, vehicle named on each line.
- [ ] e2e spec (memory store + mocked AI): seeded overdue fixture → dashboard shows it → log it → it clears.

## S17 — Full maintenance schedule page

The "(more)" destination: `/vehicles/[id]/schedule`.

- Table of every schedule item: name/action, interval (km / months), last done (date + mileage, linking to the source log), next due (km + estimated date from S15), status badge. Sorted most-urgent first; `unknown` items grouped at the bottom with a "when did you last do this?" affordance that creates a backdated log (S13's mechanism, single-item).
- Per-row "Log it" → same pre-filled dialog as S16.
- Header links back to the source manual (document title) and to editing the schedule (S10's review table, reused for post-hoc edits).
- **Nav bookkeeping** (AGENTS.md): new route needs an `app-breadcrumbs.tsx` `pageNames` entry; sidebar `NavItems` unchanged (it's a per-vehicle subpage, reached from the vehicle page and dashboard).

**Acceptance criteria**
- [ ] Every schedule item visible with correct status/last-done/next-due against a seeded fixture; last-done links open the right log.
- [ ] "Log it" and "when did you last do this?" both produce logs that immediately update the row.
- [ ] Breadcrumbs render correctly on the new route.
- [ ] Ownership: another user's vehicle id → 403/redirect per existing behavior.

## S18 — Ask-anything chat (`/insights`)

Replace the `/insights` placeholder with a chat that can pull whatever it needs.

- **Server**: `POST /api/ai/chat` — an OpenAI tool-calling loop (in `services/ai.ts` / a new `services/assistant.ts`) with tools that are thin, **user-scoped** wrappers over existing services: `get_vehicles`, `get_logs(vehicleId?, type?, since?)`, `get_maintenance_status(vehicleId)` (S14), `search_manual(query, vehicleId)` (S9), `get_vehicle_components(vehicleId)` (S12). The route injects `user.id` into every tool call — the model never chooses the tenant. Responses stream (SSE) with a visible "checking your manual…" tool-activity indicator.
- **Images in**: reuse the S3/S4 attachment flow; an attached photo goes to the model as image input ("what's this part?", "does this chain look worn?" — with the answer grounded in that vehicle's manual via `search_manual`).
- **Citations**: answers drawing on manual chunks cite document title + page (metadata captured in S9). This is the honesty mechanism — schedule answers should come from *their* manual, visibly.
- **Conversation state**: client-held message array passed per turn, capped (last ~20 messages); no persistence entity yet — a `Chat` entity is deferred until there's demand for history. System prompt scopes the assistant: motorcycle-ownership assistant for *this user's* garage, grounded in their data, honest when data is missing ("no schedule for this bike yet — upload the manual").
- **Nav**: `/insights` already exists in `NavItems` and `pageNames`; consider renaming the label to "Assistant" (both places + breadcrumbs, per the sync rule).

**Acceptance criteria**
- [ ] "When is my next oil change?" → answer using S14 status (not model guesswork), naming km/date consistent with the schedule page.
- [ ] "What's the torque for the rear axle?" → answer citing manual title + page; same question on a vehicle with no manual → honest "I don't have your manual" + upload nudge, no fabricated spec.
- [ ] Photo upload + "what part is this?" round-trips through image input.
- [ ] Tool calls are user-scoped: a prompt-injection-style request for another user's data has no tool surface to reach it (test with two seeded users).
- [ ] Streaming renders progressively with tool-activity indicators; a tool error mid-turn degrades to an apology, not a hung UI.
- [ ] `AI_MOCK` canned tool-call script drives an e2e spec of the full loop.

---

## Sequencing & sizing

| Story | Depends on | Size |
|---|---|---|
| S14 Maintenance status engine | S10, S11 (S12 helpful) | M–L |
| S15 Mileage projection | — (data from S6/S11) | S–M |
| S16 "Next due" dashboard card | S14, S15 | M |
| S17 Full schedule page | S14, S15 | M |
| S18 Ask-anything chat | S1, S9, S14 | L |

S14+S15 first (pure services, highly testable). S16/S17 are parallel consumers. S18 is independent of S16/S17 and could start alongside them — but it lands better last, when its tools have real data behind them.

No new dependencies expected (SSE streaming via the `openai` SDK + a route handler; no chat-UI library — the existing dialog/Button/Textarea primitives suffice for v1).

Deferred from Phase 3: `Chat` persistence entity + history, proactive daily brief (Phase 4 reminders build on S14/S15 directly), voice input in chat, schedule-item taxonomy reconciliation beyond key matching, surfacing the classifier's `scheduleKeys` for inline correction (JSON editor suffices for now).

## Final step — handover to Phase 4

After the last story is implemented and verified, write `docs/handovers/phase-3-to-phase-4.md`, addressed to the agent who will plan and implement [roadmap](./roadmap.md) Phase 4. Phase 4 has no phase doc or story breakdown yet, so this handover does double duty: it briefs the implementer *and* informs whoever writes `docs/phase-4.md`. Cover:

- **The engine surfaces Phase 4 builds on**: `services/maintenance.ts` / `services/mileage.ts` exports and payload shapes as shipped (4.1 reminders are "S14 + S15 evaluated on a schedule"), the exported threshold consts, which parts are pure/client-safe vs. store-touching, and the `/api/maintenance` route contracts.
- **What 4.2 charts need**: the structured cost data actually available on service logs (`items[].cost`, `totalCost`), and a reminder that the `counters` mechanism in `@desmat/redis-store` (AGENTS.md) is still unused — note anything learned about it, and that dashboard charts are still dummy data.
- **What 4.4 search gets for free**: the embedding/search plumbing (`services/vector.ts`, `searchDocuments`) as shipped, its tenant-isolation invariant, and what it would take to index *logs* (only documents are embedded today).
- **New-infrastructure warnings for 4.1**: this app has zero scheduled/background-work machinery — record what was considered and deferred (the S9 in-route `maxDuration` compromise, the no-queue decision) so reminders don't rediscover those constraints.
- **The standing deviations/deferred ledger**: everything from the Phase 1–2 handovers still outstanding, plus Phase 3's own (chat persistence, classifier-correction UI, etc.), deviations from these plans, seed/mock state (including the S18 scripted assistant turn), and prompt locations + tuning notes for all four high-leverage prompts.
