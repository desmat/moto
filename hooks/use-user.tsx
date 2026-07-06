import { useAuth as clerkUseAuth, useUser as clerkUseUser } from "@clerk/nextjs";
import {
  useQuery,
  useMutation,
  useQueryClient,
} from '@tanstack/react-query';
import { isMockAuthEnabledClient, mockUser } from "@/lib/mock-auth";

function useMockAuth(): any {
  return {
    userId: mockUser.id,
    sessionId: mockUser.sessionId,
    isSignedIn: true,
    isLoaded: true,
    getToken: async () => "mock-token",
  };
}

function useClerkAuth(): any {
  const clerkAuth = clerkUseAuth();

  return {
    ...clerkAuth,
    userId: process.env.IMPERSONATE_USER_ID || clerkAuth?.userId,
  }
}

// picked once at module load (build-time constant) so Clerk's hooks are never
// called when mock mode is on, since ClerkProvider isn't mounted in that case
export const useAuth = isMockAuthEnabledClient() ? useMockAuth : useClerkAuth;

function useMockUser(): any {
  return {
    isSignedIn: true,
    isLoaded: true,
    user: mockUser,
  };
}

function useClerkUser(): any {
  const clerkUser = clerkUseUser();

  const userFromImpersonation = process.env.IMPERSONATE_USER_ID
    ? {
      id: process.env.IMPERSONATE_USER_ID,
      publicMetadata: {
        isAdmin: process.env.IMPERSONATE_USER_IS_ADMIMN || clerkUser?.user?.publicMetadata?.isAdmin,
      }
    }
    : undefined;

  return {
    ...clerkUser,
    user: {
      ...clerkUser.user,
      ...userFromImpersonation,
    },
  }
}

export const useUser = isMockAuthEnabledClient() ? useMockUser : useClerkUser;

const userRecordQueryKey = ["user-record"];

// the persisted User DB record (short-uuid id + auth-provider fields), as opposed to
// useUser() above which is the auth provider's live session user
export function useUserRecord(): any {
  const { getToken } = useAuth();
  const queryClient = useQueryClient();

  const query = useQuery({
    queryKey: userRecordQueryKey,
    queryFn: async () => {
      const token = await getToken();
      const res = await fetch("/api/user", {
        headers: { Authorization: `Bearer ${token}` },
        method: "GET",
      });

      if (!res.ok) {
        console.error("Query error", { res });
        throw `${res.statusText} (${res.status})`;
      }

      const { user } = await res.json();
      return user;
    },
  });

  const saveMutation = useMutation({
    mutationFn: async (user: any) => {
      const token = await getToken();
      const res = await fetch("/api/user", {
        headers: { Authorization: `Bearer ${token}` },
        body: JSON.stringify({ user }),
        method: "PUT",
      });

      if (!res.ok) {
        console.error("Query error", { res });
        throw `${res.statusText} (${res.status})`;
      }

      const { user: updatedUser } = await res.json();
      return updatedUser;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: userRecordQueryKey });
    },
  });

  return {
    loaded: query.isFetched,
    error: query.error,
    user: query.data,
    save: saveMutation.mutateAsync,
  };
}
