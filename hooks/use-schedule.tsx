import { listToMap } from "@desmat/utils";
import {
  useQuery,
  useMutation,
  useQueryClient,
} from '@tanstack/react-query';
import { useAuth } from "./use-user";

const queryKey = ["schedules"];

// Modeled on use-document.tsx: no localStorage cache layer (schedules render inside the
// vehicle page, lazily), vehicle-scoped query. No polling — schedules have no status
// state machine; the extraction POST resolves with the proposed schedule directly.
export function useSchedule({ vehicleId }: { vehicleId?: string } = {}): any {
  const { getToken } = useAuth();
  const queryClient = useQueryClient();

  const fetchData = async () => {
    const token = await getToken();
    const res = await fetch(vehicleId ? `/api/schedules?vehicle=${vehicleId}` : "/api/schedules", {
      headers: { Authorization: `Bearer ${token}` },
      method: "GET",
    });

    console.log("hooks.use-schedule useQuery.queryFn", { res });
    if (!res.ok) {
      console.error("Query error", { res });
      throw `${res.statusText} (${res.status})`;
    }

    const { schedules } = await res.json();
    return listToMap(schedules);
  };

  const query = useQuery({
    queryKey: [...queryKey, vehicleId],
    queryFn: fetchData,
  });

  const addMutation = useMutation({
    mutationFn: async (schedule: any) => {
      const token = await getToken();
      const res = await fetch("/api/schedules", {
        headers: { Authorization: `Bearer ${token}` },
        body: JSON.stringify({ schedule }),
        method: "POST",
      });

      console.log("hooks.use-schedule addMutation.mutationFn", { res });
      if (!res.ok) {
        console.error("Query error", { res });
        throw `${res.statusText} (${res.status})`;
      }

      const { schedule: newSchedule } = await res.json();
      return newSchedule;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey });
    },
  });

  const saveMutation = useMutation({
    mutationFn: async (schedule: any) => {
      const token = await getToken();
      const res = await fetch(`/api/schedules/${schedule.id}`, {
        headers: { Authorization: `Bearer ${token}` },
        body: JSON.stringify({ schedule }),
        method: "PUT",
      });

      console.log("hooks.use-schedule saveMutation.mutationFn", { res });
      if (!res.ok) {
        console.error("Query error", { res });
        throw `${res.statusText} (${res.status})`;
      }

      const { schedule: updatedSchedule } = await res.json();
      return updatedSchedule;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey });
    },
  });

  // POST /api/documents/[id]/schedule: runs the whole extraction in-route and resolves
  // with the new proposed schedule; the confirmed-swap invalidation happens server-side
  const extractMutation = useMutation({
    mutationFn: async (documentId: string) => {
      const token = await getToken();
      const res = await fetch(`/api/documents/${documentId}/schedule`, {
        headers: { Authorization: `Bearer ${token}` },
        method: "POST",
      });

      console.log("hooks.use-schedule extractMutation.mutationFn", { res });
      if (!res.ok) {
        console.error("Query error", { res });
        throw `${res.statusText} (${res.status})`;
      }

      const { schedule: extractedSchedule } = await res.json();
      return extractedSchedule;
    },
    // settled (not success): even on failure a refetch is harmless, and the caller's
    // in-flight UI state should always end up consistent with server truth
    onSettled: () => {
      queryClient.invalidateQueries({ queryKey });
    },
  });

  const deleteMutation = useMutation({
    mutationFn: async (id: string) => {
      const token = await getToken();
      const res = await fetch(`/api/schedules/${id}`, {
        headers: { Authorization: `Bearer ${token}` },
        method: "DELETE",
      });

      console.log("hooks.use-schedule deleteMutation.mutationFn", { res });
      if (!res.ok) {
        console.error("Query error", { res });
        throw `${res.statusText} (${res.status})`;
      }

      const { schedule: deletedSchedule } = await res.json();
      return deletedSchedule;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey });
    },
  });

  return {
    loaded: query.isFetched,
    error: query.error,
    schedules: query.data,
    add: addMutation.mutateAsync,
    save: saveMutation.mutateAsync,
    // confirm rides the PUT: the route sees status "confirmed" and delegates to the
    // service's confirmSchedule (the only path to "confirmed")
    confirm: (schedule: any) => saveMutation.mutateAsync({ ...schedule, status: "confirmed" }),
    extract: extractMutation.mutateAsync,
    delete: deleteMutation.mutate,
  };
}
