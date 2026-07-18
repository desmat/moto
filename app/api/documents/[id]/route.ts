import { NextRequest, NextResponse } from 'next/server'
import { authorizationFailed, canAccess, notFound } from '@/lib/api';
import trackEvent from '@/lib/trackEventServer';
import { deleteDocument, getDocument, saveDocument } from '@/services/documents';
import { currentUser } from '@/services/users'

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const user = await currentUser();
  console.log('app.api.documents.[id].GET', { id, user });

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

  return NextResponse.json({ document });
}

export async function PUT(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const user = await currentUser();
  console.log('app.api.documents.[id].PUT', { id, user });

  if (!user) {
    return authorizationFailed();
  }

  const existing = await getDocument(id);

  if (!existing) {
    return notFound();
  }

  if (!canAccess(user, existing)) {
    return authorizationFailed();
  }

  const { document } = await request.json();

  // id/owner/creation fields are pinned to the existing record, and so are the
  // references (vehicleId/attachmentId) and the ingest-owned lifecycle fields
  // (status/error/pageCount, driven by the service layer in S9) -- title/type are the
  // editable bits
  const updated = await saveDocument({
    ...document,
    id: existing.id,
    userId: existing.userId,
    createdAt: existing.createdAt,
    createdBy: existing.createdBy,
    vehicleId: existing.vehicleId,
    attachmentId: existing.attachmentId,
    status: existing.status,
    error: existing.error,
    pageCount: existing.pageCount,
  }, user);

  await trackEvent("document-updated", {
    userId: user.id,
    userIsAdmin: !!user.publicMetadata?.isAdmin,
    id: updated?.id,
  });

  return NextResponse.json({ document: updated });
}

export async function DELETE(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const user = await currentUser();
  console.log('app.api.documents.[id].DELETE', { id, user });

  if (!user) {
    return authorizationFailed();
  }

  const existing = await getDocument(id);

  if (!existing) {
    return notFound();
  }

  // this ownership check is load-bearing for the cascade: services/vector.ts's
  // deleteByDocument cannot enforce tenant isolation itself (prefix delete ignores
  // metadata) -- deleteDocument's caller contract requires it
  if (!canAccess(user, existing)) {
    return authorizationFailed();
  }

  // cascades to the document's vectors and attachment (record + blob) in the service
  const deleted = await deleteDocument(id);

  await trackEvent("document-deleted", {
    userId: user.id,
    userIsAdmin: !!user.publicMetadata?.isAdmin,
    id: deleted?.id,
  });

  return NextResponse.json({ document: deleted });
}
