import { searchParamsToMap } from '@desmat/utils';
import { NextRequest, NextResponse } from 'next/server'
import trackEvent from '@/lib/trackEventServer';
import { getAttachments, saveAttachment } from '@/services/attachments';
import { currentUser } from '@/services/users'

export async function GET(request: NextRequest, params?: any) {
  const query = searchParamsToMap(request.nextUrl.searchParams.toString()) as any;
  const user = await currentUser();
  console.log('app.api.attachments.GET', { query, user });

  if (!user) {
    return NextResponse.json(
      { success: false, message: 'authorization failed' },
      { status: 403 }
    );
  }

  const attachments = await getAttachments({ ...query, user: user.id });

  return NextResponse.json({ attachments });
}

export async function POST(request: NextRequest) {
  const user = await currentUser();
  console.log('app.api.attachments.POST', { user });

  if (!user) {
    return NextResponse.json(
      { success: false, message: 'authorization failed' },
      { status: 403 }
    );
  }

  const { attachment } = await request.json();
  console.log('app.api.attachments.POST', { attachment });

  // a client may only claim blobs uploaded under its own prefix (the upload token
  // enforces the same prefix at upload time; this closes the record side)
  if (!attachment?.pathname || !attachment.pathname.startsWith(`moto/${user.id}/`)) {
    return NextResponse.json(
      { success: false, message: 'invalid pathname' },
      { status: 400 }
    );
  }

  // idempotency: the client creates the record right after a successful blob upload; if
  // that POST retries, return the existing record (necessarily the same user's, given
  // the prefix check above) instead of duplicating
  const [existing] = await getAttachments({ pathname: attachment.pathname });

  if (existing) {
    return NextResponse.json({ attachment: existing });
  }

  // strip any client-supplied id (the store mints one on create) rather than setting it
  // to undefined -- an explicit `id: undefined` key would survive the store's spread and
  // clobber the generated id
  const { id: _clientId, ...attachmentData } = attachment;

  const newAttachment = await saveAttachment({ ...attachmentData, userId: user.id }, user);

  await trackEvent("attachment-created", {
    userId: user.id,
    userIsAdmin: !!user.publicMetadata?.isAdmin,
    id: newAttachment?.id,
    contentType: newAttachment?.contentType,
    size: newAttachment?.size,
  });

  return NextResponse.json({ attachment: newAttachment });
}
