# Roadmap: AI-Powered Motorcycle Ownership Assistant

The overall theme: MotoGPT becomes an AI-powered motorcycle ownership assistant. Everything the user captures (logs, photos, receipts, manuals) is stored as structured, searchable data so the AI can record now and reason later. All AI capabilities (chat, OCR, embeddings, structured extraction) go through the **OpenAI API**. Guiding principle throughout: **as low friction as possible** — especially on a phone, mid-wrenching or at the pump.

Ordering logic: build the substrate (attachments + AI plumbing) first, ship a small visible AI win early, then the document pipeline that everything smart depends on, then the intelligence layer, then proactive/reporting features that need accumulated data to be useful.

## Phase 1 — Substrate + first AI win

### 1.1 OpenAI service layer
A single `services/ai.ts` wrapping the OpenAI API (chat, vision/OCR, embeddings, structured outputs), `OPENAI_API_KEY` in env. Every later story calls through this — worth getting right once (model config, retries, debug/logging story) rather than scattering client calls.

### 1.2 Attachments on logs
Pic/file upload on Journal, Mileage, and Custom entries. New `Attachment` entity (following the six-touchpoint entity pattern in AGENTS.md) pointing at Vercel Blob — `BLOB_READ_WRITE_TOKEN` is already provisioned. Camera capture on mobile, not just a file picker, since low-friction phone use is the main scenario.

### 1.3 Odometer photo → mileage log
Snap a pic, OCR reads the number, user confirms one pre-filled field, done. Deliberately sequenced here: it's the smallest possible slice through the whole new stack (camera → blob → OpenAI vision → confirm → save), so it validates the pipeline that receipts and manuals will reuse, and it's a demoable low-friction win.

## Phase 2 — Documents become data

### 2.1 `Document` entity + ingestion pipeline
Upload PDF/photo → extract text → chunk → embed → searchable. This is the load-bearing build of the whole roadmap. One upfront decision: where embeddings live — Upstash Vector is the natural fit next to the existing Upstash Redis, vs. stuffing vectors into Redis and brute-forcing similarity (fine at owner's-manual scale, but a dead end).

### 2.2 Owner's manual ingestion
Upload the manual against a vehicle; AI extracts a structured `MaintenanceSchedule` (items × intervals in km/miles/months) as its own entity, plus the chunked full text for later Q&A. The structured schedule is the key output — 3.1 and 3.2 consume it directly, no AI call needed at read time.

### 2.3 Receipt/invoice scan
Photo of a service receipt → AI extracts date, mileage, line items (what was changed/checked/adjusted), cost → saved as a service log with structured items, receipt image attached. User reviews before save. This turns service history from prose into data the schedule engine can match against.

### 2.4 AI onboarding interview
Replace/augment the setup-vehicle dialog with a short conversational session: model/year (or VIN photo), current mileage, "when was your last oil change / chain / tires?" — answers get seeded as backdated logs so the intelligence layer has a baseline from day one. Sequenced here because its whole value is feeding phases 2–3; a basic version could ship earlier for the wow-factor.

## Phase 3 — The assistant earns its name

### 3.1 "Next due" on the dashboard
Schedule + service history + current mileage → the top N upcoming/overdue items per vehicle. Mostly deterministic computation over Phase 2 data (AI only fills gaps, e.g. matching "lubed chain" prose to a schedule item). This replaces the placeholder AI message with the real thing.

### 3.2 Full maintenance schedule page
The "(more)" link: every schedule item with last-done / next-due / status. Cheap once 3.1 exists.

### 3.3 Ask-anything chat
Chat surface (probably where `/insights` sits as a placeholder) where the AI has tools to pull vehicle details, log history, and manual chunks, plus image upload ("what's this part?", "does this chain look worn?"). OpenAI tool-calling against thin wrappers over the existing services.

### 3.4 Mileage projection
Estimate current odometer from logging cadence so "next due" stays honest between mileage entries — and it makes 3.1 time-aware ("~3 weeks away") instead of only distance-aware.

## Phase 4 — Proactive + payoff features

### 4.1 Reminders/notifications
Email (or push later) when a projected due date approaches. Needs 3.1 + 3.4; first feature requiring scheduled background work, which is new infrastructure for this app.

### 4.2 Real dashboard charts
Spend over time, activity, per-category costs from receipt data — replacing the dummy-data charts via the `counters` mechanism in `@desmat/redis-store` that AGENTS.md notes is sitting unused.

### 4.3 Service history export / share link
PDF or read-only link of a vehicle's full documented history — resale value payoff; only worth building once histories are rich.

### 4.4 Log search & filter
By vehicle, type, date range, free text (and semantic search rides on the Phase 2 embedding infra for free).

## Deferred but noted

Fuel logs, recall lookups, warranty tracking, consumables/parts shopping lists, seasonal checklists, multi-vehicle dashboards, sold/retired lifecycle, CSV import, voice dictation. All good; none block the core loop, and several (voice entry, consumables) become much easier once the Phase 1–2 plumbing exists.

## Cross-cutting decisions to settle before Phase 2

- **(a) Embeddings storage**: lean is Upstash Vector — stays in the Upstash ecosystem. 
  - decision: Upstash Vector
- **(b) Extracted service items**: own entity vs. structured fields on `Log`. Lean is structured data on the log (keeps the log = "thing that happened" model intact) with the schedule matcher reading it from there.
  - decision: both structured fields on Log ("thing that happened"), and another entity (or sub-field under vehicle?) that keeps the current state of things (ex: current set of tires "Michelin Anakee Adventure front and rear" were last replaced at this date/that mileage)
