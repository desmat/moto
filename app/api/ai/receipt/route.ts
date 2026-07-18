import { NextRequest, NextResponse } from 'next/server'
import { authorizationFailed, badRequest, canAccess, jsonError, notFound } from '@/lib/api';
import trackEvent from '@/lib/trackEventServer';
import { getAttachment } from '@/services/attachments';
import { readReceipt, ReceiptReading } from '@/services/receipt';
import { currentUser } from '@/services/users'

// one receipt can span several photos (page per pic — S11b), so the body carries
// `attachmentIds: string[]` in page order; a single `attachmentId` is still accepted
// (same contract as before S11b). Every id must resolve to the caller's own image
// attachment — 404 on any missing id, 403 on any foreign one, 400 on any non-image.
const MAX_RECEIPT_IMAGES = 8;

export async function POST(request: NextRequest) {
  const user = await currentUser();
  console.log('app.api.ai.receipt.POST', { user });

  if (!user) {
    return authorizationFailed();
  }

  const { attachmentId, attachmentIds } = await request.json();
  const ids: string[] = Array.isArray(attachmentIds) && attachmentIds.length
    ? attachmentIds
    : (attachmentId ? [attachmentId] : []);

  if (!ids.length) {
    return notFound();
  }

  if (ids.length > MAX_RECEIPT_IMAGES) {
    return badRequest(`too many images (max ${MAX_RECEIPT_IMAGES})`);
  }

  const attachments = await Promise.all(ids.map((id) => getAttachment(id)));

  if (attachments.some((attachment) => !attachment)) {
    return notFound();
  }

  if (attachments.some((attachment) => !canAccess(user, attachment!))) {
    return authorizationFailed();
  }

  if (attachments.some((attachment) => !attachment!.contentType?.startsWith("image/"))) {
    return badRequest('attachment is not an image');
  }

  let result: ReceiptReading;
  try {
    result = await readReceipt(attachments.map((attachment) => attachment!.url));
  } catch (error) {
    // 502 (not a 4xx) so the client can tell "the AI call failed, try again" apart from
    // "your request was wrong"
    console.error('app.api.ai.receipt.POST', { error });
    return jsonError('could not read the receipt', 502);
  }

  await trackEvent("receipt-ocr", {
    userId: user.id,
    userIsAdmin: !!user.publicMetadata?.isAdmin,
    // scalar only — the analytics sink rejects arrays/objects
    attachmentIds: ids.join(","),
    images: ids.length,
    readable: result.receipt_clearly_visible,
    items: result.items.length,
  });

  return NextResponse.json({ result });
}
