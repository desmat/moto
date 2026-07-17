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
  mileage: number | null,
  totalCost: number | null,
  items: ExtractedReceiptItem[],
};

// what the route returns to the dialog: null→undefined, keys slugified, junk dropped
export type ReceiptReading = {
  receipt_clearly_visible: boolean,
  date?: string,        // YYYYMMDD
  vendor?: string,
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
    mileage: {
      type: ["number", "null"],
      description: "The vehicle's odometer reading IF it is printed on the receipt (shops often print it). Only a value actually printed — NEVER inferred or estimated. null when the receipt shows no odometer reading.",
    },
    totalCost: {
      type: ["number", "null"],
      description: "The receipt's grand total as printed (taxes and fees included). null if not printed or illegible.",
    },
    items: {
      type: "array",
      description: "One entry per service/parts line printed on the receipt. MUST be empty when receipt_clearly_visible is false.",
      items: {
        type: "object",
        properties: {
          key: {
            type: "string",
            description: `Canonical kebab-case component key. STRONGLY prefer one of: ${CANONICAL_COMPONENT_KEYS.join(", ")}. Only mint a new kebab-case slug when none of those fit.`,
          },
          name: {
            type: "string",
            description: "The line item's component/service name as the receipt phrases it.",
          },
          action: {
            type: "string",
            enum: [...ReceiptItemActions],
            description: "What was done to the component on this line. Use \"other\" only when none fit.",
          },
          note: {
            type: ["string", "null"],
            description: "Brand/part/detail printed on the line that didn't fit the structured fields (e.g. \"Michelin Anakee Adventure\" for a tire line, part numbers, grades). null if nothing to add.",
          },
          cost: {
            type: ["number", "null"],
            description: "This line's printed price. null when the receipt shows no per-line price.",
          },
        },
        required: ["key", "name", "action", "note", "cost"],
        additionalProperties: false,
      },
    },
  },
  required: ["receipt_clearly_visible", "date", "vendor", "mileage", "totalCost", "items"],
  additionalProperties: false,
};

const RECEIPT_PROMPT = `You are a strict transcriber reading a vehicle service receipt or invoice from one or more photos. When there are multiple photos, they are pages of the SAME single invoice, in order — read them together as one document (line items may span pages; the totals and vehicle details are often on the first or last page). Produce ONE combined result covering every page; never treat pages as separate invoices. You only report information actually printed on the receipt — never estimate, infer, or invent plausible values.

First decide: do the photos show a legible receipt or invoice whose printed text you can actually read? Set receipt_clearly_visible accordingly (true if the document is readable overall, even if a page is poor). If it is false, every other field MUST be null and items MUST be an empty array — an empty result is the correct, expected answer for unreadable or irrelevant photos; a fabricated invoice is the worst possible answer.

If the receipt is legible:
- date: the service/invoice date, converted from whatever format is printed to YYYYMMDD.
- vendor: the shop or vendor name as printed.
- mileage: the vehicle's odometer reading ONLY if it is printed on the receipt (shops often print it near the vehicle details). Never infer one.
- totalCost: the grand total as printed, taxes and fees included.
- items: one entry per service or parts line. Do NOT emit line items for taxes, fees, or shop-supplies/consumables surcharge lines — those belong only in the grand total. Put brand/part detail in note (a "Front tire — Michelin Anakee Adventure" line gets name "Front tire" and note "Michelin Anakee Adventure"). For key, STRONGLY prefer one of: ${CANONICAL_COMPONENT_KEYS.join(", ")}; only mint a new kebab-case slug when none of those fit. action is what was done on that line (replace, inspect, adjust, lubricate, clean, or other). cost is that line's printed price, null when no per-line price is shown.`;

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
    // comparison says otherwise
  });

  return normalizeReceipt(extracted);
}
