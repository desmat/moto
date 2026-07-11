import { NextRequest, NextResponse } from 'next/server'
import { authorizationFailed, canAccess, notFound } from '@/lib/api';
import trackEvent from '@/lib/trackEventServer';
import { currentUser } from '@/services/users'
import { deleteVehicle, getVehicle, saveVehicle } from '@/services/vehicles';

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const user = await currentUser();
  console.log('app.api.vehicles.[id].GET', { id, user });

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

  return NextResponse.json({ vehicle });
}

export async function PUT(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const user = await currentUser();
  console.log('app.api.vehicles.[id].PUT', { id, user });

  if (!user) {
    return authorizationFailed();
  }

  const existing = await getVehicle(id);

  if (!existing) {
    return notFound();
  }

  if (!canAccess(user, existing)) {
    return authorizationFailed();
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
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const user = await currentUser();
  console.log('app.api.vehicles.[id].DELETE', { id, user });

  if (!user) {
    return authorizationFailed();
  }

  const existing = await getVehicle(id);

  if (!existing) {
    return notFound();
  }

  if (!canAccess(user, existing)) {
    return authorizationFailed();
  }

  const deleted = await deleteVehicle(id);

  await trackEvent("vehicle-deleted", {
    userId: user.id,
    userIsAdmin: !!user.publicMetadata?.isAdmin,
    id: deleted?.id,
  });

  return NextResponse.json({ vehicle: deleted });
}
