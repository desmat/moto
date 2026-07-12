import { extractFromFile } from "./ai";
import { getAttachment } from "./attachments";
import { saveSchedule } from "./schedules";
import { Document } from "@/types/Document";
import { CANONICAL_COMPONENT_KEYS, MaintenanceSchedule, ScheduleItem, ScheduleItemActions } from "@/types/MaintenanceSchedule";
import { SessionUser } from "@/types/User";

// Maintenance-schedule extraction (S10): the domain type, JSON schema, prompt, and
// normalization live here in the service layer, mirroring services/odometer.ts;
// app/api/documents/[id]/schedule/route.ts is just the HTTP shell around
// extractSchedule().

// the model's raw output shape (snake_case gate + null-able numbers per strict mode);
// normalizeItems() turns it into ScheduleItem[]
type ExtractedScheduleItem = {
  key: string,
  name: string,
  action: "replace" | "inspect" | "adjust" | "lubricate" | "clean" | "other",
  intervalKm: number | null,
  intervalMonths: number | null,
  firstAtKm: number | null,
  notes: string | null,
};

type ExtractedSchedule = {
  schedule_table_found: boolean,
  items: ExtractedScheduleItem[],
};

// Strict-mode shape (every property required, additionalProperties: false, nullability
// via type arrays). The boolean gate comes FIRST on purpose — the repo's mandatory
// anti-hallucination convention (see services/odometer.ts's S6 note): forcing the model
// to commit to "did I actually find a maintenance table?" before emitting items is what
// stops it from fabricating a plausible schedule for a document that has none.
//
// `key` is a plain string, not an enum: strict mode forbids interpolating a dynamic
// vocabulary as an enum without freezing it forever, so CANONICAL_COMPONENT_KEYS is
// prompt guidance + server-side slugify/validation instead (normalizeItems below).
const scheduleSchema = {
  type: "object",
  properties: {
    schedule_table_found: {
      type: "boolean",
      description: "true ONLY if the document contains an actual periodic maintenance schedule table (or equivalent structured interval list) whose rows you can read. false for anything else — marketing pages, prose-only documents, unreadable scans.",
    },
    items: {
      type: "array",
      description: "One entry per maintenance-table row/component. MUST be empty when schedule_table_found is false.",
      items: {
        type: "object",
        properties: {
          key: {
            type: "string",
            description: `Canonical kebab-case component key. STRONGLY prefer one of: ${CANONICAL_COMPONENT_KEYS.join(", ")}. Only mint a new kebab-case slug when none of those fit.`,
          },
          name: {
            type: "string",
            description: "The component/item name exactly as the manual phrases it.",
          },
          action: {
            type: "string",
            enum: [...ScheduleItemActions],
            description: "The primary action the manual prescribes at the regular interval. Use \"other\" only when none fit.",
          },
          intervalKm: {
            type: ["number", "null"],
            description: "Regular service interval in kilometers. Convert miles to kilometers (1 mi = 1.609 km, round sensibly). null if the manual gives no distance interval.",
          },
          intervalMonths: {
            type: ["number", "null"],
            description: "Regular service interval in months (convert years to months). null if the manual gives no time interval.",
          },
          firstAtKm: {
            type: ["number", "null"],
            description: "One-time break-in/first-service distance in kilometers, if the table lists an initial service different from the regular interval. Otherwise null.",
          },
          notes: {
            type: ["string", "null"],
            description: "The manual's original phrasing: original units/figures, conditions (\"more often in dusty conditions\"), and anything that didn't fit the structured fields. null if nothing to add.",
          },
        },
        required: ["key", "name", "action", "intervalKm", "intervalMonths", "firstAtKm", "notes"],
        additionalProperties: false,
      },
    },
  },
  required: ["schedule_table_found", "items"],
  additionalProperties: false,
};

