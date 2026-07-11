import { NextRequest, NextResponse } from 'next/server'
import { authorizationFailed, canAccess, notFound } from '@/lib/api';
import trackEvent from '@/lib/trackEventServer';
import { deleteLog, getLog, saveLog } from '@/services/logs';
import { currentUser } from '@/services/users'

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const user = await currentUser();
  console.log('app.api.logs.[id].GET', { id, user });

  if (!user) {
    return authorizationFailed();
  }

  const log = await getLog(id);

  if (!log) {
    return notFound();
  }

  if (!canAccess(user, log)) {
    return authorizationFailed();
  }

  return NextResponse.json({ log });
}

export async function PUT(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const user = await currentUser();
  console.log('app.api.logs.[id].PUT', { id, user });

  if (!user) {
    return authorizationFailed();
  }

  const existing = await getLog(id);

  if (!existing) {
    return notFound();
  }

  if (!canAccess(user, existing)) {
    return authorizationFailed();
  }

  const { log } = await request.json();

  // id/owner/creation fields are pinned to the existing record, everything else is editable
  const updated = await saveLog({
    ...log,
    id: existing.id,
    userId: existing.userId,
    vehicleId: log?.vehicleId || existing.vehicleId,
    createdAt: existing.createdAt,
    createdBy: existing.createdBy,
  }, user);

  await trackEvent("log-updated", {
    userId: user.id,
    userIsAdmin: !!user.publicMetadata?.isAdmin,
    id: updated?.id,
    type: updated?.type,
  });

  return NextResponse.json({ log: updated });
}

export async function DELETE(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const user = await currentUser();
  console.log('app.api.logs.[id].DELETE', { id, user });

  if (!user) {
    return authorizationFailed();
  }

  const existing = await getLog(id);

  if (!existing) {
    return notFound();
  }

  if (!canAccess(user, existing)) {
    return authorizationFailed();
  }

  const deleted = await deleteLog(id);

  await trackEvent("log-deleted", {
    userId: user.id,
    userIsAdmin: !!user.publicMetadata?.isAdmin,
    id: deleted?.id,
    type: deleted?.type,
  });

  return NextResponse.json({ log: deleted });
}
