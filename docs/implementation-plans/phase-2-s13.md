# S13 — AI onboarding interview

Story: [phase-2.md](../phase-2.md) § S13. Depends on S1; each of S8–S12 it can *use* makes it richer, but the only hard requirement beyond S1 is S11's `Log` fields (proposed backdated logs carry `items`/`mileage`). Last story of the phase — it stitches the others together.

## Design

- **Augment, don't replace**: `SetupVehicleDialog` (forced mode) stays exactly as is; on successful first-vehicle submit, the interview dialog opens. A dismissible "Finish setting up your ⟨vehicleName⟩ — 2 min" card on the dashboard re-offers it while the vehicle has no logs; dismissal is remembered in localStorage (`services/localstorage.ts` helpers already exist) — deliberately *not* a new persisted field for a one-time UI nudge.
- **One structured AI call per turn, no server-side session.** `POST /api/ai/onboarding` receives `{ vehicleId, messages }` (client-held transcript, S18-style) and returns a single JSON object — the model is *always* in structured-output mode:
  ```
  { message: string,                 // next question / acknowledgement to render
    done: boolean,                   // true → proposal is final
    proposal: { mileage: number | null,
                logs: [{ type: "service" | "mileage" | "journal", date (YYYYMMDD, estimated ok),
                         entry, items?: [{ key, name, action }], mileage?: number,
                         estimated: boolean }] } }
  ```
  The proposal is rebuilt cumulatively every turn, so "done" needs no merge logic and an aborted session loses nothing that matters. New `services/ai.ts` function `chatJSON({ messages, schemaName, schema })` (chat with `response_format: json_schema` — `extractFromImage` minus the image; refactor to share the internals). System prompt: interview for *this* vehicle (maker/model/year/mileage interpolated), one question at a time, ≤ ~5 questions (mileage → last oil change → chain/tires → anything recent), convert vague answers ("maybe 2k km ago") into estimated dates/mileages marked `estimated: true`, use `CANONICAL_COMPONENT_KEYS`.
- **Nothing persists without the confirm screen** (phase-doc AC). On `done`, the dialog swaps to the S10 `extracted-rows` table of proposed logs (columns: date, type, entry, estimated-badge; rows deletable/editable) + Confirm → client POSTs each log through the normal `/api/logs` (backdated `date` honored by `saveLog`; `items` flow into S12's components; `mileage` follows S11's monotonic rule; the *current-mileage* answer goes as a `mileage`-type log so it overwrite-sets the vehicle). Skip/close at any point creates nothing.
- **Manual upload mid-interview**: when the model's question mentions the owner's manual (schema addition: `suggestUpload: boolean` on the turn), render S8's upload affordance inline in the chat; upload+ingest proceed in the background (S9 is status-driven) and the interview just continues. If S8 isn't built yet, this degrades to a link to the vehicle page — gate on a simple feature check, don't block the story.
- **`AI_MOCK` is a scripted state machine**: the mock keys off `messages.length` to walk a fixed 3-question script ending in a deterministic proposal (one estimated backdated service log + a current mileage) — drives the e2e spec.

## Files

- `services/ai.ts`: `chatJSON(...)` + `onboarding` scripted mock.
- `app/api/ai/onboarding/route.ts`: auth → vehicle ownership check (the `vehicleId` in the body must be the caller's, same pattern as logs POST) → interpolate vehicle into the system prompt → `chatJSON` → return the turn. Cap `messages` at ~20 (drop oldest) before the call. `trackEvent("onboarding-turn", { userId, vehicleId, done })`.
- `components/onboarding-interview.tsx`: Dialog with a scrolling message list (user/assistant bubbles — plain flex + muted styling, no chat library), text input + Send (enter submits), Skip button always visible; `suggestUpload` renders the upload button inline; `done` swaps body to the review table + Confirm/Skip. On confirm: sequential `useLog().add` calls, then close + toast (`sonner` is already a dependency).
- `app/signed-in-page-main.tsx`: hold the just-created vehicle from `addVehicle`'s response and render `<OnboardingInterview vehicle=... open />` after the setup dialog closes.
- `app/page.tsx`: the "finish setting up" card — shown when some vehicle has zero logs and localStorage hasn't dismissed it; opens the interview for that vehicle.
- `test/api/onboarding.spec.ts`: route walks the scripted mock (3 turns → `done` with the canned proposal); wrong-owner `vehicleId` → 400/403; transcript over cap doesn't error.
- e2e: fresh-user flow can't run under the seeded store (seed includes vehicles+logs), so: create a *new* vehicle via the API in the spec, open its finish-setup path, walk the scripted interview in the browser, confirm, assert the backdated log + mileage exist and the card disappears.

## Steps

1. `chatJSON` + scripted mock → 2. route → 3. dialog component → 4. wiring (post-setup + dashboard card) → 5. specs → 6. lint/build/test.
7. Manual with a real key: run the interview for a real bike; judge question quality and the estimated-date conversions; tune the system prompt (third of the three high-leverage prompts, after S10/S11).

## Out of scope

VIN photo decode (deferred-list item), voice input, persisting interview transcripts, re-running the interview for established vehicles ("catch-up" mode — natural Phase 3+ follow-on), generic-schedule generation for manual-less bikes (Phase 3's `source: "generic"`).
