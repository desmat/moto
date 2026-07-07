# S1 — OpenAI service layer (`services/ai.ts`)

Story: [phase-1.md](../phase-1.md) § S1. No dependencies; unblocks S6 (odometer OCR) and everything AI in Phases 2–3.

## Design

- **One module, lazy client.** `services/ai.ts` holds a module-scope config const and a lazily-constructed OpenAI client (`getClient()` memoized) — *not* constructed at import time, so importing the module without `OPENAI_API_KEY` set (e.g. `npm run admin`, builds) doesn't throw; only actually calling it does, with a clear `"OPENAI_API_KEY is not set"` error.
- **Model names in one place**: `const MODELS = { vision: "<current vision-capable model>" }` — chosen at implementation time from OpenAI's current lineup; nothing else in the codebase ever names a model.
- **Phase 1 surface is one function.** Don't speculatively build chat/embeddings (Phase 2 adds them here).
- **Mock mode** (`AI_MOCK=true`): short-circuit before any network call and return a canned response looked up by `schemaName`. Canned responses live in a `MOCKS: Record<string, any>` const at the bottom of the module — S6 adds `odometer: { reading: 12345, unit: "km", confidence: "high" }`.
- **Server-only.** Imported only from API routes / services (Node runtime). Not from `proxy.ts` (Edge), never from client code. `OPENAI_API_KEY` must **not** be added to `next.config.mjs`'s `env` whitelist — that block exposes vars to the browser, which is exactly wrong for a secret.

## Files

### Create `services/ai.ts`

```ts
import OpenAI from "openai";

const MODELS = { vision: "..." };  // single source of truth for model names

let client: OpenAI | undefined;
function getClient(): OpenAI { /* throw clear error if !process.env.OPENAI_API_KEY; memoize */ }

const mock = () => process.env.AI_MOCK == "true";

export async function extractFromImage<T>({ imageUrl, prompt, schemaName, schema }: {
  imageUrl: string,      // blob URL (public-but-unguessable) — passed straight to OpenAI, no server-side re-download
  prompt: string,
  schemaName: string,    // doubles as json_schema name and MOCKS key
  schema: object,        // plain JSON Schema — deliberately not zod (not a dependency; one schema doesn't justify it)
}): Promise<T>
```

Implementation: follow the existing service conventions — `console.log("services.ai.extractFromImage", { schemaName, imageUrl })` on entry (log the URL, never the API key). If `mock()`, return `MOCKS[schemaName]` (throw if no mock registered — a test hitting an unmocked schema is a bug). Otherwise `getClient().chat.completions.create()` with the image as an `image_url` content part and `response_format: { type: "json_schema", json_schema: { name: schemaName, strict: true, schema } }`; `JSON.parse` the message content and return it. Let OpenAI SDK errors propagate (routes turn them into 5xx JSON) but wrap with context: `throw new Error(\`services.ai.extractFromImage(${schemaName}): ${err.message}\`)`.

### Modify

- `playwright.config.ts` — add `AI_MOCK: 'true'` to `webServer.env`, alongside `STORE_TYPE: 'memory'` (same comment style: tests must be deterministic and free).
- `AGENTS.md` — "Required environment variables": add `OPENAI_API_KEY`; in the optional/test paragraph, add `AI_MOCK=true` next to the `STORE_TYPE=memory` explanation. Also extend the env-var-exposure footgun paragraph's spirit: note this one is a secret and intentionally *not* whitelisted.
- `.env.local` (user action, not committed): add `OPENAI_API_KEY`.

## Steps

1. Write `services/ai.ts` per above (config, lazy client, `extractFromImage`, `MOCKS` with a placeholder entry).
2. Wire `AI_MOCK` into `playwright.config.ts`.
3. Update AGENTS.md env docs.
4. Verify: `npm run build` (type-checks); a throwaway `tsx` snippet (or the S6 route once it exists) exercising `extractFromImage` against a real image with a trivial schema, once with a real key, once with `AI_MOCK=true`.

## Acceptance criteria → verification

| AC | How verified |
|---|---|
| Key documented; absent key fails loudly at call time | AGENTS.md diff; call without key → thrown error names the var |
| Typed JSON per schema; API errors surface as throwable | tsx snippet + (later) S6's route test |
| `AI_MOCK=true` → canned, zero network | run snippet offline / with bogus key |
| No client exposure of the key | grep: no `OPENAI_API_KEY` in `next.config.mjs` or any `'use client'` file |

## Out of scope

Chat/embeddings functions (Phase 2 S7/S18), retries/rate-limit backoff (add when a real failure mode shows up), token/cost logging.
