import { NextRequest, NextResponse } from 'next/server'
import { authorizationFailed } from '@/lib/api';
import { getVehicleMaintenance } from '@/services/maintenance';
import { currentUser } from '@/services/users'
import { getVehicles } from '@/services/vehicles';
import { Vehicle } from '@/types/Vehicle';

// S14: maintenance status for ALL of the caller's vehicles in one fetch (S16's
// dashboard card reads this). Vehicles without a confirmed schedule appear with the
// distinct scheduleId-less shape rather than being filtered out.
export async function GET(request: NextRequest) {
  const user = await currentUser();
  console.log('app.api.maintenance.GET', { user });

  if (!user) {
    return authorizationFailed();
  }

  const userVehicles: Vehicle[] = await getVehicles({ user: user.id }) || [];

  const vehicles = (await Promise.all(
    userVehicles.map((vehicle) => getVehicleMaintenance(vehicle.id, user.id))
  )).filter(Boolean);

  return NextResponse.json({ vehicles });
}
