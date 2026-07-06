import { currentUser as clerkCurrentUser } from '@clerk/nextjs/server'
import { uuid } from "@desmat/utils";
import { isMockAuthEnabled, mockUser } from "@/lib/mock-auth";
import { SessionUser, User } from "@/types/User";
import { createStore } from "./stores";

const store = createStore({
  // debug: true,
});

export async function getUser(id: string): Promise<User | undefined> {
  console.log("services.users.getUser", { id });

  return store.users.get(id);
}

export async function findUserByProviderId(providerId: string): Promise<User | undefined> {
  console.log("services.users.findUserByProviderId", { providerId });

  const users = await store.users.find({ provider: providerId });

  return users && users[0];
}

// createdAt is optional here even though it's required on the persisted User record --
// the store assigns it on create() for new users
export async function saveUser(user: Omit<User, "createdAt"> & { createdAt?: number }): Promise<User | undefined> {
  console.log("services.users.saveUser", { user });

  if (await store.users.exists(user.id)) {
    return store.users.update(user);
  } else {
    return store.users.create(user);
  }
}

// Upserts the persisted User record for an auth-provider identity. Unlike other entities,
// the record id is a short UUID minted here -- NOT the provider's user id, which is stored
// on providerId and resolved via lookup. `id` can be forced for mock/test identities so
// seeded data keyed to a known id lines up.
export async function resolveUser({
  id,
  providerId,
  authProvider,
  sessionId,
  email,
  name,
  imageUrl,
  authData,
}: {
  id?: string,
  providerId: string,
  authProvider?: string,
  sessionId?: string,
  email?: string,
  name?: string,
  imageUrl?: string,
  authData?: any,
}): Promise<User | undefined> {
  const existing = await findUserByProviderId(providerId);

  if (existing) {
    // only write when something actually changed -- this runs on every request via middleware
    const changed = (sessionId && existing.sessionId != sessionId)
      || (email && existing.email != email)
      || (name && existing.name != name)
      || (imageUrl && existing.imageUrl != imageUrl);

    if (changed) {
      return store.users.update({
        ...existing,
        ...sessionId && { sessionId },
        ...email && { email },
        ...name && { name },
        ...imageUrl && { imageUrl },
        ...authData && { authData },
      });
    }

    return existing;
  }

  console.log("services.users.resolveUser creating user", { providerId });

  return store.users.create({
    id: id || uuid(),
    providerId,
    authProvider,
    sessionId,
    email,
    name,
    imageUrl,
    authData,
  });
}

export async function currentUser(): Promise<SessionUser | null> {
  // mock/impersonated identities are used directly as the internal user id (no provider
  // mapping), so seeded/test data keyed to those exact ids lines up
  if (isMockAuthEnabled()) {
    return { ...mockUser } as SessionUser;
  }

  const clerkUser = await clerkCurrentUser();

  if (process.env.IMPERSONATE_USER_ID) {
    return {
      id: process.env.IMPERSONATE_USER_ID,
      publicMetadata: {
        isAdmin: process.env.IMPERSONATE_USER_IS_ADMIMN
          ? process.env.IMPERSONATE_USER_IS_ADMIMN === "true"
          : clerkUser?.publicMetadata?.isAdmin,
      },
    };
  }

  if (!clerkUser?.id) return null;

  const dbUser = await resolveUser({
    providerId: clerkUser.id,
    authProvider: "clerk",
    email: clerkUser.primaryEmailAddress?.emailAddress || clerkUser.emailAddresses?.[0]?.emailAddress,
    name: clerkUser.fullName || [clerkUser.firstName, clerkUser.lastName].filter(Boolean).join(" ") || undefined,
    imageUrl: clerkUser.imageUrl,
  });

  if (!dbUser) return null;

  return {
    publicMetadata: clerkUser.publicMetadata,
    id: dbUser.id,
    providerId: clerkUser.id,
  };
}
