import { extractFromImage } from "./ai";

// Odometer-reading extraction: the domain type, JSON schema, and prompt live here in
// the service layer; app/api/ai/odometer/route.ts is just the HTTP shell around
// readOdometer(). Phase 2's receipt extraction should follow this same shape
// (services/receipt.ts + a thin /api/ai/receipt route).

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

export async function readOdometer(imageUrl: string): Promise<OdometerReading> {
  console.log("services.odometer.readOdometer", { imageUrl });

  return extractFromImage<OdometerReading>({
    imageUrl,
    prompt: ODOMETER_PROMPT,
    schemaName: "odometer",
    schema: odometerSchema,
    // per-feature model choice: reading digits off a dashboard photo is a narrow
    // transcription task with no benefit from deliberation, so reasoning is off
    model: "gpt-5.6-luna",
    reasoningEffort: "none",
  });
}
