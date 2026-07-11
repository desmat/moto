import { NextRequest, NextResponse } from 'next/server'
import trackEvent from '@/lib/trackEventServer';
import { extractFromImage } from '@/services/ai';
import { getAttachment } from '@/services/attachments';
import { currentUser } from '@/services/users'

export type OdometerReading = {
  odometer_digits_clearly_visible: boolean,
  reading: number | null,   // null = the model's honest "can't read it"
  unit: "km" | "mi" | null,
  confidence: "high" | "low",
};

// Strict-mode (response_format json_schema, strict: true) shape: every property listed
// in `required`, `additionalProperties: false`, nullability via type arrays / anyOf.
// The boolean gate comes FIRST on purpose: forcing the model to commit to "are digits
// actually visible?" before emitting a reading is what stops it from fabricating a
// plausible number for unreadable/irrelevant photos (observed with gpt-4o during the
// S6 real-key pass: prompt-only "don't guess" instructions were not enough — a
// featureless test image produced confident hallucinated readings until this field
// was added).
const odometerSchema = {
  type: "object",
  properties: {
    odometer_digits_clearly_visible: {
      type: "boolean",
      description: "true ONLY if the image contains an odometer display whose individual digits you can actually see and read. false for anything else (no vehicle dashboard, no digits, blur, glare, abstract images).",
    },
    reading: {
      type: ["number", "null"],
      description: "The digits shown, transcribed exactly. MUST be null when odometer_digits_clearly_visible is false.",
    },
    unit: {
      anyOf: [
        { type: "string", enum: ["km", "mi"] },
        { type: "null" },
      ],
      description: "The reading's unit if indicated on or near the display, otherwise null.",
    },
    confidence: {
      type: "string",
      enum: ["high", "low"],
      description: "high only when every digit is clearly legible.",
    },
  },
  required: ["odometer_digits_clearly_visible", "reading", "unit", "confidence"],
  additionalProperties: false,
};

const ODOMETER_PROMPT = `You are a strict transcriber reading a vehicle's odometer from a photo. You only report digits actually visible in the image — never estimate, infer, or invent a plausible number.

First decide: does the image clearly contain an odometer display with individually distinguishable digits? Set odometer_digits_clearly_visible accordingly. If it is false, reading MUST be null — null is the correct, expected answer for an unreadable or irrelevant photo; a fabricated number is the worst possible answer.

If digits are clearly visible: displays often show an odometer (total distance, usually the larger number, often labeled ODO) plus one or more trip meters (labeled TRIP, A, B) — return the odometer, preferring the ODO-labeled value, otherwise the larger total-distance value.

Report the unit (km or mi) only if it is indicated on or near the display; otherwise return null for the unit. Report "high" confidence only when every single digit is crisply legible; any doubt about any digit means "low".`;

export async function POST(request: NextRequest) {
  const user = await currentUser();
  console.log('app.api.ai.odometer.POST', { user });

  if (!user) {
    return NextResponse.json(
      { success: false, message: 'authorization failed' },
      { status: 403 }
    );
  }

  const { attachmentId } = await request.json();
  const attachment = attachmentId ? await getAttachment(attachmentId) : undefined;

  if (!attachment) {
    return NextResponse.json(
      { success: false, message: 'not found' },
      { status: 404 }
    );
  }

  if (!(attachment.userId == user.id || user.publicMetadata?.isAdmin)) {
    return NextResponse.json(
      { success: false, message: 'authorization failed' },
      { status: 403 }
    );
  }

  if (!attachment.contentType?.startsWith("image/")) {
    return NextResponse.json(
      { success: false, message: 'attachment is not an image' },
      { status: 400 }
    );
  }

  let result: OdometerReading;
  try {
    result = await extractFromImage<OdometerReading>({
      imageUrl: attachment.url,
      prompt: ODOMETER_PROMPT,
      schemaName: "odometer",
      schema: odometerSchema,
    });
  } catch (error) {
    // 502 (not a 4xx) so the client can tell "the AI call failed, try again" apart from
    // "your request was wrong"
    console.error('app.api.ai.odometer.POST', { error });
    return NextResponse.json(
      { success: false, message: 'could not read the odometer' },
      { status: 502 }
    );
  }

  await trackEvent("odometer-ocr", {
    userId: user.id,
    userIsAdmin: !!user.publicMetadata?.isAdmin,
    attachmentId,
    confidence: result.confidence,
    readable: result.reading != null,
  });

  return NextResponse.json({ result });
}
