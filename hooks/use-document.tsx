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
// S9: the ingest mutation kicks off (or retries) processing for a document; the ingest
// POST is fire-and-forget from the client's perspective — the server runs the whole
// pipeline in-route (possibly minutes) and document status is the source of truth,
// polled via refetchInterval while any listed document is "processing".
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
    // poll while anything is processing so status badges update live; stop as soon as
    // every document has settled into uploaded/ready/error
    refetchInterval: (query) => {
      const documents = query.state.data;
      const anyProcessing = documents
        && Object.values(documents).some((document: any) => document?.status == "processing");
      return anyProcessing ? 2000 : false;
    },
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

  const ingestMutation = useMutation({
    mutationFn: async (id: string) => {
      const token = await getToken();
      const res = await fetch(`/api/documents/${id}/ingest`, {
        headers: { Authorization: `Bearer ${token}` },
        method: "POST",
      });

      console.log("hooks.use-document ingestMutation.mutationFn", { res });
      if (!res.ok) {
        console.error("Query error", { res });
        throw `${res.statusText} (${res.status})`;
      }

      const { document: ingestedDocument } = await res.json();
      return ingestedDocument;
    },
    // optimistically flip the row to "processing": the POST only resolves when the
    // whole in-route pipeline finishes, so without this nothing would refetch mid-flight
    // — and seeing "processing" in the cache is what starts the refetchInterval polling
    // loop above, which then keeps syncing server truth
    onMutate: (id: string) => {
      queryClient.setQueriesData({ queryKey }, (documents: any) =>
        documents?.[id]
          ? { ...documents, [id]: { ...documents[id], status: "processing" } }
          : documents);
    },
    // settled (not success): the POST resolving late/failing at a proxy is expected for
    // big manuals — either way, refetch and let document status tell the truth
    onSettled: () => {
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
    ingest: ingestMutation.mutate,
    delete: deleteMutation.mutate,
  };
}
