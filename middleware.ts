import { clerkMiddleware, createRouteMatcher } from "@clerk/nextjs/server";
import { NextRequest, NextResponse } from "next/server";
import { isMockAuthEnabled, mockUser } from "./lib/mock-auth";
import { resolveUser } from "./services/users";

const isApiRoute = createRouteMatcher(['/api(.*)']);
const isPublicRoute = createRouteMatcher(["/"]);
const isApiKeyRoute = createRouteMatcher(["/api/admin(.*)"]);

async function handleRequest(request: NextRequest, authData: any) {
  if (isPublicRoute(request)) {
    return NextResponse.next();
  }

  // api key
  if (isApiKeyRoute(request)) {
    const apiKey = `${request.headers.get("x-api-key")}`;

    if (apiKey != process.env.API_KEY) {
      return NextResponse.json(
        { success: false, message: 'authorization failed' },
        { status: 403 }
      );
    }

    return NextResponse.next();
  }

  // protected route at this point

  const { userId, sessionId } = authData;

  if (!userId) {
    if (isApiRoute(request)) {
      return NextResponse.json(
        { success: false, message: 'authorization failed' },
        { status: 403 }
      );
    } else {
      return NextResponse.redirect(new URL('/', request.url))
    }
  }

  // upserts the persisted User record: internally keyed by a short UUID (NOT the auth
  // provider's user id), resolved via the providerId lookup. In mock mode the id is forced
  // to the mock identity itself so seeded/test data keyed to that exact id lines up.
  await resolveUser({
    providerId: userId,
    sessionId,
    authProvider: isMockAuthEnabled() ? "mock" : "clerk",
    authData,
    ...isMockAuthEnabled() && { id: userId },
  });

  return NextResponse.next();
}

// in mock mode, bypass Clerk entirely so no session/keys are required in dev/tests
export default isMockAuthEnabled()
  ? (request: NextRequest) => handleRequest(request, { userId: mockUser.id, sessionId: mockUser.sessionId })
  : clerkMiddleware(async (auth: any, request: NextRequest) => handleRequest(request, await auth()));

export const config = {
  matcher: [
    // Skip Next.js internals and all static files, unless found in search params
    '/((?!_next|[^?]*\\.(?:html?|css|js(?!on)|jpe?g|webp|png|gif|svg|ttf|woff2?|ico|csv|docx?|xlsx?|zip|webmanifest)).*)',
    // Always run for API routes
    '/(api|trpc)(.*)',
  ],
};
