import moment from "moment";
import { ChatMessage, chatJSON } from "./ai";
import { LogItem } from "@/types/Log";
import { CANONICAL_COMPONENT_KEYS } from "@/types/MaintenanceSchedule";
import { Vehicle, vehicleName } from "@/types/Vehicle";

// The S13 onboarding interview (one structured AI call per turn, no server-side
// session): domain type, JSON schema, system prompt, and normalization live here in the
// service layer, mirroring services/receipt.ts; app/api/ai/onboarding/route.ts is just
// the HTTP shell around runOnboardingTurn().

const ProposedLogTypes = ["service", "mileage", "journal"] as const;
const ProposedItemActions = ["replace", "inspect", "adjust", "lubricate", "clean", "other"] as const;

// the model's raw output shape (null-able fields per strict mode); normalizeTurn()
// turns it into the OnboardingTurn callers consume
type ExtractedTurn = {
  message: string,
  done: boolean,
  suggestUpload: boolean,
  proposal: {
    mileage: number | null,
    logs: {
      type: "service" | "mileage" | "journal",
      date: string,
      entry: string,
      items: { key: string, name: string, action: string, note: string | null }[],
      mileage: number | null,
      estimated: boolean,
    }[],
  },
};

// one proposed backdated log — becomes a normal Log via POST /api/logs on confirm
// (`estimated` is review-screen provenance the client strips before saving)
export type ProposedLog = {
  type: string,
  date: string,       // YYYYMMDD (estimated ok)
  entry: string,
  items?: LogItem[],
  mileage?: number,
  estimated: boolean,
};

// what the route returns to the interview dialog each turn
export type OnboardingTurn = {
  message: string,
  done: boolean,
  suggestUpload: boolean,
  proposal: {
    mileage?: number,
    logs: ProposedLog[],
  },
};

// Strict-mode shape (every property required, additionalProperties: false, nullability
// via type arrays). Unlike the extraction schemas there is no leading boolean visibility
// gate — there's no image to hallucinate from, the "input" is the user's own words —
// but the schema stays strict so every turn parses. `key` is a plain string, not an
// enum: strict mode forbids a dynamic vocabulary, so CANONICAL_COMPONENT_KEYS is prompt
// guidance plus server-side slugify (normalizeTurn below), same as services/receipt.ts.
const onboardingTurnSchema = {
  type: "object",
  properties: {
    message: {
      type: "string",
      description: "What to say to the user next: a short acknowledgement of their last answer plus ONE question — or, when done is true, a brief summary of what will be recorded.",
    },
    done: {
      type: "boolean",
      description: "true when the interview is finished (enough questions asked, or the user wants to stop) and the proposal is final. false while another question is coming.",
    },
    suggestUpload: {
      type: "boolean",
      description: "true ONLY when the message asks the user about uploading their owner's manual — the app then shows an upload button inline.",
    },
    proposal: {
      type: "object",
      description: "The FULL set of records to create, rebuilt cumulatively from the whole conversation on every turn — never a delta.",
      properties: {
        mileage: {
          type: ["number", "null"],
          description: "The vehicle's current odometer reading as answered by the user, in the vehicle's units. null until they've answered.",
        },
        logs: {
          type: "array",
          description: "Proposed log records. AT MOST ONE log may have type \"mileage\" (the current reading); historical odometer readings belong on the backdated service logs' mileage field instead.",
          items: {
            type: "object",
            properties: {
              type: {
                type: "string",
                enum: [...ProposedLogTypes],
                description: "\"service\" for past maintenance work, \"mileage\" ONLY for the single current-reading log, \"journal\" for anything else worth noting.",
              },
              date: {
                type: "string",
                description: "YYYYMMDD. For vague answers (\"maybe three months ago\") estimate a plausible date and set estimated true. The current-mileage log uses today's date.",
              },
              entry: {
                type: "string",
                description: "Short human-readable text for the log. For a mileage log: just the reading digits (e.g. \"12800\").",
              },
              items: {
                type: "array",
                description: "For service logs: one entry per component serviced. Empty for mileage/journal logs.",
                items: {
                  type: "object",
                  properties: {
                    key: {
                      type: "string",
                      description: `Canonical kebab-case component key. STRONGLY prefer one of: ${CANONICAL_COMPONENT_KEYS.join(", ")}. Only mint a new kebab-case slug when none of those fit.`,
                    },
                    name: {
                      type: "string",
                      description: "Short, clean component name capitalized like a sentence — \"Engine oil\", \"Front tire\".",
                    },
                    action: {
                      type: "string",
                      enum: [...ProposedItemActions],
                      description: "What was done to the component. Use \"other\" only when none fit.",
                    },
                    note: {
                      type: ["string", "null"],
                      description: "Brand/spec detail the user mentioned (\"10W-30 full synthetic\"). null when nothing worth keeping.",
                    },
                  },
                  required: ["key", "name", "action", "note"],
                  additionalProperties: false,
                },
              },
              mileage: {
                type: ["number", "null"],
                description: "The odometer reading tied to this log, if known or estimable from the user's answer (estimated ok — set estimated true). null when unknown.",
              },
              estimated: {
                type: "boolean",
                description: "true when the date and/or mileage was estimated from a vague answer rather than stated exactly.",
              },
            },
            required: ["type", "date", "entry", "items", "mileage", "estimated"],
            additionalProperties: false,
          },
        },
      },
      required: ["mileage", "logs"],
      additionalProperties: false,
    },
  },
  required: ["message", "done", "suggestUpload", "proposal"],
  additionalProperties: false,
};

