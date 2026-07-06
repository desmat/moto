import { createStore } from "./stores";
import { SessionUser } from "@/types/User";
import { Vehicle } from "@/types/Vehicle";

const store = createStore({
  debug: true,
});

export async function getVehicles(query?: any): Promise<any> {
  console.log("services.vehicles.getVehicles", { query });

  return store.vehicles.find(query);
}

export async function getVehicle(id: string): Promise<Vehicle | undefined> {
  console.log("services.vehicles.getVehicle", { id });

  return store.vehicles.get(id);
}

export async function saveVehicle(vehicle: any, by: SessionUser): Promise<Vehicle | undefined> {
  console.log("services.vehicles.saveVehicle", { vehicle, by });

  if (vehicle.id && await store.vehicles.exists(vehicle.id)) {
    return store.vehicles.update({ ...vehicle, updatedBy: by.id });
  } else {
    return store.vehicles.create({ ...vehicle, userId: vehicle.userId || by.id, createdBy: by.id });
  }
}

export async function deleteVehicle(id: string): Promise<Vehicle | undefined> {
  console.log("services.vehicles.deleteVehicle", { id });

  return store.vehicles.delete(id);
}
