import { searchParamsToMap } from '@desmat/utils';
import { NextRequest, NextResponse } from 'next/server'
import { authorizationFailed, badRequest } from '@/lib/api';
import trackEvent from '@/lib/trackEventServer';
import { getDocument } from '@/services/documents';
import { confirmSchedule, getSchedules, saveSchedule } from '@/services/schedules';
import { currentUser } from '@/services/users'
import { getVehicle } from '@/services/vehicles';

export async function GET(request: NextRequest, params?: any) {
  const query = searchParamsToMap(request.nextUrl.searchParams.toString()) as any;
  const user = await currentUser();
  console.log('app.api.schedules.GET', { query, user });

  if (!user) {
    return authorizationFailed();
  }

  // supports ?vehicle=<id> via the vehicle lookup, same as documents
  const schedules = await getSchedules({ ...query, user: user.id });

  return NextResponse.json({ schedules });
}

// hand-entered (or fixture-supplied) schedules; extraction goes through
// POST /api/documents/[id]/schedule instead
export async function POST(request: NextRequest) {
  const user = await currentUser();
  console.log('app.api.schedules.POST', { user });

  if (!user) {
    return authorizationFailed();
  }

  const { schedule } = await request.json();
  console.log('app.api.schedules.POST', { schedule });

  // schedules must belong to one of the caller's own vehicles
  const vehicle = schedule?.vehicleId && await getVehicle(schedule.vehicleId);

  if (!vehicle || vehicle.userId != user.id) {
    return badRequest('invalid vehicleId');
  }

  // ...and, when they reference a document, one of the caller's own
  if (schedule.documentId) {
    const document = await getDocument(schedule.documentId);
    if (!document || document.userId != user.id) {
      return badRequest('invalid documentId');
    }
  }

  // strip any client-supplied id (the store mints one on create) rather than setting it
  // to undefined -- an explicit `id: undefined` key would survive the store's spread and
  // clobber the generated id. status is stripped too: new schedules are ALWAYS created
  // as "proposed" -- a body arriving with status "confirmed" is promoted right after via
  // confirmSchedule, the single sanctioned path to "confirmed" (so the swap-delete of
  // any prior confirmed schedule always runs).
  const { id: _clientId, status: clientStatus, ...scheduleData } = schedule;

  let newSchedule = await saveSchedule({
    ...scheduleData,
    source: scheduleData.source || "user",
    status: "proposed",
    items: scheduleData.items || [],
    userId: user.id,
  }, user);

  if (newSchedule?.id && clientStatus == "confirmed") {
    newSchedule = await confirmSchedule(newSchedule.id, user);
  }

  await trackEvent("schedule-created", {
    userId: user.id,
    userIsAdmin: !!user.publicMetadata?.isAdmin,
    id: newSchedule?.id,
    source: newSchedule?.source,
    status: newSchedule?.status,
  });

  return NextResponse.json({ schedule: newSchedule });
}
