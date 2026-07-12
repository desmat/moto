import { NextRequest, NextResponse } from 'next/server'
import { authorizationFailed, canAccess, jsonError, notFound } from '@/lib/api';
import trackEvent from '@/lib/trackEventServer';
import { getDocument, ingestDocument } from '@/services/documents';
import { currentUser } from '@/services/users'

// ingestion runs in-route (no queue infrastructure): a real owner's manual can take
// minutes to extract + embed. The client treats this POST as fire-and-forget and polls
// document status as the source of truth (hooks/use-document.tsx), so a proxy timeout
// on a big manual is harmless.
export const maxDuration = 300;

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const user = await currentUser();
  console.log('app.api.documents.[id].ingest.POST', { id, user });

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

  if (existing.status == "processing") {
    return jsonError("document is already processing", 409);
  }

  // synchronous: resolves with the document in its final state ("ready" or "error" —
  // ingestDocument stores failures on the record instead of throwing, so this route
  // returns 200 with the errored document; status is the source of truth)
  const document = await ingestDocument(id);

  await trackEvent("document-ingested", {
    userId: user.id,
    userIsAdmin: !!user.publicMetadata?.isAdmin,
    id: document?.id,
    status: document?.status,
    pageCount: document?.pageCount,
  });

  return NextResponse.json({ document });
}
