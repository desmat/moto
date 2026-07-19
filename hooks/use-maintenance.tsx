import { useQuery } from '@tanstack/react-query';
import { useAuth } from "./use-user";
import { VehicleMaintenance } from "@/types/Maintenance";

const queryKey = ["maintenance"];

// S16: maintenance status for ALL the user's vehicles in one fetch (GET
// /api/maintenance, S14). Leaner than use-log.tsx on purpose — no localStorage cache
// layer (modeled on use-attachment): statuses are cheap to recompute server-side and
// staleness is exactly what this feature fights. Freshness comes from invalidation:
// use-log.tsx's mutations invalidate ["maintenance"] so "log it → item clears" works
// without a reload.
export function useMaintenance(): { loaded: boolean, error: any, vehicles: VehicleMaintenance[] } {
  const { getToken } = useAuth();

  const query = useQuery({
    queryKey,
    queryFn: async () => {
      const token = await getToken();
      const res = await fetch("/api/maintenance", {
        headers: { Authorization: `Bearer ${token}` },
        method: "GET",
      });

      console.log("hooks.use-maintenance useQuery.queryFn", { res });
      if (!res.ok) {
        console.error("Query error", { res });
        throw `${res.statusText} (${res.status})`;
      }

      const { vehicles } = await res.json();
      return vehicles as VehicleMaintenance[];
    },
  });

  return {
    loaded: query.isFetched,
    error: query.error,
    vehicles: query.data || [],
  };
}
