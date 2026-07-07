# Optional — Clerk → Firebase Auth (anonymous try-it + upgrade-in-place)

**Standalone, optional plan** — not part of any roadmap phase. Motivation: Firebase Auth's anonymous accounts give a true zero-friction entry ("try it, no signup"), with `linkWithCredential`/`linkWithPopup` upgrading an anonymous account to a permanent one **in place** — same uid — so a user's data follows them into signup with zero data movement in the happy path.

**Timing**: if this is done at all, do it early. The collision-merge fallback (below) has to re-key `userId` across every entity that exists at migration time — three stores today (vehicles, logs, users), plus attachments after Phase 1, plus documents/schedules *and Upstash Vector metadata* after Phase 2. Each shipped phase makes the merge path more expensive.

**Why this repo is well-positioned**: the internal `User.id` is already a short UUID decoupled from the auth provider's id (`providerId` + lookup, per AGENTS.md) — swapping providers means changing what lands in `providerId`, not re-keying any domain data. `resolveUser()` and the entire entity layer are untouched.

## Design decisions

1. **Session transport: Firebase ID token in an httpOnly cookie, verified with `jose` on the Edge.** The proxy gates page routes with redirects, so auth must ride a cookie, and `proxy.ts` runs in the Edge runtime, so `firebase-admin` (Node-only) can't verify there. Instead: client signs in with the Firebase **client** SDK → POSTs its ID token to `POST /api/auth/session`, which verifies it and sets it as an httpOnly `Secure` `SameSite=Lax` cookie; `proxy.ts` verifies the cookie JWT via `jose`'s `createRemoteJWKSet` against Google's securetoken JWKS (`https://www.googleapis.com/service_accounts/v1/jwk/securetoken@system.gserviceaccount.com`), checking `iss`/`aud` against the Firebase project id. **No `firebase-admin`, no service account, no auth secret at all** — verification uses public keys.
2. **Token freshness is the client's job.** Firebase ID tokens live ~1h; the client SDK auto-refreshes. An `onIdTokenChanged` listener re-POSTs `/api/auth/session` on every refresh. Returning visitor with an expired cookie: page routes redirect to `/` (as today); the signed-out page detects a resumable Firebase session (SDK persists the refresh token in IndexedDB), silently re-mints + re-POSTs, and sends them back in — render this as a brief "restoring session…" state, not a login wall. API calls racing an expired cookie get the standard 403 and react-query retries after refresh.
3. **Anonymous entry is a deliberate tap, not automatic.** The signed-out landing page gains "**Try it — no account needed**" → `signInAnonymously()` → session POST → straight into the normal signed-in flow (which already forces the add-a-vehicle dialog, and pairs naturally with Phase 2's S13 interview). Not auto-on-visit: every crawler hitting `/` would mint a Firebase user and a `MotoUser` record. `resolveUser` stores `authProvider: "firebase"`; `SessionUser` gains `isAnonymous: boolean` (from the token's `firebase.sign_in_provider == "anonymous"`) so the UI can nudge.
4. **Upgrade = account linking; uid is preserved; data follows for free.** For anonymous users, a persistent-but-quiet nudge (sidebar footer where `UserButton` sits, plus the `/user` page): "Save your garage — create a free account" → `linkWithPopup(GoogleAuthProvider)` (and/or `linkWithCredential` for email+password). The uid — and therefore `providerId`, and therefore the internal `User.id` and every record hanging off it — is unchanged. `resolveUser`'s existing changed-field detection snapshots the new `email`/`name`/`imageUrl` on the next request. Zero server-side migration.
5. **The collision fallback is a server-side merge.** Linking throws `auth/credential-already-in-use` / `auth/email-already-in-use` when the chosen Google account/email already has a Firebase user (returning user who forgot they had an account, now with anonymous data). Flow: client captures the anonymous user's ID token *before* signing into the existing account, then calls `POST /api/auth/merge` with `{ anonIdToken }` while authenticated as the target account. Server verifies both tokens (same jose path), resolves both internal users, re-keys `userId: anon → target` across every entity store (vehicles, logs, + whatever phases have shipped: attachments, documents, schedules — and re-upserts the anon user's vector chunks with the new `userId` metadata once Phase 2 exists), deletes the anonymous `MotoUser` record, and returns. Client then deletes the anonymous Firebase account (`user.delete()` — client-side, no admin SDK) and proceeds signed-in. Belt-and-braces: enable Firebase's built-in auto-cleanup of stale anonymous accounts (console setting) for abandoned tokens. Blob pathnames (`moto/{oldUserId}/…`) are **not** rewritten — the prefix only gates claiming at upload time; merged attachment records keep working (URL + stored pathname), just under a stale prefix. Document this in the merge route.
6. **`isAdmin` moves off the provider.** Clerk's `publicMetadata.isAdmin` becomes an `isAdmin?: boolean` field on the internal `User` record, set via an `npm run admin` one-off (gated by `ADMIN_CONFIRM`, per convention). `currentUser()` synthesizes the existing `SessionUser.publicMetadata.isAdmin` shape from it so no consumer (`app-sidebar.tsx:125`, API-route admin checks) changes; a rename-cleanup is deferred. `IMPERSONATE_USER_IS_ADMIMN` behavior unchanged.
7. **Existing Clerk users are adopted by verified email.** `resolveUser` gains one fallback: no user found by `providerId` *and* the token's `email_verified` is true *and* a user record exists with that `email` and `authProvider: "clerk"` → update that record's `providerId`/`authProvider` in place instead of creating a new user. The `email_verified` guard is what prevents account takeover via an unverified signup with someone else's address. One-way, one-time per user; remove the fallback in a later cleanup once the Clerk cohort has migrated (check with an admin-script count).
8. **Mock auth and impersonation are untouched.** `lib/mock-auth.ts`'s bypass sits *above* the provider in every seam (proxy branch, `currentUser()`, `useAuth`/`useUser` module-load pick, layout provider skip) — the same structure absorbs Firebase. Playwright/`NEXT_PUBLIC_MOCK_AUTH` keep working with zero config change; no Firebase project is needed for tests or memory-store dev.

