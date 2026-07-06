import { NextRequest, NextResponse } from 'next/server'
import trackEvent from '@/lib/trackEventServer';
import { currentUser } from '@/services/users'
import { deleteVehicle, getVehicle, saveVehicle } from '@/services/vehicles';

export async function GET(
  request: NextRequest,
  { params }: { params: { id: string } }
) {
  const user = await currentUser();
  console.log('app.api.vehicles.[id].GET', { params, user });

  if (!user) {
    return NextResponse.json(
      { success: false, message: 'authorization failed' },
      { status: 403 }
    );
  }

  const vehicle = await getVehicle(params.id);

  if (!vehicle) {
    return NextResponse.json(
      { success: false, message: 'not found' },
      { status: 404 }
    );
  }

  if (!(vehicle.userId == user.id || user.publicMetadata?.isAdmin)) {
    return NextResponse.json(
      { success: false, message: 'authorization failed' },
      { status: 403 }
    );
  }

  return NextResponse.json({ vehicle });
}

export async function PUT(
  request: NextRequest,
  { params }: { params: { id: string } }
) {
  const user = await currentUser();
  console.log('app.api.vehicles.[id].PUT', { params, user });

  if (!user) {
    return NextResponse.json(
      { success: false, message: 'authorization failed' },
      { status: 403 }
    );
  }

  const existing = await getVehicle(params.id);

  if (!existing) {
    return NextResponse.json(
      { success: false, message: 'not found' },
      { status: 404 }
    );
  }

  if (!(existing.userId == user.id || user.publicMetadata?.isAdmin)) {
    return NextResponse.json(
      { success: false, message: 'authorization failed' },
      { status: 403 }
    );
  }

  const { vehicle } = await request.json();

  // id/owner/creation fields are pinned to the existing record, everything else is editable
  const updated = await saveVehicle({
    ...vehicle,
    id: existing.id,
    userId: existing.userId,
    createdAt: existing.createdAt,
    createdBy: existing.createdBy,
  }, user);

  await trackEvent("vehicle-updated", {
    userId: user.id,
    userIsAdmin: !!user.publicMetadata?.isAdmin,
    id: updated?.id,
  });

  return NextResponse.json({ vehicle: updated });
}

export async function DELETE(
  request: Request,
  { params }: { params: { id: string } }
) {
  const user = await currentUser();
  console.log('app.api.vehicles.[id].DELETE', { params, user });

  if (!user) {
    return NextResponse.json(
      { success: false, message: 'authorization failed' },
      { status: 403 }
    );
  }

  const existing = await getVehicle(params.id);

  if (!existing) {
    return NextResponse.json(
      { success: false, message: 'not found' },
      { status: 404 }
    );
  }

  if (!(existing.userId == user.id || user.publicMetadata?.isAdmin)) {
    return NextResponse.json(
      { success: false, message: 'authorization failed' },
      { status: 403 }
    );
  }

  const deleted = await deleteVehicle(params.id);

  await trackEvent("vehicle-deleted", {
    userId: user.id,
    userIsAdmin: !!user.publicMetadata?.isAdmin,
    id: deleted?.id,
  });

  return NextResponse.json({ vehicle: deleted });
}
