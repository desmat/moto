# S18 — Ask-anything chat (`/insights`)

Story: [phase-3.md](../phase-3.md) § S18. Depends on S1 (AI layer), S9 (`searchDocuments`), S14 (status engine); S4 (attachments) for images-in. The `/insights` placeholder becomes the assistant.

## Design

- **Tool loop lives in `services/assistant.ts`**, not the route: `runAssistantTurn({ user, messages, onEvent })`. Tools are thin wrappers over existing services with **`user.id` injected by the wrapper, never chosen by the model** — the tenant-isolation invariant. Tool set (OpenAI function definitions + impls side by side):
  - `get_vehicles()` → `getVehicles({ user })` (incl. `mileage`, `components`)
  - `get_logs({ vehicleId?, type?, count? })` → `getLogs`, capped at 50, newest first
  - `get_maintenance_status({ vehicleId })` → S14's `getVehicleMaintenance`
  - `search_manual({ query, vehicleId })` → S9's `searchDocuments`, results enriched with the document's `title` for citations
  - Loop: call model → execute any `tool_calls` (parallel-safe; each in try/catch → an `{"error": ...}` tool result, never a thrown turn) → append → repeat, `MAX_TOOL_ITERATIONS = 6` → final text.
- **Streaming as SSE with two event types**: `{ type: "tool", name }` when a tool call starts (the "checking your manual…" indicator) and `{ type: "delta", text }` for final-answer tokens (stream only the last model call; intermediate tool-selection calls run non-streaming — simpler, and the user-visible latency lives in the final answer anyway). Route `POST /api/ai/chat` returns a `ReadableStream` (`text/event-stream`), `maxDuration = 120`, standard auth preamble.
- **Client-held conversation** (no persistence entity): the page keeps `messages` in state, sends the last 20 per turn. Images: reuse the S4 attach flow — an uploaded image's blob URL goes into the user message as an image content part (multimodal input rides the normal message array; the S6/S11 vision plumbing already proves the URL path works).
- **System prompt**: motorcycle-ownership assistant for this user's garage; *always* prefer tools over memory for anything vehicle-specific; cite manual answers as "(⟨title⟩, p.⟨page⟩)"; when data is missing say so and point at the fix ("no schedule for this bike yet — upload the manual on its vehicle page"); refuse nothing about the user's own data, invent nothing about specs.
- **`AI_MOCK` is a scripted turn**: emits one `tool` event (`get_maintenance_status`) then streams a canned answer that quotes the seeded overdue chain item — deterministic e2e coverage of the whole SSE render path. (S0 recheck: the canned text is static — no live-data dependency, so it can't race parallel specs — but keep its wording consistent with S16's reworked seed math: chain overdue by ~10 days on the CB500X.)
- **Nav rename**: "Insights" → "Assistant" — label in `app-sidebar.tsx` `NavItems` and `app-breadcrumbs.tsx` `pageNames` (the hand-sync rule; route stays `/insights`, cheap and link-stable).

## Files

- `services/assistant.ts`: tool defs + impls + loop + system prompt const, per Design. Model calls through `services/ai.ts` (add a thin `chatStream`/raw-client accessor rather than re-wrapping every OpenAI option — the assistant is the one caller that legitimately needs the full chat surface; keep the client singleton + mock gate in `ai.ts`).
- `app/api/ai/chat/route.ts`: auth → parse `{ messages }` → wire `onEvent` to an SSE `ReadableStream`. `trackEvent("assistant-turn", { userId, toolCalls })` after completion.
- `app/insights/page.tsx`: replace the placeholder — message list (user right / assistant left, muted tool-indicator lines in place while running), `Textarea` + send (enter submits, shift-enter newline), attach button (S4 pieces) adding an image chip to the pending message, "thinking…" state until the first event. Parse SSE via `fetch` + `ReadersableStream` reader (no `EventSource` — it can't POST). Markdown-lite rendering: keep v1 to whitespace + line breaks (no new markdown dep; revisit when answers demand it).
- `components/app-sidebar.tsx` + `components/app-breadcrumbs.tsx`: the rename, both files, same commit.
- `test/api/assistant.spec.ts`: POST with a question → response is `text/event-stream` containing a `tool` event and deltas assembling the canned answer; two-user isolation is design-enforced (wrappers), asserted here by the canned turn only ever containing seeded-user data — plus a code-review-level check that no tool signature accepts a `userId`.
- e2e: `/insights` → type "what's due on my bike?" → tool indicator appears, then the canned answer text (streamed) renders mentioning the seeded chain item; attach-image spec: `setInputFiles` → chip renders → send → turn completes (mock ignores the image; the assertion is that the pipeline doesn't choke on content parts).

## Steps

1. `services/assistant.ts` (loop + tools, non-streaming first) → 2. route + SSE → 3. streaming + tool events → 4. page UI → 5. mock script → 6. rename → 7. specs → 8. lint/build/test.
9. Manual with a real key — the real acceptance pass: "when's my next oil change?" (matches the schedule page's numbers), "torque for the rear axle?" against a bike **with** a manual (citation present) and one **without** (honest miss + nudge), chain photo + "does this look worn?". Tune the system prompt last (fourth high-leverage prompt).

## Out of scope

Chat history persistence (`Chat` entity deferred until missed), markdown/rich rendering, voice, proactive daily brief (Phase 4 reads the same engine), rate limiting/cost caps (watch real usage first), tool for *writing* data (the assistant only reads in v1 — logging stays one tap away in the UI; a `record_log` tool is a natural, deliberate follow-on).
