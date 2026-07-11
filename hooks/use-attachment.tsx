import { listToMap } from "@desmat/utils";
import {
  useQuery,
  useMutation,
  useQueryClient,
} from '@tanstack/react-query';
import { useAuth } from "./use-user";

const queryKey = ["attachments"];

// Leaner than use-log.tsx on purpose: attachments render lazily so there's no
// localStorage cache layer (stale-URL caching buys nothing).
export function useAttachment({ logId }: { logId?: string } = {}): any {
  const { getToken } = useAuth();
  const queryClient = useQueryClient();

  const fetchData = async () => {
    const token = await getToken();
    const res = await fetch(logId ? `/api/attachments?log=${logId}` : "/api/attachments", {
      headers: { Authorization: `Bearer ${token}` },
      method: "GET",
    });

    console.log("hooks.use-attachment useQuery.queryFn", { res });
    if (!res.ok) {
      console.error("Query error", { res });
      throw `${res.statusText} (${res.status})`;
    }

    const { attachments } = await res.json();
    return listToMap(attachments);
  };

  const query = useQuery({
    queryKey: [...queryKey, logId],
    queryFn: fetchData,
  });

  const addMutation = useMutation({
    mutationFn: async (attachment: any) => {
      const token = await getToken();
      const res = await fetch("/api/attachments", {
        headers: { Authorization: `Bearer ${token}` },
        body: JSON.stringify({ attachment }),
        method: "POST",
      });

      console.log("hooks.use-attachment addMutation.mutationFn", { res });
      if (!res.ok) {
        console.error("Query error", { res });
        throw `${res.statusText} (${res.status})`;
      }

      const { attachment: newAttachment } = await res.json();
      return newAttachment;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey });
    },
  });

  const saveMutation = useMutation({
    mutationFn: async (attachment: any) => {
      const token = await getToken();
      const res = await fetch(`/api/attachments/${attachment.id}`, {
        headers: { Authorization: `Bearer ${token}` },
        body: JSON.stringify({ attachment }),
        method: "PUT",
      });

      console.log("hooks.use-attachment saveMutation.mutationFn", { res });
      if (!res.ok) {
        console.error("Query error", { res });
        throw `${res.statusText} (${res.status})`;
      }

      const { attachment: updatedAttachment } = await res.json();
      return updatedAttachment;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey });
    },
  });

  const deleteMutation = useMutation({
    mutationFn: async (id: string) => {
      const token = await getToken();
      const res = await fetch(`/api/attachments/${id}`, {
        headers: { Authorization: `Bearer ${token}` },
        method: "DELETE",
      });

      console.log("hooks.use-attachment deleteMutation.mutationFn", { res });
      if (!res.ok) {
        console.error("Query error", { res });
        throw `${res.statusText} (${res.status})`;
      }

      const { attachment: deletedAttachment } = await res.json();
      return deletedAttachment;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey });
    },
  });

  return {
    loaded: query.isFetched,
    error: query.error,
    attachments: query.data,
    add: addMutation.mutateAsync,
    save: saveMutation.mutateAsync,
    delete: deleteMutation.mutate,
  };
}