const SCHEDULE_PROMPT = `You are a strict transcriber extracting the PERIODIC MAINTENANCE schedule from a vehicle owner's manual. You only report maintenance items and intervals actually printed in the document — never estimate, infer from general knowledge, or invent a plausible schedule.

First decide: does the document contain an actual periodic maintenance schedule table (or an equivalent structured list of components with service intervals)? Set schedule_table_found accordingly. If it is false, items MUST be an empty array — an empty result is the correct, expected answer for a document without a schedule; a fabricated schedule is the worst possible answer.

If a schedule table is found: produce one item per table row/component. Ignore marketing copy, prose chapters, and troubleshooting sections — only the maintenance table(s) count. For each item:
- key: a canonical kebab-case component key. STRONGLY prefer one of: ${CANONICAL_COMPONENT_KEYS.join(", ")}. Only mint a new kebab-case slug when none of those fit.
- name: the component name exactly as the manual phrases it.
- action: the primary prescribed action (replace, inspect, adjust, lubricate, clean, or other).
- intervalKm / intervalMonths: the REGULAR interval, normalized to kilometers and months. Convert miles to kilometers (1 mi = 1.609 km, rounding to a sensible figure) and years to months. Use null when the manual gives no distance or no time interval for the item.
- firstAtKm: the one-time initial/break-in service distance in kilometers when the table lists one distinct from the regular interval, otherwise null.
- notes: preserve the manual's original phrasing — the original units and figures, plus conditions like "more often in dusty conditions". null if there is nothing beyond the structured fields.`;

// server-side companion to the prompt's key guidance (strict mode can't enforce the
// vocabulary): lowercase kebab-case slug of whatever came back
function slugifyKey(value: string): string {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

// null → undefined (dropped from JSON), non-positive/non-numeric intervals dropped
function asPositiveNumber(value: unknown): number | undefined {
  return typeof value == "number" && isFinite(value) && value > 0 ? value : undefined;
}

export function normalizeItems(extracted: ExtractedSchedule): ScheduleItem[] {
  if (!extracted.schedule_table_found) return [];

  return (extracted.items || [])
    .filter((item) => (item.key || item.name)?.trim())
    .map((item) => {
      const action = (ScheduleItemActions as readonly string[]).includes(item.action) ? item.action : "other";
      const notes = typeof item.notes == "string" && item.notes.trim() ? item.notes.trim() : undefined;
      return {
        key: slugifyKey(item.key?.trim() || item.name),
        name: item.name?.trim() || item.key,
        action,
        intervalKm: asPositiveNumber(item.intervalKm),
        intervalMonths: asPositiveNumber(item.intervalMonths),
        firstAtKm: asPositiveNumber(item.firstAtKm),
        notes,
      };
    });
}

// Fetches the manual's file, runs the extraction, and creates the *proposed*
// MaintenanceSchedule (source "manual"); returns undefined when the gate says the
// document contains no schedule (no empty-noise record is created — the route surfaces
// "no schedule found" instead). Confirmation is a separate, human step
// (services/schedules.ts's confirmSchedule).
export async function extractSchedule(document: Document, by: SessionUser): Promise<MaintenanceSchedule | undefined> {
  console.log("services.schedule-extraction.extractSchedule", { documentId: document.id });

  const attachment = await getAttachment(document.attachmentId);
  if (!attachment) {
    throw new Error(`attachment ${document.attachmentId} not found`);
  }

  // Node fetch handles both real blob URLs and the data: URLs BLOB_MOCK fixtures use
  // (same as services/documents.ts's extractPages)
  const res = await fetch(attachment.url);
  if (!res.ok) {
    throw new Error(`fetching attachment failed (${res.status})`);
  }
  const buffer = new Uint8Array(await res.arrayBuffer());

  const extracted = await extractFromFile<ExtractedSchedule>({
    buffer,
    filename: attachment.filename || "manual.pdf",
    prompt: SCHEDULE_PROMPT,
    schemaName: "manualSchedule",
    schema: scheduleSchema,
  });

  const items = normalizeItems(extracted);

  if (!items.length) {
    console.log("services.schedule-extraction.extractSchedule: no schedule found", { documentId: document.id, gate: extracted.schedule_table_found });
    return undefined;
  }

  return saveSchedule({
    userId: document.userId,
    vehicleId: document.vehicleId,
    documentId: document.id,
    source: "manual",
    status: "proposed",
    items,
  }, by);
}
