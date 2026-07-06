import { listToMap } from "@desmat/utils";
import {
  useQuery,
  useMutation,
  useQueryClient,
} from '@tanstack/react-query';
import { useAuth } from "./use-user";

const localStorageKey = "moto:data:vehicles";
const queryKey = ["vehicles"];

export function useVehicle(id?: string): any {
  const { getToken, userId } = useAuth();
  const queryClient = useQueryClient();

  const fetchData = async () => {
    const token = await getToken();
    const res = await fetch(id ? `/api/vehicles/${id}` : "/api/vehicles", {
      headers: { Authorization: `Bearer ${token}` },
      method: "GET",
    });

    console.log("hooks.use-vehicle useQuery.queryFn", { res });
    if (!res.ok) {
      console.error("Query error", { res });
      throw `${res.statusText} (${res.status})`;
    }

    if (id) {
      const { vehicle } = await res.json();
      return listToMap([vehicle]);
    }

    const { vehicles } = await res.json();
    const data = listToMap(vehicles);

    queryClient.setQueryData(queryKey, data);
    localStorage.setItem(`${localStorageKey}:${userId}`, JSON.stringify(data));

    return data;
  };

  const query = useQuery({
    queryKey: id ? [...queryKey, id] : queryKey,
    queryFn: async () => {
      if (!id) {
        const cachedData = localStorage.getItem(`${localStorageKey}:${userId}`);
        if (cachedData) {
          fetchData();
          return JSON.parse(cachedData);
        }
      }

      return fetchData();
    }
  });

  const addMutation = useMutation({
    mutationFn: async (vehicle: any) => {
      const token = await getToken();
      const res = await fetch("/api/vehicles", {
        headers: { Authorization: `Bearer ${token}` },
        body: JSON.stringify({ vehicle }),
        method: "POST",
      });

      console.log("hooks.use-vehicle addMutation.mutationFn", { res });
      if (!res.ok) {
        console.error("Query error", { res });
        throw `${res.statusText} (${res.status})`;
      }

      const { vehicle: newVehicle } = await res.json();
      return newVehicle;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey })
    },
  });

  const saveMutation = useMutation({
    mutationFn: async (vehicle: any) => {
      const token = await getToken();
      const res = await fetch(`/api/vehicles/${vehicle.id}`, {
        headers: { Authorization: `Bearer ${token}` },
        body: JSON.stringify({ vehicle }),
        method: "PUT",
      });

      console.log("hooks.use-vehicle saveMutation.mutationFn", { res });
      if (!res.ok) {
        console.error("Query error", { res });
        throw `${res.statusText} (${res.status})`;
      }

      const { vehicle: updatedVehicle } = await res.json();
      return updatedVehicle;
    },
    onSuccess: (data: any) => {
      queryClient.invalidateQueries({ queryKey });
      data?.id && queryClient.invalidateQueries({ queryKey: [...queryKey, data.id] });
    },
  });

  const deleteMutation = useMutation({
    mutationFn: async (id: string) => {
      // optimistic update
      await queryClient.cancelQueries({ queryKey });
      const data = queryClient.getQueryData(queryKey) as any;
      if (data) {
        delete data[id];
        queryClient.setQueryData(queryKey, data);
        localStorage.setItem(`${localStorageKey}:${userId}`, JSON.stringify(data));
      }

      const token = await getToken();
      const res = await fetch(`/api/vehicles/${id}`, {
        headers: { Authorization: `Bearer ${token}` },
        method: "DELETE",
      });

      console.log("hooks.use-vehicle deleteMutation.mutationFn", { res });
      if (!res.ok) {
        console.error("Query error", { res });
        throw `${res.statusText} (${res.status})`;
      }

      const { vehicle: deletedVehicle } = await res.json();
      return deletedVehicle;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey })
    },
  });

  return {
    loaded: query.isFetched,
    error: query.error,
    vehicles: query.data,
    add: addMutation.mutateAsync,
    save: saveMutation.mutateAsync,
    delete: deleteMutation.mutate,
  };
}
