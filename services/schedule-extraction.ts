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
// exported for docs/prompt-evals/schedule-extraction-eval.ts (model-comparison runs
// need the real schema, not just the real prompt)
export const scheduleSchema = {
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
            description: "The component/item name exactly as the manual phrases it, taken from the SAME table row as this item's marks/intervals.",
          },
          action: {
            type: "string",
            enum: [...ScheduleItemActions],
            description: "The primary action the manual prescribes at the regular interval. Use \"other\" only when none fit.",
          },
          intervalKm: {
            type: ["number", "null"],
            description: "REGULAR service interval in kilometers, fully decoded: if the table's distance columns use a multiplier header (e.g. \"× 1,000 km\" over columns 1|12|24|36|48), multiply — a mark under \"24\" means 24000. The regular interval is the SPACING of the row's repeating marks, not the first marked column. Convert miles to kilometers (1 mi = 1.609 km, round sensibly). null if the manual gives no distance interval for this item.",
          },
          intervalMonths: {
            type: ["number", "null"],
            description: "Regular service interval in months, ONLY from an explicit time column or period: 12 if the row is marked in an annual/yearly-check column (common — many rows correctly have both intervalKm and 12 here); \"Regular Replace\" periods like \"2 years\" → 24, \"3 years\" → 36. NEVER derive months from the distance interval alone. null when the manual prints no time interval for this row.",
          },
          firstAtKm: {
            type: ["number", "null"],
            description: "One-time break-in/initial-service distance in kilometers — a mark in the small first distance column (e.g. the \"1\" = 1,000 km column) that is NOT part of the row's repeating pattern. Only rows whose cells actually mark that column get a value. Otherwise null.",
          },
          notes: {
            type: ["string", "null"],
            description: "The manual's original phrasing: original units/figures (\"2 years\"), footnote conditions (\"more often in dusty conditions\"), secondary actions that didn't fit the structured fields. NOT page cross-references. null if nothing to add.",
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

// Prompt tuned against a real owner's manual (S10b, Honda CB500X, ~150 pages): the big
// wins over the naive v1 were teaching the grid layout explicitly — multiplier headers
// (× 1,000 km), the icon legend printed below the table, the *1 repeat rule (regular
// interval = spacing of the repeating marks), the break-in column → firstAtKm, Annual
// Check → 12 months, Regular Replace periods → months — plus component-free worked
// examples of the decode and same-row key/name pairing. Two phrasings that BACKFIRED
// during tuning (don't reintroduce them): cautionary "never guess / verify each row
// individually" wording made the model abstain and drop half the rows, and naming the
// anti-pattern as "months = km ÷ 1,000" also matched the legitimate 12,000 km + 12 mo
// annual rows and suppressed their months. A third backfire lives in services/ai.ts:
// temperature 0 on extractFromFile collapsed the decode entirely (22/26 → 4/26) — the
// run-to-run variance is real but greedy decoding is worse, so the sampling default
// stays. Guidance stays generic ("tables like Honda's use…") so simpler list-style
// manuals still extract fine.
//
// A FOURTH negative result (S10c): appending vehicle identity ("this is the manual for
// a 2019 Honda CB500X") plus a Honda-specific layout hint block MEASURABLY DEGRADED the
// decode — km-interval accuracy fell from ~18-22/26 (plain prompt, incl. a same-day
// control run) to 4-9/26, whether the context was appended after the prompt or
// injected mid-prompt, with a systematic every-column→24000 misread. The Honda grid
// knowledge this prompt teaches generically is the right amount of it; do not add
// maker-conditional or vehicle-identity context here without beating the plain prompt
// across multiple runs of docs/prompt-evals/schedule-extraction-eval.ts.
//
// Exported ONLY for that eval harness (--prompt shipped scores exactly this text);
// production callers go through extractSchedule().
export const SCHEDULE_PROMPT = `You are a strict transcriber extracting the PERIODIC MAINTENANCE schedule from a vehicle owner's manual. You only report maintenance items and intervals actually printed in the document — never estimate, infer from general knowledge, or invent a plausible schedule.

First decide: does the document contain an actual periodic maintenance schedule table (or an equivalent structured list of components with service intervals)? Set schedule_table_found accordingly. If it is false, items MUST be an empty array — an empty result is the correct, expected answer for a document without a schedule; a fabricated schedule is the worst possible answer.

HOW TO READ GRID-STYLE SCHEDULE TABLES (the common motorcycle-manual layout: item rows × odometer columns, with single-letter marks in the cells):
1. MULTIPLIER HEADERS: the distance columns are usually labeled with a multiplier, e.g. "× 1,000 km" over column labels 1 | 12 | 24 | 36 | 48 — those columns mean 1,000 / 12,000 / 24,000 / 36,000 / 48,000 km. Always multiply the column label by the header's multiplier. When the header shows BOTH a "× 1,000 km" row and a "× 1,000 mi" row, they are the SAME checkpoints in two units — take intervalKm from the km row only; never put a miles figure into intervalKm.
2. CELL MARKS AND THE LEGEND: cells contain letter codes defined in a legend printed near the table, often BELOW it or in a note — typically I = inspect (and clean, adjust, lubricate, or replace if necessary), R = replace, C = clean, L = lubricate, A = adjust. Read the legend the manual actually prints and decode each row's own marks — adjacent rows often differ (e.g. an R row between I rows); never copy a neighbouring row's pattern.
3. THE REPEAT RULE: manuals state (in a note such as "at higher odometer readings, repeat at the frequency interval established here") that each row's mark pattern repeats, so the REGULAR interval is the SPACING between the row's repeating marks. Count the marked distance columns for the row: marks in EVERY main column (e.g. 12, 24, 36, 48 ×1,000 km) → interval = the column spacing (12,000 km); marks in every SECOND column (only 24 and 48) → 24,000 km; a note printed in the row itself like "every 1,000 km" → that value.
4. BREAK-IN COLUMN: a mark in the small first distance column (e.g. "1" = 1,000 km) is the one-time initial/break-in service → firstAtKm; the regular interval still comes from the remaining repeating marks. Only the few rows whose cells ACTUALLY mark that column get firstAtKm — typically engine oil and its filter. Do NOT copy a break-in figure onto other rows; leave firstAtKm null unless that row's own break-in cell is marked.
5. TIME INTERVALS come ONLY from explicit time columns or printed periods: a mark in an "Annual Check" / "every year" column → intervalMonths 12; a "Regular Replace" column period like "2 years" → 24, "3 years" → 36. Check the Annual Check cell for EVERY row and set intervalMonths 12 whenever it is marked — in many grid schedules most of the inspection rows carry it, so a row with BOTH intervalKm 12000 and intervalMonths 12 is a normal, common result. NEVER derive intervalMonths from the distance interval alone — a row marked only in distance columns has intervalMonths null even at 24,000 or 36,000 km. As a rule of thumb, rows marked in the Annual Check column usually carry the every-column (shortest) distance pattern, while every-second-column rows usually have no annual mark.
6. REGULAR REPLACE: when a row has a Regular Replace period AND periodic inspection marks (brake fluid, coolant are classic cases), report the replacement as the item's action with intervalMonths from the period, and put the inspection interval and the original wording ("2 years") in notes.
7. PRE-RIDE COLUMN: a "Pre-ride check" mark is NOT a service interval. Rows whose only marks are pre-ride get intervalKm and intervalMonths null (or may be omitted). NEVER invent a numeric interval for them.
8. FOOTNOTES: row markers like *1, *2, *3 resolve to notes printed after the table — sometimes at the bottom of the page, sometimes on the NEXT page. Look them up and fold the condition into notes (e.g. "service more often when riding in unusually wet or dusty areas").

Worked examples of the decode (illustrative layout only — always read the actual rows):
- A row marked R under 24 and 48 only, no annual mark → action "replace", intervalKm 24000, intervalMonths null.
- A row marked I under 12, 24, 36 and 48, plus a mark in Annual Check → action "inspect", intervalKm 12000, intervalMonths 12.
- A row marked R under 1 and under 12/24/36/48, plus Annual Check → action "replace", intervalKm 12000, intervalMonths 12, firstAtKm 1000.
- A row with only a Pre-ride Check mark → intervalKm null, intervalMonths null, firstAtKm null.

TRANSCRIBE ROW BY ROW, in the table's own order, one item per printed row. Schedule tables often span two or more pages — include every continuation row, and after transcribing re-scan the table for rows you skipped (typical motorcycle schedules have 25–35 rows); every printed row must appear exactly once. key and name MUST come from the SAME row; double-check alignment on the last rows, where drift is easy. Ignore marketing copy, prose chapters, and troubleshooting sections — only the maintenance table(s) count.

For each item:
- key: a canonical kebab-case component key. STRONGLY prefer one of: ${CANONICAL_COMPONENT_KEYS.join(", ")}. Only mint a new kebab-case slug when none of those fit — and mint it from THIS row's own name (name "Drive Chain Slider" → key "chain-slider"). Never reuse the previous row's key or a canonical key that names a different component (key "lights" with name "Headlight Aim" is wrong).
- name: the component name exactly as that row of the manual phrases it.
- action: the primary prescribed action (replace, inspect, adjust, lubricate, clean, or other), decoded from the row's own marks via the table's legend.
- intervalKm / intervalMonths: the REGULAR interval decoded per the rules above, normalized to kilometers and months. Convert miles to kilometers (1 mi = 1.609 km, rounding to a sensible figure) and years to months. Use null when the manual gives no distance or no time interval for the item.
- firstAtKm: the one-time initial/break-in service distance in kilometers (rule 4), otherwise null.
- notes: the manual's original phrasing that didn't fit the structured fields — footnote conditions ("more often in dusty conditions", "ED, KO types only"), original period wording ("2 years"), secondary actions ("inspect every 12,000 km"). Do NOT use notes for page cross-references like "Refer to page 55". null if there is nothing to add.`;

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
    // per-feature model choice, chosen after a real-manual eval comparison
    // (docs/prompt-evals/schedule-extraction-eval.ts --model gpt-5.6-sol --reasoning medium):
    // reading a scanned maintenance grid benefits from real deliberation
    model: "gpt-5.6-sol",
    reasoningEffort: "medium",
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
