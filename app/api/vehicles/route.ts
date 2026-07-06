import { searchParamsToMap } from '@desmat/utils';
import { NextRequest, NextResponse } from 'next/server'
import trackEvent from '@/lib/trackEventServer';
import { currentUser } from '@/services/users'
import { getVehicles, saveVehicle } from '@/services/vehicles';

export async function GET(request: NextRequest, params?: any) {
  const query = searchParamsToMap(request.nextUrl.searchParams.toString()) as any;
  const user = await currentUser();
  console.log('app.api.vehicles.GET', { query, user });

  if (!user) {
    return NextResponse.json(
      { success: false, message: 'authorization failed' },
      { status: 403 }
    );
  }

  const vehicles = await getVehicles({ ...query, user: user.id });

  return NextResponse.json({ vehicles });
}

export async function POST(request: NextRequest) {
  const user = await currentUser();
  console.log('app.api.vehicles.POST', { user });

  if (!user) {
    return NextResponse.json(
      { success: false, message: 'authorization failed' },
      { status: 403 }
    );
  }

  const { vehicle } = await request.json();
  console.log('app.api.vehicles.POST', { vehicle });

  // strip any client-supplied id (the store mints one on create) rather than setting it
  // to undefined -- an explicit `id: undefined` key would survive the store's spread and
  // clobber the generated id
  const { id: _clientId, ...vehicleData } = vehicle || {};

  const newVehicle = await saveVehicle({ ...vehicleData, userId: user.id }, user);

  await trackEvent("vehicle-created", {
    userId: user.id,
    userIsAdmin: !!user.publicMetadata?.isAdmin,
    id: newVehicle?.id,
  });

  return NextResponse.json({ vehicle: newVehicle });
}
