import { useQuery } from '@tanstack/react-query';
import { useAuth } from "./use-user";
import { VehicleMaintenance } from "@/types/Maintenance";

const queryKey = ["maintenance"];

// S16/S17: maintenance status for all vehicles, or one vehicle when vehicleId is
// supplied. Leaner than use-log.tsx on purpose — no localStorage cache
// layer (modeled on use-attachment): statuses are cheap to recompute server-side and
// staleness is exactly what this feature fights. Freshness comes from invalidation:
// use-log.tsx's mutations invalidate ["maintenance"] so "log it → item clears" works
// without a reload.
export function useMaintenance({ vehicleId }: { vehicleId?: string } = {}): { loaded: boolean, error: any, vehicles: VehicleMaintenance[] } {
  const { getToken } = useAuth();

  const query = useQuery({
    queryKey: [...queryKey, vehicleId],
    queryFn: async () => {
      const token = await getToken();
      const res = await fetch(vehicleId ? `/api/vehicles/${vehicleId}/maintenance` : "/api/maintenance", {
        headers: { Authorization: `Bearer ${token}` },
        method: "GET",
      });

      console.log("hooks.use-maintenance useQuery.queryFn", { res });
      if (!res.ok) {
        console.error("Query error", { res });
        throw `${res.statusText} (${res.status})`;
      }

      const data = await res.json();
      return (vehicleId ? [data.maintenance] : data.vehicles) as VehicleMaintenance[];
    },
  });

  return {
    loaded: query.isFetched,
    error: query.error,
    vehicles: query.data || [],
  };
}