## Files

### Create

- `lib/firebase.ts` — client SDK init from `NEXT_PUBLIC_FIREBASE_API_KEY` / `NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN` / `NEXT_PUBLIC_FIREBASE_PROJECT_ID`. Note for AGENTS.md: these are **public client config by design** (Firebase API keys are not secrets) — the `NEXT_PUBLIC_` prefix is correct here and is *not* an instance of the env-exposure footgun; the footgun note should say so explicitly to preempt a well-meaning "fix".
- `lib/firebase-token.ts` — shared `verifyFirebaseToken(jwt)` (jose + remote JWKS + iss/aud checks), imported by both `proxy.ts` (Edge) and the session/merge routes (jose is runtime-agnostic; one implementation, no drift).
- `components/auth-provider.tsx` — context over `onAuthStateChanged`/`onIdTokenChanged`: `{ user, loaded, signInWithGoogle, signInAnonymously, linkWithGoogle, signOut }`, owning the session-cookie POST on every token change and the cookie-clearing sign-out. Replaces `ClerkProvider` in `app/layout.tsx`; a `<Show when>` equivalent is a trivial conditional on `loaded`/`user`.
- `app/api/auth/session/route.ts` — POST `{ idToken }` → verify → set cookie; DELETE → clear cookie. Must be reachable signed-out: add to `proxy.ts`'s public matcher alongside `/`.
- `app/api/auth/merge/route.ts` — per Design 5. The re-key loop lives in `services/users.ts` (`mergeUsers(fromId, toId)`) so admin scripts can reuse it; entity list kept in one place with a loud comment to extend it when new entities ship.
- `components/user-menu.tsx` — replaces Clerk's `<UserButton>` in `app-sidebar.tsx`/`app-bottom-bar.tsx`: avatar (`imageUrl` fallback initial), name/email, "Create account" nudge when `isAnonymous`, Sign out. (FirebaseUI is unmaintained; hand-rolled from existing primitives.)

### Modify

