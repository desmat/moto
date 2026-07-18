import { NextRequest, NextResponse } from 'next/server'
import { authorizationFailed, canAccess, notFound } from '@/lib/api';
import trackEvent from '@/lib/trackEventServer';
import { confirmSchedule, deleteSchedule, getSchedule, saveSchedule } from '@/services/schedules';
import { currentUser } from '@/services/users'

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const user = await currentUser();
  console.log('app.api.schedules.[id].GET', { id, user });

  if (!user) {
    return authorizationFailed();
  }

  const schedule = await getSchedule(id);

  if (!schedule) {
    return notFound();
  }

  if (!canAccess(user, schedule)) {
    return authorizationFailed();
  }

  return NextResponse.json({ schedule });
}

export async function PUT(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const user = await currentUser();
  console.log('app.api.schedules.[id].PUT', { id, user });

  if (!user) {
    return authorizationFailed();
  }

  const existing = await getSchedule(id);

  if (!existing) {
    return notFound();
  }

  if (!canAccess(user, existing)) {
    return authorizationFailed();
  }

  const { schedule } = await request.json();

  // id/owner/creation fields are pinned to the existing record, and so are the
  // reference/provenance fields (vehicleId/documentId/source) -- edits touch items and
  // status only. And this route NEVER writes status "confirmed" itself: it only ever
  // keeps the stored status or demotes to "proposed" (a plain update -- it only reduces
  // the confirmed count); a body asking for "confirmed" gets its edits applied at the
  // stored status first, then delegates to confirmSchedule (the single sanctioned path,
  // which owns the one-confirmed-per-vehicle swap and is an idempotent no-op on an
  // already-confirmed record).
  let updated = await saveSchedule({
    ...schedule,
    id: existing.id,
    userId: existing.userId,
    createdAt: existing.createdAt,
    createdBy: existing.createdBy,
    vehicleId: existing.vehicleId,
    documentId: existing.documentId,
    source: existing.source,
    status: schedule?.status == "proposed" ? "proposed" : existing.status,
  }, user);

  if (schedule?.status == "confirmed") {
    updated = await confirmSchedule(id, user);
  }

  await trackEvent("schedule-updated", {
    userId: user.id,
    userIsAdmin: !!user.publicMetadata?.isAdmin,
    id: updated?.id,
    status: updated?.status,
  });

  return NextResponse.json({ schedule: updated });
}

export async function DELETE(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const user = await currentUser();
  console.log('app.api.schedules.[id].DELETE', { id, user });

  if (!user) {
    return authorizationFailed();
  }

  const existing = await getSchedule(id);

  if (!existing) {
    return notFound();
  }

  if (!canAccess(user, existing)) {
    return authorizationFailed();
  }

  const deleted = await deleteSchedule(id);

  await trackEvent("schedule-deleted", {
    userId: user.id,
    userIsAdmin: !!user.publicMetadata?.isAdmin,
    id: deleted?.id,
  });

  return NextResponse.json({ schedule: deleted });
}
