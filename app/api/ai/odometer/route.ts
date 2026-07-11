import { NextRequest, NextResponse } from 'next/server'
import { authorizationFailed, badRequest, canAccess, jsonError, notFound } from '@/lib/api';
import trackEvent from '@/lib/trackEventServer';
import { getAttachment } from '@/services/attachments';
import { readOdometer, OdometerReading } from '@/services/odometer';
import { currentUser } from '@/services/users'

export async function POST(request: NextRequest) {
  const user = await currentUser();
  console.log('app.api.ai.odometer.POST', { user });

  if (!user) {
    return authorizationFailed();
  }

  const { attachmentId } = await request.json();
  const attachment = attachmentId ? await getAttachment(attachmentId) : undefined;

  if (!attachment) {
    return notFound();
  }

  if (!canAccess(user, attachment)) {
    return authorizationFailed();
  }

  if (!attachment.contentType?.startsWith("image/")) {
    return badRequest('attachment is not an image');
  }

  let result: OdometerReading;
  try {
    result = await readOdometer(attachment.url);
  } catch (error) {
    // 502 (not a 4xx) so the client can tell "the AI call failed, try again" apart from
    // "your request was wrong"
    console.error('app.api.ai.odometer.POST', { error });
    return jsonError('could not read the odometer', 502);
  }

  await trackEvent("odometer-ocr", {
    userId: user.id,
    userIsAdmin: !!user.publicMetadata?.isAdmin,
    attachmentId,
    confidence: result.confidence,
    readable: result.reading != null,
  });

  return NextResponse.json({ result });
}
