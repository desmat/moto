import { handleUpload, type HandleUploadBody } from '@vercel/blob/client';
import { NextRequest, NextResponse } from 'next/server'
import { jsonError } from '@/lib/api';
import { currentUser } from '@/services/users'

// Token-exchange endpoint for direct client → Blob uploads (@vercel/blob/client's
// upload() posts here to get a client token). Files never pass through this function —
// only the token request does.
export async function POST(request: NextRequest): Promise<NextResponse> {
  const body = (await request.json()) as HandleUploadBody;

  try {
    const jsonResponse = await handleUpload({
      body,
      request,
      onBeforeGenerateToken: async (pathname: string) => {
        const user = await currentUser();
        console.log('app.api.attachments.upload.POST onBeforeGenerateToken', { pathname, user });

        if (!user) {
          throw new Error('authorization failed');
        }

        // tenant isolation: only issue tokens for the caller's own prefix — the client
        // builds this from its INTERNAL user id (useUserRecord().user.id, matching
        // currentUser().id here), and the attachments POST enforces the same prefix on
        // the record side
        if (!pathname.startsWith(`moto/${user.id}/`)) {
          throw new Error('invalid pathname');
        }

        return {
          allowedContentTypes: ['image/jpeg', 'image/png', 'image/webp', 'image/heic', 'application/pdf'],
          maximumSizeInBytes: 20 * 1024 * 1024,
          addRandomSuffix: true,
        };
      },
      // Log-only no-op: record creation is the CLIENT's job (lib/upload.ts callers POST
      // /api/attachments right after upload() resolves). This webhook can't reach
      // localhost, so relying on it would make dev and prod behave differently.
      onUploadCompleted: async ({ blob }) => {
        console.log('app.api.attachments.upload.POST onUploadCompleted (no-op; client creates the record)', { blob });
      },
    });

    return NextResponse.json(jsonResponse);
  } catch (error) {
    // onBeforeGenerateToken throws (auth/prefix rejections) surface here; the Blob SDK
    // convention is a 400 with the message in the body
    return jsonError((error as Error).message, 400);
  }
}
