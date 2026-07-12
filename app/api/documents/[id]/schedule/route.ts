import { NextRequest, NextResponse } from 'next/server'
import { authorizationFailed, badRequest, canAccess, jsonError, notFound } from '@/lib/api';
import trackEvent from '@/lib/trackEventServer';
import { getDocument } from '@/services/documents';
import { extractSchedule } from '@/services/schedule-extraction';
import { currentUser } from '@/services/users'

// like ingest: the whole extraction (file upload to OpenAI + full-document read) runs
// in-route; a real manual can take a while. Unlike ingest there's no status machine on
// schedules — the POST resolves with the proposed schedule directly.
export const maxDuration = 300;

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const user = await currentUser();
  console.log('app.api.documents.[id].schedule.POST', { id, user });

  if (!user) {
    return authorizationFailed();
  }

  const document = await getDocument(id);

  if (!document) {
    return notFound();
  }

  if (!canAccess(user, document)) {
    return authorizationFailed();
  }

  if (document.type != "manual") {
    return badRequest('document is not a manual');
  }

  let schedule;
  try {
    schedule = await extractSchedule(document, user);
  } catch (error) {
    // 502 (not a 4xx) so the client can tell "the AI call failed, try again" apart from
    // "your request was wrong" — same convention as the odometer route
    console.error('app.api.documents.[id].schedule.POST', { error });
    return jsonError('could not extract a maintenance schedule', 502);
  }

  if (!schedule) {
    // the extraction's boolean gate said the document contains no schedule table —
    // honest empty answer, no record created (422: the document itself can't satisfy
    // the request, retrying won't change that)
    return jsonError('no maintenance schedule found in the document', 422);
  }

  await trackEvent("schedule-extracted", {
    userId: user.id,
    userIsAdmin: !!user.publicMetadata?.isAdmin,
    documentId: id,
    scheduleId: schedule.id,
    itemCount: schedule.items.length,
  });

  return NextResponse.json({ schedule });
}
