import { NextRequest, NextResponse } from 'next/server'
import { authorizationFailed, canAccess, notFound } from '@/lib/api';
import trackEvent from '@/lib/trackEventServer';
import { deleteAttachment, getAttachment, saveAttachment } from '@/services/attachments';
import { currentUser } from '@/services/users'

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const user = await currentUser();
  console.log('app.api.attachments.[id].GET', { id, user });

  if (!user) {
    return authorizationFailed();
  }

  const attachment = await getAttachment(id);

  if (!attachment) {
    return notFound();
  }

  if (!canAccess(user, attachment)) {
    return authorizationFailed();
  }

  return NextResponse.json({ attachment });
}

export async function PUT(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const user = await currentUser();
  console.log('app.api.attachments.[id].PUT', { id, user });

  if (!user) {
    return authorizationFailed();
  }

  const existing = await getAttachment(id);

  if (!existing) {
    return notFound();
  }

  if (!canAccess(user, existing)) {
    return authorizationFailed();
  }

  const { attachment } = await request.json();

  // id/owner/creation fields are pinned to the existing record, and so are the blob
  // fields (url/pathname/size/contentType) -- PUT exists to set logId/vehicleId, not to
  // repoint records at other blobs
  const updated = await saveAttachment({
    ...attachment,
    id: existing.id,
    userId: existing.userId,
    createdAt: existing.createdAt,
    createdBy: existing.createdBy,
    url: existing.url,
    pathname: existing.pathname,
    size: existing.size,
    contentType: existing.contentType,
  }, user);

  await trackEvent("attachment-updated", {
    userId: user.id,
    userIsAdmin: !!user.publicMetadata?.isAdmin,
    id: updated?.id,
  });

  return NextResponse.json({ attachment: updated });
}

export async function DELETE(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const user = await currentUser();
  console.log('app.api.attachments.[id].DELETE', { id, user });

  if (!user) {
    return authorizationFailed();
  }

  const existing = await getAttachment(id);

  if (!existing) {
    return notFound();
  }

  if (!canAccess(user, existing)) {
    return authorizationFailed();
  }

  const deleted = await deleteAttachment(id);

  await trackEvent("attachment-deleted", {
    userId: user.id,
    userIsAdmin: !!user.publicMetadata?.isAdmin,
    id: deleted?.id,
  });

  return NextResponse.json({ attachment: deleted });
}
