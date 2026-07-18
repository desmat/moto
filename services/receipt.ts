import { extractFromImage } from "./ai";
import { LogItem } from "@/types/Log";
import { CANONICAL_COMPONENT_KEYS } from "@/types/MaintenanceSchedule";

// Receipt extraction (S11): the domain type, JSON schema, prompt, and normalization
// live here in the service layer, mirroring services/odometer.ts;
// app/api/ai/receipt/route.ts is just the HTTP shell around readReceipt().

const ReceiptItemActions = ["replace", "inspect", "adjust", "lubricate", "clean", "other"] as const;

// the model's raw output shape (snake_case gate + null-able fields per strict mode);
// normalizeReceipt() turns it into the ReceiptReading callers consume
type ExtractedReceiptItem = {
  key: string,
  name: string,
  action: "replace" | "inspect" | "adjust" | "lubricate" | "clean" | "other",
  note: string | null,
  cost: number | null,
};

type ExtractedReceipt = {
  receipt_clearly_visible: boolean,
  date: string | null,
  vendor: string | null,
  vehicle: string | null,
  mileage: number | null,
  totalCost: number | null,
  items: ExtractedReceiptItem[],
};

// what the route returns to the dialog: null→undefined, keys slugified, junk dropped
export type ReceiptReading = {
  receipt_clearly_visible: boolean,
  date?: string,        // YYYYMMDD
  vendor?: string,
  vehicle?: string,     // the vehicle description as printed (year/make/model/plate)
  mileage?: number,
  totalCost?: number,
  items: LogItem[],
};

// Strict-mode shape (every property required, additionalProperties: false, nullability
// via type arrays). The boolean gate comes FIRST on purpose — the repo's mandatory
// anti-hallucination convention (see services/odometer.ts's S6 note): forcing the model
// to commit to "can I actually read this receipt?" before emitting fields is what stops
// it from fabricating a plausible invoice for an unreadable/irrelevant photo.
//
// `key` is a plain string, not an enum: strict mode forbids a dynamic vocabulary as an
// enum without freezing it, so CANONICAL_COMPONENT_KEYS is prompt guidance plus
// server-side slugify (normalizeReceipt below) — same approach as
// services/schedule-extraction.ts.
const receiptSchema = {
  type: "object",
  properties: {
    receipt_clearly_visible: {
      type: "boolean",
      description: "true ONLY if the image is a legible service receipt or invoice whose printed text you can actually read. false for anything else — not a receipt, blur, glare, too dark, cropped beyond legibility.",
    },
    date: {
      type: ["string", "null"],
      description: "The service/invoice date printed on the receipt, converted to YYYYMMDD (e.g. \"Mar 15, 2026\" or \"15/03/2026\" → \"20260315\"). null if no date is printed or it is illegible.",
    },
    vendor: {
      type: ["string", "null"],
      description: "The shop/vendor name as printed on the receipt. null if not printed or illegible.",
    },
    vehicle: {
      type: ["string", "null"],
      description: "The vehicle description printed on the receipt (shops usually print year/make/model, sometimes plate or VIN, near the customer/vehicle details — e.g. \"2021 HONDA CB500X\"). Exactly as printed. null when no vehicle is identified on the receipt.",
    },
    mileage: {
      type: ["number", "null"],
      description: "The vehicle's odometer reading IF it is printed on the receipt (shops often print it as 'KM OUT' / 'mileage out' / odometer near the vehicle details — prefer the OUT value when in/out are both shown). Transcribe the digits carefully, including thousands separators (\"37,947\" → 37947). Only a value actually printed — NEVER inferred or estimated. null when the receipt shows no odometer reading.",
    },
    totalCost: {
      type: ["number", "null"],
      description: "The receipt's grand total as printed (taxes and fees included). null if not printed or illegible.",
    },
    items: {
      type: "array",
      description: "One entry per COMPONENT the shop actually serviced — synthesized from the receipt's lines, NOT a line-by-line transcription. MUST be empty when receipt_clearly_visible is false.",
      items: {
        type: "object",
        properties: {
          key: {
            type: "string",
            description: `Canonical kebab-case component key. STRONGLY prefer one of: ${CANONICAL_COMPONENT_KEYS.join(", ")}. Only mint a new kebab-case slug when none of those fit.`,
          },
          name: {
            type: "string",
            description: "Short, clean component name in English, capitalized like a sentence — \"Front tire\", \"Engine oil & filter\", \"Drive chain & sprockets\" — NOT the receipt's raw line text, part numbers, or all-caps phrasing.",
          },
          action: {
            type: "string",
            enum: [...ReceiptItemActions],
            description: "What was done to the component. Use \"other\" only when none fit.",
          },
          note: {
            type: ["string", "null"],
            description: "Brand/spec detail worth keeping, cleaned up (e.g. \"Michelin Anakee Wild 90/90-21 54R\", \"GN4 10W-30\"). null if nothing meaningful to add.",
          },
          cost: {
            type: ["number", "null"],
            description: "The printed total for this component's work — when the receipt groups a job (labor + part + consumables), the group's printed total; otherwise the line price. null when no usable printed figure exists for it.",
          },
        },
        required: ["key", "name", "action", "note", "cost"],
        additionalProperties: false,
      },
    },
  },
  required: ["receipt_clearly_visible", "date", "vendor", "vehicle", "mileage", "totalCost", "items"],
  additionalProperties: false,
};

