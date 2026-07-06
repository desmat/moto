export type Vehicle = {
  id: string;
  createdAt: number;
  createdBy?: string;
  updatedAt?: number;
  updatedBy?: string;
  deletedAt?: number;
  userId: string;
  type: string; // e.g. "motorcycle", "scooter", "atv"
  maker: string;
  model: string;
  year: number;
  mileage?: number;
  modifications?: string[];
};

export const VehicleOptions = {
  lookups: {
    user: "userId",
  },
  hardDelete: true,
  fieldDisplayOrder: ["id", "createdAt", "createdBy", "updatedAt", "updatedBy", "userId", "type", "maker", "model", "year", "mileage"],
};

export const DefaultVehicleType = "motorcycle";

export const VehicleTypes = ["motorcycle", "scooter", "atv", "snowmobile", "other"];

export function vehicleName(vehicle?: Partial<Vehicle>) {
  if (!vehicle) return "";
  return [vehicle.year, vehicle.maker, vehicle.model].filter(Boolean).join(" ");
}
