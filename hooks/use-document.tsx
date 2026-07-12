import { listToMap } from "@desmat/utils";
import {
  useQuery,
  useMutation,
  useQueryClient,
} from '@tanstack/react-query';
import { useAuth } from "./use-user";

const queryKey = ["documents"];

// Modeled on use-attachment.tsx: no localStorage cache layer on purpose (documents
// render inside the vehicle page, lazily).
//
// S9 adds: an ingest mutation (kick off / retry processing for a document) and a
// refetchInterval that polls while any document is in "processing".
export function useDocument({ vehicleId }: { vehicleId?: string } = {}): any {
  const { getToken } = useAuth();
  const queryClient = useQueryClient();

  const fetchData = async () => {
    const token = await getToken();
    const res = await fetch(vehicleId ? `/api/documents?vehicle=${vehicleId}` : "/api/documents", {
      headers: { Authorization: `Bearer ${token}` },
      method: "GET",
    });

    console.log("hooks.use-document useQuery.queryFn", { res });
    if (!res.ok) {
      console.error("Query error", { res });
      throw `${res.statusText} (${res.status})`;
    }

    const { documents } = await res.json();
    return listToMap(documents);
  };

  const query = useQuery({
    queryKey: [...queryKey, vehicleId],
    queryFn: fetchData,
  });

  const addMutation = useMutation({
    mutationFn: async (document: any) => {
      const token = await getToken();
      const res = await fetch("/api/documents", {
        headers: { Authorization: `Bearer ${token}` },
        body: JSON.stringify({ document }),
        method: "POST",
      });

      console.log("hooks.use-document addMutation.mutationFn", { res });
      if (!res.ok) {
        console.error("Query error", { res });
        throw `${res.statusText} (${res.status})`;
      }

      const { document: newDocument } = await res.json();
      return newDocument;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey });
    },
  });

  const deleteMutation = useMutation({
    mutationFn: async (id: string) => {
      const token = await getToken();
      const res = await fetch(`/api/documents/${id}`, {
        headers: { Authorization: `Bearer ${token}` },
        method: "DELETE",
      });

      console.log("hooks.use-document deleteMutation.mutationFn", { res });
      if (!res.ok) {
        console.error("Query error", { res });
        throw `${res.statusText} (${res.status})`;
      }

      const { document: deletedDocument } = await res.json();
      return deletedDocument;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey });
      // the cascade also removed the document's attachment record
      queryClient.invalidateQueries({ queryKey: ["attachments"] });
    },
  });

  return {
    loaded: query.isFetched,
    error: query.error,
    documents: query.data,
    add: addMutation.mutateAsync,
    delete: deleteMutation.mutate,
  };
}
