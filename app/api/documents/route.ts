import { searchParamsToMap } from '@desmat/utils';
import { NextRequest, NextResponse } from 'next/server'
import { authorizationFailed, badRequest } from '@/lib/api';
import trackEvent from '@/lib/trackEventServer';
import { getAttachment } from '@/services/attachments';
import { getDocuments, saveDocument } from '@/services/documents';
import { currentUser } from '@/services/users'
import { getVehicle } from '@/services/vehicles';

export async function GET(request: NextRequest, params?: any) {
  const query = searchParamsToMap(request.nextUrl.searchParams.toString()) as any;
  const user = await currentUser();
  console.log('app.api.documents.GET', { query, user });

  if (!user) {
    return authorizationFailed();
  }

  // supports ?vehicle=<id> via the vehicle lookup, same as attachments' ?log=
  const documents = await getDocuments({ ...query, user: user.id });

  return NextResponse.json({ documents });
}

export async function POST(request: NextRequest) {
  const user = await currentUser();
  console.log('app.api.documents.POST', { user });

  if (!user) {
    return authorizationFailed();
  }

  const { document } = await request.json();
  console.log('app.api.documents.POST', { document });

  // documents must belong to one of the caller's own vehicles
  const vehicle = document?.vehicleId && await getVehicle(document.vehicleId);

  if (!vehicle || vehicle.userId != user.id) {
    return badRequest('invalid vehicleId');
  }

  // ...and reference one of the caller's own attachments (the uploaded file)
  const attachment = document?.attachmentId && await getAttachment(document.attachmentId);

  if (!attachment || attachment.userId != user.id) {
    return badRequest('invalid attachmentId');
  }

  // strip any client-supplied id (the store mints one on create) rather than setting it
  // to undefined -- an explicit `id: undefined` key would survive the store's spread and
  // clobber the generated id. Also strip status/error/pageCount: the status state
  // machine belongs to the service/ingest flow (S9) -- new documents always start as
  // "uploaded", with no ingest results.
  const { id: _clientId, status: _clientStatus, error: _clientError, pageCount: _clientPageCount, ...documentData } = document;

  const newDocument = await saveDocument({
    ...documentData,
    title: documentData.title || attachment.filename,
    status: "uploaded",
    userId: user.id,
  }, user);

  await trackEvent("document-created", {
    userId: user.id,
    userIsAdmin: !!user.publicMetadata?.isAdmin,
    id: newDocument?.id,
    type: newDocument?.type,
  });

  return NextResponse.json({ document: newDocument });
}
