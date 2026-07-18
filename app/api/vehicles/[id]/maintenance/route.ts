import { NextRequest, NextResponse } from 'next/server'
import { authorizationFailed, canAccess, notFound } from '@/lib/api';
import { getVehicleMaintenance } from '@/services/maintenance';
import { currentUser } from '@/services/users'
import { getVehicle } from '@/services/vehicles';

// S14: per-item maintenance status for one vehicle. Read-only and computed — a vehicle
// with no confirmed schedule still 200s with the distinct scheduleId-less shape (not an
// error), so UIs can funnel to manual upload.
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const user = await currentUser();
  console.log('app.api.vehicles.[id].maintenance.GET', { id, user });

  if (!user) {
    return authorizationFailed();
  }

  const vehicle = await getVehicle(id);

  if (!vehicle) {
    return notFound();
  }

  if (!canAccess(user, vehicle)) {
    return authorizationFailed();
  }

  // pass the OWNER's id (not the caller's) so admin access keeps working — canAccess
  // above already settled authorization
  const maintenance = await getVehicleMaintenance(vehicle.id, vehicle.userId);

  return NextResponse.json({ maintenance });
}