- `proxy.ts` — drop `clerkMiddleware`; the default export becomes `handleRequest` fed by cookie verification (mock branch unchanged). `resolveUser` call gains `email`/`name`/`imageUrl` straight from the verified token claims (Firebase puts them in the ID token — the proxy upsert now snapshots identity without a second provider call).
- `services/users.ts` — `currentUser()`: mock/impersonate branches unchanged; Clerk branch replaced by reading the same verified cookie (via `next/headers`); adoption fallback per Design 7; `isAdmin` synthesis per Design 6. `@clerk/nextjs` import gone.
- `hooks/use-user.tsx` — `useClerkAuth`/`useClerkUser` replaced by context-backed equivalents with the **same exported names and shapes** (`useAuth`, `useUser`, `useUserRecord` untouched in signature); `getToken()` returns the Firebase ID token.
- `app/layout.tsx`, `app/signed-out-page.tsx` (sign-in + try-it buttons), `components/app-sidebar.tsx`, `components/app-bottom-bar.tsx` — swap Clerk components per above.
- `types/User.ts` — comment updates (`providerId` = Firebase uid), `isAdmin?` on `User`, `isAnonymous?` on `SessionUser`.
- `services/admin.ts` — commented-out one-offs: set/unset `isAdmin`; count remaining `authProvider: "clerk"` records.
- `AGENTS.md` + `.env.local` — env-var section rewrite: remove `CLERK_SECRET_KEY`/`NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY`, add the three `NEXT_PUBLIC_FIREBASE_*` vars (with the "public by design" note). `package.json`: `npm i firebase jose`, `npm uninstall @clerk/nextjs`.

## Steps

1. Firebase project setup (console): enable Google + Email/Password + Anonymous providers; enable anonymous auto-cleanup; grab client config.
2. `lib/firebase.ts` + `lib/firebase-token.ts` + session route.
3. `proxy.ts` swap (keep the Clerk path until step 5 verifies — feature-branch this; there's no clean runtime toggle between providers, and half-migrated auth is worse than either).
4. `auth-provider.tsx` + layout + signed-out page + `use-user.tsx` internals + user menu.
5. `currentUser()` swap + adoption fallback + `isAdmin` migration script. Verify sign-in/out, page + API gating, `npm run test` (mock mode — should be untouched and green).
6. Anonymous entry button + `isAnonymous` nudges.
7. Linking flow, then the merge route + `mergeUsers`.
8. Cleanup: uninstall `@clerk/nextjs`, AGENTS.md, admin count script for the Clerk cohort.

## Verification

| Scenario | How |
|---|---|
| Google sign-in → gated pages/API work; sign-out → redirect + 403s | manual, real Firebase project |
| Existing Clerk user signs in with same Google email → sees their old vehicles/logs (adoption) | manual with a real pre-migration record; assert `providerId` rewritten, same internal id |
| Try-it → add vehicle + logs → link to fresh Google account → same data, `isAnonymous` gone | manual; assert internal user id unchanged before/after |
| Link collision → merge → anon-created records now on the existing account; anon `MotoUser` gone | manual two-account run; assert re-key across all entities |
| Unverified-email signup matching an existing record does **not** adopt it | manual (email/password signup without verification) |
| Mock-auth suite unaffected | `npm run test` — zero Playwright config changes |
| Expired-cookie return visit restores silently | devtools: delete/expire cookie, reload a gated page |

## Interactions with the phase plans

- **Phase 1 S0/S3**: if the prefix decision moved pathname-minting server-side, nothing changes here; if client-built, note that `useUserRecord()` (internal id) is unaffected by the provider swap. The merge route's stale-prefix note (Design 5) slightly weakens S2's "pathname prefix ⇒ same user" idempotency assumption — after a merge, a user can own records under a foreign prefix; the POST-claim check still holds for *new* uploads.
- **Phase 2 S7**: `mergeUsers` must re-key vector metadata (re-upsert chunks) — extend the entity list when S7 lands.
- **Phase 2 S13**: anonymous entry + onboarding interview is the natural demo pairing; no plan change, just sequencing appeal.

## Out of scope

`firebase-admin` / custom claims / server-minted session cookies (revisit if 1h-token freshness ever bites), Apple/other providers (Google + email/password + anonymous only for v1), multi-device anonymous continuity (anonymous accounts are per-device by nature — the nudge exists precisely to fix this), deleting Clerk-side user data (export/retire the Clerk app manually once the cohort count hits zero), Firebase Auth Emulator in CI (mock mode covers app logic; emulator is a later nicety for e2e-ing the real link/merge flows).
