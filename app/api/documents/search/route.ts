import { NextRequest, NextResponse } from 'next/server'
import { authorizationFailed, badRequest } from '@/lib/api';
import { searchDocuments } from '@/services/documents';
import { currentUser } from '@/services/users'

// Semantic search over ingested document chunks: ?q=...&vehicle=...&document=...
// Primarily Phase 3's chat-tool surface; also S9's verification instrument. Tenant
// isolation is enforced inside the vector query (userId is always the session user's).
// The static `search` segment resolves ahead of the sibling [id] route by Next's
// routing rules — no special handling needed.
export async function GET(request: NextRequest) {
  const searchParams = request.nextUrl.searchParams;
  const q = searchParams.get("q");
  const vehicleId = searchParams.get("vehicle") || undefined;
  const documentId = searchParams.get("document") || undefined;
  const user = await currentUser();
  console.log('app.api.documents.search.GET', { q, vehicleId, documentId, user });

  if (!user) {
    return authorizationFailed();
  }

  if (!q) {
    return badRequest("q is required");
  }

  const chunks = await searchDocuments(q, { userId: user.id, vehicleId, documentId });

  // chunk metadata minus the tenant fields the caller already knows (userId/vehicleId)
  const results = chunks.map(({ documentId, page, chunkIndex, text, score }) =>
    ({ documentId, page, chunkIndex, text, score }));

  return NextResponse.json({ results });
}
