// Bypasses Clerk in dev/tests. NODE_ENV !== "production" is enforced in addition to the
// feature flags below so a leaked env var can never disable auth in a real deployment.

export const mockUser = {
  id: process.env.IMPERSONATE_USER_ID || "mock-user",
  sessionId: "mock-session",
  authProvider: "mock",
  publicMetadata: {
    isAdmin: process.env.IMPERSONATE_USER_IS_ADMIMN === "true",
  },
};

// NEXT_PUBLIC_* vars are plain env vars on the server and are also inlined into the
// client bundle at build time, so a single flag works for both sides.
function isMockAuthEnabledCommon() {
  return process.env.NODE_ENV !== "production" && process.env.NEXT_PUBLIC_MOCK_AUTH === "true";
}

// gates middleware.ts and server-side services (e.g. services/users.ts currentUser())
export const isMockAuthEnabled = isMockAuthEnabledCommon;

// gates app/layout.tsx and client hooks (e.g. hooks/use-user.tsx)
export const isMockAuthEnabledClient = isMockAuthEnabledCommon;
