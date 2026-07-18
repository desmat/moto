import { NextRequest, NextResponse } from 'next/server'
import { authorizationFailed, badRequest, canAccess, jsonError, notFound } from '@/lib/api';
import trackEvent from '@/lib/trackEventServer';
import { runOnboardingTurn, OnboardingTurn } from '@/services/onboarding';
import { currentUser } from '@/services/users'
import { getVehicle } from '@/services/vehicles';

// One onboarding-interview turn (S13): the client holds the whole transcript and sends
// it every call — no server-side session. Body: { vehicleId, messages: [{ role:
// "user" | "assistant", content: string }] }; response: the OnboardingTurn JSON
// ({ message, done, suggestUpload, proposal }). The transcript is capped (drop oldest)
// as a token guard — the system prompt makes the interview short anyway.
const MAX_MESSAGES = 20;

export async function POST(request: NextRequest) {
  const user = await currentUser();
  console.log('app.api.ai.onboarding.POST', { user });

  if (!user) {
    return authorizationFailed();
  }

  const { vehicleId, messages } = await request.json();

  // the interview must be about one of the caller's own vehicles (same pattern as the
  // logs POST): 404 for a missing id, 403 for a foreign one
  const vehicle = vehicleId && await getVehicle(vehicleId);
  if (!vehicle) {
    return notFound();
  }
  if (!canAccess(user, vehicle)) {
    return authorizationFailed();
  }

  if (!Array.isArray(messages)
    || messages.some((message: any) => !message
      || (message.role != "user" && message.role != "assistant")
      || typeof message.content != "string")) {
    return badRequest('messages must be an array of { role: "user" | "assistant", content: string }');
  }

  let result: OnboardingTurn;
  try {
    result = await runOnboardingTurn({ vehicle, messages: messages.slice(-MAX_MESSAGES) });
  } catch (error) {
    // 502 (not a 4xx) so the client can tell "the AI call failed, try again" apart from
    // "your request was wrong"
    console.error('app.api.ai.onboarding.POST', { error });
    return jsonError('onboarding turn failed', 502);
  }

  await trackEvent("onboarding-turn", {
    userId: user.id,
    userIsAdmin: !!user.publicMetadata?.isAdmin,
    vehicleId,
    done: result.done,
  });

  return NextResponse.json(result);
}
