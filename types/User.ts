export type User = {
  id: string; // short UUID assigned on create -- NOT the auth provider's user id (that's providerId)
  createdAt: number;
  updatedAt?: number;
  deletedAt?: number;
  providerId: string; // auth provider's (Clerk's) user id
  authProvider?: string;
  sessionId?: string;
  // fields snapshotted from the auth provider
  email?: string;
  name?: string;
  imageUrl?: string;
  authData?: any;
};

export const UserOptions = {
  lookups: {
    provider: "providerId",
  },
};

// the currently-authenticated actor as returned by services/users.ts's currentUser() --
// `id` is the internal (short UUID) user id resolved from the auth provider's id, and
// publicMetadata comes from Clerk (or the mock/impersonated stand-in from lib/mock-auth.ts).
export type SessionUser = {
  id: string;
  providerId?: string;
  publicMetadata?: any;
  privateMetadata?: any;
  [key: string]: any;
};
