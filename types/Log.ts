export type Log = {
  id: string;
  createdAt: number;
  createdBy?: string;
  updatedAt?: number;
  updatedBy?: string;
  deletedAt?: number;
  userId: string;
  vehicleId: string;
  type: string; // "journal", "mileage", or a user-entered custom type
  date: string; // YYYYMMDD
  entry: string;
};

export const LogOptions = {
  lookups: {
    user: "userId",
    vehicle: "vehicleId",
    date: "date",
    type: "type",
  },
  hardDelete: true,
  fieldDisplayOrder: ["id", "createdAt", "createdBy", "updatedAt", "updatedBy", "userId", "vehicleId", "type", "date", "entry"],
};

// built-in log types; anything else is a user-entered custom type
export const LogTypeJournal = "journal";
export const LogTypeMileage = "mileage";
