import { listToMap, mapToSearchParams } from "@desmat/utils";
import {
  useQuery,
  useMutation,
  useQueryClient,
} from '@tanstack/react-query';
import moment from "moment";
import { useAuth } from "./use-user";
import { fromLocalStorage, toLocalStorage } from "@/services/localstorage";

const localStorageKey = "moto:data:logs";
const queryKey = ["logs"];
export const defaultCount = 25;
const defaultOffset = undefined;

export function useLog({ id, count, offset }: { id?: string, count?: number, offset?: number } = { count: defaultCount, offset: defaultOffset }): any {
  const { getToken, userId } = useAuth();
  const queryClient = useQueryClient();

  const params = mapToSearchParams({
    ...typeof (count) === "number" && { count: count + 1 }, // pull an extra entry to determine hasMore
    ...typeof (offset) === "number" && { offset },
  });

  const fetchData = async () => {
    const token = await getToken();
    const res = await fetch(id
      ? `/api/logs/${id}`
      : `/api/logs${params ? `?${params}` : ""}`, {
      headers: { Authorization: `Bearer ${token}` },
      method: "GET",
    });

    console.log("hooks.use-log useQuery.queryFn", { res });
    if (!res.ok) {
      console.error("Query error", { res });
      throw `${res.statusText} (${res.status})`;
    }

    if (id) {
      const { log } = await res.json();
      return { records: listToMap([log]) };
    }

    const { logs } = await res.json();
    const records = listToMap(count ? logs.slice(offset || 0, count) : logs);

    return { records, hasMore: count && logs.length > count };
  };

  const query = useQuery({
    queryKey: [...queryKey, count, offset],
    queryFn: async () => {
      const data = await fetchData();
      toLocalStorage(`${localStorageKey}:${userId}`, data.records);
      return data;
    },
    placeholderData: (data: any) => {
      const cachedData = fromLocalStorage(`${localStorageKey}:${userId}`, count, offset);
      return cachedData ? { records: cachedData } : data;
    },
  });

  const addMutation = useMutation({
    // attachmentIds ride alongside the log in the POST body (the route links them to
    // the new log server-side), not on the log record itself
    mutationFn: async ({ attachmentIds, ...log }: any) => {
      // optimistic update
      await queryClient.cancelQueries({ queryKey: [...queryKey, count, offset] });
      const data = queryClient.getQueryData([...queryKey, count, offset]) as any;
      if (data) {
        data.records["NEW"] = { id: "NEW", ...log, createdAt: moment().valueOf() };
        queryClient.setQueryData([...queryKey, count, offset], data);
      }

      const token = await getToken();
      const res = await fetch("/api/logs", {
        headers: { Authorization: `Bearer ${token}` },
        body: JSON.stringify({ log, attachmentIds }),
        method: "POST",
      });

      console.log("hooks.use-log addMutation.mutationFn", { res });
      if (!res.ok) {
        console.error("Query error", { res });
        throw `${res.statusText} (${res.status})`;
      }

      const { log: newLog } = await res.json();
      return newLog;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey });
      // a mileage log also updates the vehicle record's mileage server-side
      queryClient.invalidateQueries({ queryKey: ["vehicles"] });
      // and linked attachments gain a logId server-side
      queryClient.invalidateQueries({ queryKey: ["attachments"] });
    },
  });

  const saveMutation = useMutation({
    mutationFn: async (log: any) => {
      const token = await getToken();
      const res = await fetch(`/api/logs/${log.id}`, {
        headers: { Authorization: `Bearer ${token}` },
        body: JSON.stringify({ log }),
        method: "PUT",
      });

      console.log("hooks.use-log saveMutation.mutationFn", { res });
      if (!res.ok) {
        console.error("Query error", { res });
        throw `${res.statusText} (${res.status})`;
      }

      const { log: updatedLog } = await res.json();
      return updatedLog;
    },
    onSuccess: (data: any) => {
      queryClient.invalidateQueries({ queryKey });
      queryClient.invalidateQueries({ queryKey: ["vehicles"] });
    },
  });

  const deleteMutation = useMutation({
    mutationFn: async (id: string) => {
      // optimistic update
      await queryClient.cancelQueries({ queryKey: [...queryKey, count, offset] });
      const data = queryClient.getQueryData([...queryKey, count, offset]) as any;
      if (data) {
        delete data.records[id];
        queryClient.setQueryData([...queryKey, count, offset], data);
        toLocalStorage(`${localStorageKey}:${userId}`, { [id]: undefined });
      }

      const token = await getToken();
      const res = await fetch(`/api/logs/${id}`, {
        headers: { Authorization: `Bearer ${token}` },
        method: "DELETE",
      });

      console.log("hooks.use-log deleteMutation.mutationFn", { res });
      if (!res.ok) {
        console.error("Query error", { res });
        throw `${res.statusText} (${res.status})`;
      }

      const { log: deletedLog } = await res.json();
      return deletedLog;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey });
    },
  });

  return {
    loaded: query.isFetched || query.isPlaceholderData,
    error: query.error,
    logs: query.data?.records,
    hasMore: query.data?.hasMore,
    add: addMutation.mutateAsync,
    save: saveMutation.mutateAsync,
    delete: deleteMutation.mutate,
  };
}