// interview for THIS vehicle: maker/model/year/mileage interpolated, plus today's date
// so vague answers convert to concrete estimated dates
function systemPrompt(vehicle: Vehicle): string {
  return `You are MotoGPT's friendly onboarding assistant, interviewing the owner of a ${vehicleName(vehicle)} (${vehicle.type}${vehicle.mileage ? `, currently at ${vehicle.mileage} km` : ""}) to seed their maintenance history. Today's date is ${moment().format("YYYY-MM-DD")}.

Rules:
- Ask ONE short, conversational question per turn. Ask AT MOST 5 questions total, in roughly this order: current odometer mileage${vehicle.mileage ? " (skip it — already known, shown above)" : ""} → when the oil was last changed → chain and tires → anything else recent (other services, repairs, the owner's manual as a PDF to upload). Skip questions the user has already answered, and stop early if they want to stop or clearly have nothing more.
- When your question mentions uploading the owner's manual, set suggestUpload to true (the app renders an upload button inline); otherwise false.
- Rebuild the FULL proposal from the whole conversation on EVERY turn — it is cumulative, never a delta. Nothing is saved until the user confirms, so include everything gathered so far. NEVER drop a log proposed on an earlier turn unless the user corrected or retracted it; before setting done true, re-read every user answer and check each is reflected in the proposal. The done-summary message must describe exactly what the proposal contains — never promise to note or record something that is not in it.
- Convert vague answers into concrete values, marked estimated true: "oil was done maybe 2000 km ago" at a current reading of 12800 becomes a service log with mileage 10800 and a date estimated from typical riding pace; "new tires in May" becomes an estimated mid-May date. Exact answers keep estimated false.
- Past maintenance becomes type "service" logs with one items[] entry per component serviced, using the canonical keys where they fit: ${CANONICAL_COMPONENT_KEYS.join(", ")}.
- The current odometer reading goes in proposal.mileage AND as the single type "mileage" log (today's date, the reading digits as entry). AT MOST ONE mileage-type log — historical odometer readings ride as the mileage field on the backdated service logs, never as extra mileage logs.
- Anything noteworthy that isn't maintenance (a crash, a modification, storage) can be a "journal" log.
- Never invent facts the user didn't give you: no answer, no log.
- When you have enough (or the user is finished), set done true and make message a short summary of what will be recorded, e.g. "I'll record: mileage 12,800 km • oil change ~10,800 km (est.) • new tires May 2026."`;
}

// server-side companion to the prompt's key guidance, same as services/receipt.ts
function slugifyKey(value: string): string {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

function asFiniteNumber(value: unknown): number | undefined {
  return typeof value == "number" && isFinite(value) ? value : undefined;
}

// null → undefined (dropped from JSON), item keys slugified, junk rows dropped
export function normalizeTurn(extracted: ExtractedTurn): OnboardingTurn {
  const logs: ProposedLog[] = (extracted.proposal?.logs || [])
    .filter((log) => (ProposedLogTypes as readonly string[]).includes(log.type) && `${log.date || ""}`.trim())
    .map((log) => {
      const items: LogItem[] = (log.items || [])
        .filter((item) => (item.key || item.name)?.trim())
        .map((item) => ({
          key: slugifyKey(item.key?.trim() || item.name),
          name: item.name?.trim() || item.key,
          action: ((ProposedItemActions as readonly string[]).includes(item.action) ? item.action : "other") as LogItem["action"],
          ...typeof item.note == "string" && item.note.trim() && { note: item.note.trim() },
        }));

      return {
        type: log.type,
        date: `${log.date}`.trim(),
        entry: `${log.entry ?? ""}`.trim(),
        ...items.length > 0 && { items },
        ...asFiniteNumber(log.mileage) != undefined && { mileage: asFiniteNumber(log.mileage) },
        estimated: !!log.estimated,
      };
    });

  return {
    message: `${extracted.message ?? ""}`,
    done: !!extracted.done,
    suggestUpload: !!extracted.suggestUpload,
    proposal: {
      ...asFiniteNumber(extracted.proposal?.mileage) != undefined && { mileage: asFiniteNumber(extracted.proposal?.mileage) },
      logs,
    },
  };
}

// one turn: the client-held transcript (user/assistant messages only) in, the next
// structured turn out. The system prompt is prepended fresh every call.
export async function runOnboardingTurn({ vehicle, messages }: {
  vehicle: Vehicle,
  messages: ChatMessage[],
}): Promise<OnboardingTurn> {
  console.log("services.onboarding.runOnboardingTurn", { vehicleId: vehicle.id, messageCount: messages.length });

  const extracted = await chatJSON<ExtractedTurn>({
    messages: [
      { role: "system", content: systemPrompt(vehicle) },
      ...messages,
    ],
    schemaName: "onboarding",
    schema: onboardingTurnSchema,
    // no model override on purpose: the default (MODELS.vision) until the real-key
    // tuning pass (plan step 7) says otherwise; low keeps per-turn latency chat-like
    reasoningEffort: "low",
  });

  return normalizeTurn(extracted);
}
