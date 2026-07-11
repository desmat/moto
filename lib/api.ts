import { NextResponse } from "next/server";
import { SessionUser } from "@/types/User";

// Shared response/guard helpers for the API routes.
//
// Note on middleware: proxy.ts already gates every non-public route behind a Clerk
// session (returning 403 JSON for /api routes), so the per-route `currentUser()` check
// is defense-in-depth rather than the primary gate — routes call `currentUser()` anyway
// because they need the internal user id for scoping, and the `if (!user)` branch also
// covers non-proxy execution paths (tests hitting routes directly, future route
// handlers excluded from the proxy matcher). What was actually repetitive is the
// response boilerplate, which lives here instead.

export function jsonError(message: string, status: number): NextResponse {
  return NextResponse.json({ success: false, message }, { status });
}

export const authorizationFailed = () => jsonError("authorization failed", 403);
export const notFound = () => jsonError("not found", 404);
export const badRequest = (message: string) => jsonError(message, 400);

// ownership guard: a record is accessible to its owner, and to admins
export const canAccess = (user: SessionUser, record: { userId?: string }) =>
  record.userId == user.id || !!user.publicMetadata?.isAdmin;
