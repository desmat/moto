# S2 — `Attachment` entity

Story: [phase-1.md](../phase-1.md) § S2. No dependencies; unblocks S3–S6. This is a by-the-book run of AGENTS.md's "Adding a new entity" six-touchpoint pattern, copying `Vehicle`/`Log` almost verbatim, plus one twist: deleting an attachment also deletes its blob.

## Design

- **Record shape**: blob metadata + ownership + an optional `logId` (attachments upload *before* their log exists — S4 links them on save; Phase 2 documents will point at attachments without any `logId`).
- **`pathname` lookup** for idempotency: the client creates the record right after a successful blob upload (S3 has no reliable server-side webhook on localhost); if that POST retries, `find({ pathname })` lets the route return the existing record instead of duplicating.
- **Blob deletion is best-effort**: `del()` wrapped in try/catch-log. Rationale: records created in tests/memory-store dev carry fake pathnames that don't exist in the real Blob store — deletion of the record must still succeed. An orphaned blob is a cost leak, not a correctness bug (and orphan cleanup is already a deferred Phase 1 task).

## Files

### Create `types/Attachment.ts`

```ts
export type Attachment = {
  id: string;
  createdAt: number;  createdBy?: string;
  updatedAt?: number; updatedBy?: string;
  deletedAt?: number;
  userId: string;
  logId?: string;        // set when the owning log is saved (S4); absent = pending/unlinked
  vehicleId?: string;    // denormalized from the log for future per-vehicle galleries
  url: string;           // blob public URL
  pathname: string;      // blob pathname, needed for deletion; always `moto/{userId}/...`
  contentType: string;
  size: number;
  filename: string;
};

export const AttachmentOptions = {
  lookups: { user: "userId", log: "logId", pathname: "pathname" },
  hardDelete: true,
  fieldDisplayOrder: ["id", "createdAt", "createdBy", "updatedAt", "updatedBy",
    "userId", "logId", "vehicleId", "url", "pathname", "contentType", "size", "filename"],
};
```

### Create `services/attachments.ts`

Copy `services/vehicles.ts` structure (module-scope `createStore({ debug: true })`, `console.log("services.attachments.<fn>", ...)` logging): `getAttachments(query)`, `getAttachment(id)`, `saveAttachment(attachment, by)` (exists → update, else create with `userId: by.id`), and:

```ts
export async function deleteAttachment(id: string) {
  // best-effort blob deletion: fake pathnames (tests, memory-store dev) or an already-
  // deleted blob must not block deleting the record
  try { attachment && await del(attachment.url); } catch (e) { console.warn(...); }
  return store.attachments.delete(id);
}
```

(`del` from `@vercel/blob` — server SDK, uses `BLOB_READ_WRITE_TOKEN` from env.)

### Modify — remaining touchpoints

- `services/stores/config.ts`: `attachments: { key: "MotoAttachment", options: AttachmentOptions }`.
- `services/stores/redis.ts`: `attachments: new RedisStore<Attachment>({ ...storeConfigs.attachments, debug })`.
- `services/stores/memory.ts`: `attachments: new MemoryStore<Attachment>({ ...storeConfigs.attachments, debug, seed: seed.attachments })` — seed one image attachment linked to an existing seeded log (e.g. `smoke-log-7`, "new tires") with a fake-but-well-formed `pathname: "moto/user_smoketest/…"` and a data-URL or `/…` local `url`, so S5's list-indicator e2e has something to render out of the box.
- `app/api/attachments/route.ts`: copy `app/api/vehicles/route.ts`. GET scopes by `user: user.id` and passes query through (`?log=<id>` works via the `log` lookup). POST additionally:
  - destructures `id` off the payload (the AGENTS.md `id: undefined` gotcha);
  - **validates `pathname` starts with `moto/${user.id}/`** — a client may only claim blobs uploaded under its own prefix (S3 enforces the same prefix at token time; this closes the record side);
  - idempotency: `find({ pathname })` first; if a record exists (necessarily same user, given the prefix check), return it instead of creating.
  - `trackEvent("attachment-created", ...)` per convention.
- `app/api/attachments/[id]/route.ts`: copy `app/api/vehicles/[id]/route.ts` — GET/PUT/DELETE with 403/404/ownership, PUT pins `id`/`userId`/`createdAt`/`createdBy` **and `url`/`pathname`/`size`/`contentType`** (PUT exists to set `logId`, not to repoint records at other blobs). DELETE calls `deleteAttachment` (blob included).
- `hooks/use-attachment.tsx`: modeled on `hooks/use-log.tsx` but leaner — parameterized `useAttachment({ logId })` query (key `["attachments", logId]`), `add`/`save`/`delete` mutations; skip the localStorage cache layer (attachments render lazily; stale-URL caching buys nothing).

### Create `test/api/attachments.spec.ts`

Mirror `ownership.spec.ts` style (single mock user, `request` fixture): create with a well-formed fake `pathname` under the test user's prefix → assert `id`/`userId` minted; GET/list with `?log=`; PUT sets `logId` and pins identity+blob fields even when the client tries to change them; POST with a `pathname` outside `moto/{userId}/` → 400; duplicate POST with same `pathname` → same record id back; DELETE → 200, then 404; missing ids → 404 throughout.

## Steps

1. `types/Attachment.ts` → 2. `config.ts` → 3. both store backends (memory seed included) → 4. `services/attachments.ts` → 5. API routes → 6. hook → 7. spec.
8. Verify: `npm run build`, `npm run test:api` (stop any running dev server first — the Next 16 one-dev-server-per-project lock in AGENTS.md).

## Out of scope

Actual file upload (S3), UI (S4/S5), orphan reaping, image resizing/thumbnails.