const RECEIPT_PROMPT = `You are a strict transcriber reading a vehicle service receipt or invoice from one or more photos. When there are multiple photos, they are pages of the SAME single invoice, in order — read them together as one document (line items may span pages; the totals and vehicle details are often on the first or last page). Produce ONE combined result covering every page; never treat pages as separate invoices. You only report information actually printed on the receipt — never estimate, infer, or invent plausible values.

First decide: do the photos show a legible receipt or invoice whose printed text you can actually read? Set receipt_clearly_visible accordingly (true if the document is readable overall, even if a page is poor). If it is false, every other field MUST be null and items MUST be an empty array — an empty result is the correct, expected answer for unreadable or irrelevant photos; a fabricated invoice is the worst possible answer.

If the receipt is legible:
- date: the service/invoice date, converted from whatever format is printed to YYYYMMDD.
- vendor: the shop or vendor name as printed.
- vehicle: the vehicle description printed near the customer/vehicle details (year, make, model, sometimes plate or VIN), exactly as printed. null when the receipt identifies no vehicle.
- mileage: the vehicle's odometer reading ONLY if it is printed on the receipt (near the vehicle details; when the shop prints mileage IN and OUT, use OUT). Transcribe the digits carefully — "37,947 Km" is 37947. Never infer one.
- totalCost: the grand total as printed, taxes and fees included.
- items: SYNTHESIZE the maintenance actually performed, one entry per component serviced — do NOT transcribe invoice lines one-for-one. Shop invoices scatter one job across several lines (labor, the part, consumables, taxes-per-part); fold them into a single item per component. A front-tire change billed as install labor + the tire + tire tax + wheel weights is ONE item: key "front-tire", name "Front tire", action "replace", note with the tire's brand/size (e.g. "Michelin Anakee Wild 90/90-21 54R"), cost = that job's printed group total (or the sum of its printed lines). Engine oil and the oil filter are SEPARATE components: an oil change billed as oil + filter + drain gasket + labor becomes an "engine-oil" item (name "Engine oil", the oil's brand/grade in note) AND an "oil-filter" item (name "Oil filter") — split the job's cost sensibly when the parts are priced separately, else put the group total on "engine-oil" and leave the filter's cost null.
  Real one-off repair jobs DO become items even when they don't map to a maintenance component — a windshield repair or securing a loose dashboard is an item (mint a slug like "windshield" or "dashboard", action "other", name describing the fix, cost = that job's printed total including its labor and hardware).
  OMIT entirely: taxes, environmental/recycling fees, shop supplies, deposits, administrative lines, and hardware/labor lines that belong inside some job's grouped total.
  Tune-up/scheduled-service checklists: inspections of REAL serviceable components keep their own "inspect" items — battery/charging system, brakes, coolant/anti-freeze level, steering bearings, suspension, air filter, tire pressure-and-condition (fold pressure checks into the tire items only when the tires were also replaced). Fold only the generic lines into the service's umbrella item (key "general-service", name like "44,000 km tune-up"): fastener/clip checks, general lubrication, visual/safety inspection, idle check, road test. A component actually REPLACED inside a package deal (its parts appear on the invoice — oil, a filter element, a spark plug) always keeps its own item, even when the package price covers the labor.
  The drive chain and the sprockets are SEPARATE components: a chain-and-sprockets job becomes a "chain" item (chain spec in note) and a "sprockets" item (front/rear teeth in note), each with its own printed part cost.
  name: short clean English ("Front tire", "Clutch plates & springs"), never the receipt's raw all-caps text or part numbers — translate French receipts. note: cleaned-up brand/spec detail worth keeping, null otherwise. For key, STRONGLY prefer one of: ${CANONICAL_COMPONENT_KEYS.join(", ")}; only mint a new kebab-case slug when none of those fit. action is what was done (replace, inspect, adjust, lubricate, clean, or other).`;

