import { searchParamsToMap } from '@desmat/utils';
import { NextRequest, NextResponse } from 'next/server'
import trackEvent from '@/lib/trackEventServer';
import { getAttachment, saveAttachment } from '@/services/attachments';
import { getLogs, saveLog } from '@/services/logs';
import { currentUser } from '@/services/users';
import { getVehicle } from '@/services/vehicles';

export async function GET(request: NextRequest, params?: any) {
  const query = searchParamsToMap(request.nextUrl.searchParams.toString()) as any;
  const user = await currentUser();
  console.log('app.api.logs.GET', { query, user });

  if (!user) {
    return NextResponse.json(
      { success: false, message: 'authorization failed' },
      { status: 403 }
    );
  }

  const count = Number(query.count) || undefined;
  const offset = Number(query.offset) || undefined;

  const logs = await getLogs({
    ...query,
    count,
    offset,
    user: user.id,
  });

  return NextResponse.json({ logs, count, offset });
}

export async function POST(request: NextRequest) {
  const user = await currentUser();
  console.log('app.api.logs.POST', { user });

  if (!user) {
    return NextResponse.json(
      { success: false, message: 'authorization failed' },
      { status: 403 }
    );
  }

  const { log, attachmentIds } = await request.json();
  console.log('app.api.logs.POST', { log, attachmentIds });

  // logs must belong to one of the caller's own vehicles
  const vehicle = log?.vehicleId && await getVehicle(log.vehicleId);

  if (!vehicle || vehicle.userId != user.id) {
    return NextResponse.json(
      { success: false, message: 'invalid vehicleId' },
      { status: 400 }
    );
  }

  // strip any client-supplied id (the store mints one on create) rather than setting it
  // to undefined -- an explicit `id: undefined` key would survive the store's spread and
  // clobber the generated id
  const { id: _clientId, ...logData } = log;

  const newLog = await saveLog(logData, user);

  // link pending attachments (uploaded before the log existed) to the new log; done
  // server-side so a client dying mid-sequence can't leave half-linked state
  if (newLog && Array.isArray(attachmentIds)) {
    for (const attachmentId of attachmentIds) {
      const attachment = await getAttachment(attachmentId);

      // never re-link someone else's attachment, nor one already linked to another log
      if (!attachment || attachment.userId != user.id || (attachment.logId && attachment.logId != newLog.id)) {
        console.warn('app.api.logs.POST: skipping attachment link', { attachmentId, attachment });
        continue;
      }

      await saveAttachment({ ...attachment, logId: newLog.id, vehicleId: newLog.vehicleId }, user);
    }
  }

  await trackEvent("log-created", {
    userId: user.id,
    userIsAdmin: !!user.publicMetadata?.isAdmin,
    id: newLog?.id,
    type: newLog?.type,
  });

  return NextResponse.json({ log: newLog });
}
