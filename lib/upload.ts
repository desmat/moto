import { upload } from "@vercel/blob/client";

export type UploadedBlob = {
  url: string;
  pathname: string;
  contentType: string;
  size: number;
  filename: string;
};

// base64 of a File's contents without Buffer (this runs in the browser)
async function fileToDataUrl(file: File): Promise<string> {
  const bytes = new Uint8Array(await file.arrayBuffer());
  let binary = "";
  for (let i = 0; i < bytes.length; i++) {
    binary += String.fromCharCode(bytes[i]);
  }
  return `data:${file.type || "application/octet-stream"};base64,${btoa(binary)}`;
}

/**
 * Uploads a file directly to Vercel Blob (client → Blob, via the token exchange at
 * /api/attachments/upload) and returns the fields the caller needs to POST
 * /api/attachments afterwards — record creation is the caller's job, not this
 * function's and not the upload route's webhook.
 *
 * `userId` MUST be the INTERNAL short-uuid user id — `useUserRecord().user.id` — NOT
 * the auth provider's id from `useUser()` (a Clerk `user_…` in prod). The upload route
 * only issues tokens for pathnames under `moto/${currentUser().id}/`, and
 * `currentUser().id` is the internal id; the two coincide only under
 * mock-auth/impersonation, so a `useUser()`-built prefix passes tests but is rejected
 * for every real Clerk user.
 *
 * BLOB_MOCK=true (whitelisted in next.config.mjs's env block — see the AGENTS.md
 * footgun) short-circuits to a fake result: no network, no token, nothing written to
 * the real Blob store.
 */
export async function uploadFile(file: File, userId: string): Promise<UploadedBlob> {
  if (process.env.BLOB_MOCK == "true") {
    // The fake pathname must be UNIQUE per call, mirroring the real flow's
    // addRandomSuffix — a deterministic pathname (e.g. `mock-${file.name}`) would
    // collide across specs sharing a fixture, because the attachments POST is
    // idempotent-by-pathname and would silently return the first spec's
    // already-linked record. url = a data-URL of the file contents (small test
    // fixtures only) so it flows through the normal record-creation path and renders.
    const rand = Math.random().toString(16).slice(2, 10);
    return {
      url: await fileToDataUrl(file),
      pathname: `moto/${userId}/mock-${Date.now()}-${rand}-${file.name}`,
      contentType: file.type || "application/octet-stream",
      size: file.size,
      filename: file.name,
    };
  }

  const result = await upload(`moto/${userId}/${file.name}`, file, {
    access: "public",
    handleUploadUrl: "/api/attachments/upload",
  });

  return {
    url: result.url,
    pathname: result.pathname,
    contentType: result.contentType,
    size: file.size,
    filename: file.name,
  };
}