// server-side companion to the prompt's key guidance (strict mode can't enforce the
// vocabulary): lowercase kebab-case slug of whatever came back — same helper pattern as
// services/schedule-extraction.ts
function slugifyKey(value: string): string {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

function asFiniteNumber(value: unknown): number | undefined {
  return typeof value == "number" && isFinite(value) ? value : undefined;
}

function asTrimmedString(value: unknown): string | undefined {
  return typeof value == "string" && value.trim() ? value.trim() : undefined;
}

// null → undefined (dropped from JSON), keys slugified, empty-name rows dropped
export function normalizeReceipt(extracted: ExtractedReceipt): ReceiptReading {
  if (!extracted.receipt_clearly_visible) {
    return { receipt_clearly_visible: false, items: [] };
  }

  const items: LogItem[] = (extracted.items || [])
    .filter((item) => (item.key || item.name)?.trim())
    .map((item) => ({
      key: slugifyKey(item.key?.trim() || item.name),
      name: item.name?.trim() || item.key,
      action: (ReceiptItemActions as readonly string[]).includes(item.action) ? item.action : "other",
      ...asTrimmedString(item.note) && { note: asTrimmedString(item.note) },
      ...asFiniteNumber(item.cost) != undefined && { cost: asFiniteNumber(item.cost) },
    }));

  return {
    receipt_clearly_visible: true,
    ...asTrimmedString(extracted.date) && { date: asTrimmedString(extracted.date) },
    ...asTrimmedString(extracted.vendor) && { vendor: asTrimmedString(extracted.vendor) },
    ...asTrimmedString(extracted.vehicle) && { vehicle: asTrimmedString(extracted.vehicle) },
    ...asFiniteNumber(extracted.mileage) != undefined && { mileage: asFiniteNumber(extracted.mileage) },
    ...asFiniteNumber(extracted.totalCost) != undefined && { totalCost: asFiniteNumber(extracted.totalCost) },
    items,
  };
}

// one receipt may span several photos (page per pic — S11b); all images go to the
// model in one call, in the order given (the dialog preserves pick order)
export async function readReceipt(imageUrls: string[]): Promise<ReceiptReading> {
  console.log("services.receipt.readReceipt", { imageCount: imageUrls.length });

  const extracted = await extractFromImage<ExtractedReceipt>({
    imageUrls,
    prompt: RECEIPT_PROMPT,
    schemaName: "receipt",
    schema: receiptSchema,
    // no model override on purpose: the default (MODELS.vision) until a real-key
    // comparison says otherwise. Low reasoning effort helps the synthesis step
    // (grouping invoice lines into per-component work) and digit transcription.
    reasoningEffort: "low",
  });

  return normalizeReceipt(extracted);
}
