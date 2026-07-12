// Schedule-extraction prompt eval (S10b) — regression harness for
// services/schedule-extraction.ts's SCHEDULE_PROMPT, graded against the CB500X manual
// (ground truth: ./cb500x-schedule-ground-truth.md). Rerun this whenever that prompt
// (or extractFromFile's parameters — see the temperature-0 warning there) is touched.
//
// The manual PDF is deliberately NOT committed (4.8MB, Honda's copyright): download it
// from the user's Blob store (pathname contains "CB500X") or ask the user, then run
// from the repo root:
//   MANUAL_PDF=/path/to/CB500X-manual.pdf AI_MOCK=false \
//     npx tsx --tsconfig tsconfig.json docs/prompt-evals/schedule-extraction-eval.ts --prompt shipped
// (`--prompt shipped` = the service's SCHEDULE_PROMPT + scheduleSchema exactly as
// production sends them; v1–v8 are the frozen tuning-history candidates.
// Add `--model <id>` to compare a different chat-completions model against the shipped
// prompt (defaults to whatever extractFromFile defaults to, currently gpt-4o — only
// meaningful with `--prompt shipped`, since only that path uses the real schema/prompt).
// Each REAL run reads the whole manual — ~$0.25,
// 1-2 min. Raw results save to runs/ beside the PDF (filename includes the model); re-
// score a cached run free with `--from <path>.json`.) One run is a weak signal: ±3-5
// rows of run-to-run variance is normal at the default temperature (and temperature 0 is
// WORSE — see services/ai.ts); prefer 2-3 runs when comparing. History: v1 (naive) 7/26
// interval decode, v8/shipped on gpt-4o 18-22/26 across runs.
import fs from "fs";
import path from "path";

const REPO = process.cwd(); // run from the repo root
const PDF = process.env.MANUAL_PDF || "";
const SCRATCH = PDF ? path.dirname(PDF) : REPO;

// ---------------------------------------------------------------------------
// Candidate schemas: same STRUCTURE as the shipped scheduleSchema (routes/specs
// depend on it), only `description` strings vary per candidate.
// ---------------------------------------------------------------------------
type Desc = {
  gate: string; items: string; key: string; name: string; action: string;
  intervalKm: string; intervalMonths: string; firstAtKm: string; notes: string;
};

function makeSchema(d: Desc, canonicalKeys: string[], actions: readonly string[]) {
  return {
    type: "object",
    properties: {
      schedule_table_found: { type: "boolean", description: d.gate },
      items: {
        type: "array",
        description: d.items,
        items: {
          type: "object",
          properties: {
            key: { type: "string", description: d.key.replace("{KEYS}", canonicalKeys.join(", ")) },
            name: { type: "string", description: d.name },
            action: { type: "string", enum: [...actions], description: d.action },
            intervalKm: { type: ["number", "null"], description: d.intervalKm },
            intervalMonths: { type: ["number", "null"], description: d.intervalMonths },
            firstAtKm: { type: ["number", "null"], description: d.firstAtKm },
            notes: { type: ["string", "null"], description: d.notes },
          },
          required: ["key", "name", "action", "intervalKm", "intervalMonths", "firstAtKm", "notes"],
          additionalProperties: false,
        },
      },
    },
    required: ["schedule_table_found", "items"],
    additionalProperties: false,
  };
}

// v1 = shipped descriptions (baseline)
const DESC_V1: Desc = {
  gate: "true ONLY if the document contains an actual periodic maintenance schedule table (or equivalent structured interval list) whose rows you can read. false for anything else — marketing pages, prose-only documents, unreadable scans.",
  items: "One entry per maintenance-table row/component. MUST be empty when schedule_table_found is false.",
  key: "Canonical kebab-case component key. STRONGLY prefer one of: {KEYS}. Only mint a new kebab-case slug when none of those fit.",
  name: "The component/item name exactly as the manual phrases it.",
  action: "The primary action the manual prescribes at the regular interval. Use \"other\" only when none fit.",
  intervalKm: "Regular service interval in kilometers. Convert miles to kilometers (1 mi = 1.609 km, round sensibly). null if the manual gives no distance interval.",
  intervalMonths: "Regular service interval in months (convert years to months). null if the manual gives no time interval.",
  firstAtKm: "One-time break-in/first-service distance in kilometers, if the table lists an initial service different from the regular interval. Otherwise null.",
  notes: "The manual's original phrasing: original units/figures, conditions (\"more often in dusty conditions\"), and anything that didn't fit the structured fields. null if nothing to add.",
};

// v2 = grid-aware descriptions
const DESC_V2: Desc = {
  ...DESC_V1,
  name: "The component/item name exactly as the manual phrases it, taken from the SAME table row as this item's icons/intervals.",
  intervalKm: "REGULAR service interval in kilometers, fully decoded: if the table's distance columns use a multiplier header (e.g. \"× 1,000 km\" over columns 1|12|24|36|48), multiply — a mark under \"24\" means 24000. The regular interval is the SPACING of the row's repeating marks, not the first marked column. Convert miles to kilometers (1 mi = 1.609 km, round sensibly). null if the manual gives no distance interval for this item.",
  intervalMonths: "Regular service interval in months: 12 if the row is marked in an annual/yearly-check column; from \"Regular Replace\" periods like \"2 years\" → 24, \"3 years\" → 36. null if the manual gives no time interval.",
  firstAtKm: "One-time break-in/initial-service distance in kilometers — a mark in the small first distance column (e.g. the \"1\" = 1,000 km column) that is NOT part of the row's repeating pattern. Only rows whose cells actually mark that column get a value. Otherwise null.",
};

// ---------------------------------------------------------------------------
// Candidate prompts
// ---------------------------------------------------------------------------
// v1 = shipped prompt (baseline). {KEYS} interpolated at run time.
const PROMPT_V1 = `You are a strict transcriber extracting the PERIODIC MAINTENANCE schedule from a vehicle owner's manual. You only report maintenance items and intervals actually printed in the document — never estimate, infer from general knowledge, or invent a plausible schedule.

First decide: does the document contain an actual periodic maintenance schedule table (or an equivalent structured list of components with service intervals)? Set schedule_table_found accordingly. If it is false, items MUST be an empty array — an empty result is the correct, expected answer for a document without a schedule; a fabricated schedule is the worst possible answer.

If a schedule table is found: produce one item per table row/component. Ignore marketing copy, prose chapters, and troubleshooting sections — only the maintenance table(s) count. For each item:
- key: a canonical kebab-case component key. STRONGLY prefer one of: {KEYS}. Only mint a new kebab-case slug when none of those fit.
- name: the component name exactly as the manual phrases it.
- action: the primary prescribed action (replace, inspect, adjust, lubricate, clean, or other).
- intervalKm / intervalMonths: the REGULAR interval, normalized to kilometers and months. Convert miles to kilometers (1 mi = 1.609 km, rounding to a sensible figure) and years to months. Use null when the manual gives no distance or no time interval for the item.
- firstAtKm: the one-time initial/break-in service distance in kilometers when the table lists one distinct from the regular interval, otherwise null.
- notes: preserve the manual's original phrasing — the original units and figures, plus conditions like "more often in dusty conditions". null if there is nothing beyond the structured fields.`;

// v2 = teach the grid: multiplier headers, icon legend, repeat rule, break-in column,
// annual-check / regular-replace columns, footnotes after the table, row-by-row
// transcription with key+name from the same row, pre-ride handling.
const PROMPT_V2 = `You are a strict transcriber extracting the PERIODIC MAINTENANCE schedule from a vehicle owner's manual. You only report maintenance items and intervals actually printed in the document — never estimate, infer from general knowledge, or invent a plausible schedule.

First decide: does the document contain an actual periodic maintenance schedule table (or an equivalent structured list of components with service intervals)? Set schedule_table_found accordingly. If it is false, items MUST be an empty array — an empty result is the correct, expected answer for a document without a schedule; a fabricated schedule is the worst possible answer.

HOW TO READ GRID-STYLE SCHEDULE TABLES (the common motorcycle-manual layout: item rows × odometer columns, with single-letter marks in the cells):
1. MULTIPLIER HEADERS: the distance columns are usually labeled with a multiplier, e.g. "× 1,000 km" over column labels 1 | 12 | 24 | 36 | 48 — those columns mean 1,000 / 12,000 / 24,000 / 36,000 / 48,000 km. Always multiply the column label by the header's multiplier; never report the bare column label as the interval. When the header shows BOTH a "× 1,000 km" row and a "× 1,000 mi" row, they are the SAME checkpoints in two units — take intervalKm from the km row only; never put a miles figure (e.g. 8 or 16 ×1,000 mi) into intervalKm.
2. CELL MARKS AND THE LEGEND: cells contain letter codes defined in a legend printed near the table, often BELOW it or in a note — typically I = inspect (and clean, adjust, lubricate, or replace if necessary), R = replace, C = clean, L = lubricate, A = adjust. Read the legend the manual actually prints and map codes to actions from it, per row.
3. THE REPEAT RULE: manuals state (in a note such as "at higher odometer readings, repeat at the frequency interval established here") that each row's mark pattern repeats. The REGULAR interval is therefore the SPACING between the row's repeating marks: marks at 12/24/36/48 (×1,000 km) = every 12,000 km; marks at only 24/48 = every 24,000 km. Decode every row's marks column by column — do not assume neighbouring rows share a pattern.
4. BREAK-IN COLUMN: a mark in the small first distance column (e.g. "1" = 1,000 km) is the one-time initial/break-in service → firstAtKm. The regular interval still comes from the remaining repeating marks. Only the few rows whose cells ACTUALLY mark that column get firstAtKm — typically engine oil and oil filter. Do NOT copy a break-in figure onto other rows just because some rows have one; leave firstAtKm null unless that row's own break-in cell is marked.
5. ANNUAL CHECK: a row marked in an "Annual Check" / "every year" column → intervalMonths 12.
6. REGULAR REPLACE: a "Regular Replace" column with periods like "2 years" or "3 years" → that row's replacement interval in months (24 / 36). If such a row also carries periodic inspection marks, report the replacement as the item's action and interval, and put the inspection interval in notes; preserve the original wording ("2 years") in notes.
7. PRE-RIDE COLUMN: a "Pre-ride check" mark is NOT a service interval. Rows with ONLY a pre-ride mark get intervalKm and intervalMonths null (or may be omitted). NEVER invent a numeric interval for them.
8. FOOTNOTES: row markers like *1, *2, *3 resolve to notes printed after the table — sometimes at the bottom of the page, sometimes on the NEXT page. Look them up and fold the condition into notes (e.g. "service more often when riding in unusually wet or dusty areas").

TRANSCRIBE ROW BY ROW, in the table's own order, one item per row, covering EVERY row of the table (schedule tables often span two or more pages — include the continuation rows). key and name MUST come from the SAME row; double-check the alignment on the last rows of the table, where drift is easy. Ignore marketing copy, prose chapters, and troubleshooting sections — only the maintenance table(s) count.

For each item:
- key: a canonical kebab-case component key. STRONGLY prefer one of: {KEYS}. Only mint a new kebab-case slug when none of those fit.
- name: the component name exactly as that row of the manual phrases it.
- action: the primary prescribed action (replace, inspect, adjust, lubricate, clean, or other), decoded from the row's mark via the table's legend.
- intervalKm / intervalMonths: the REGULAR interval decoded per the rules above, normalized to kilometers and months. Convert miles to kilometers (1 mi = 1.609 km, rounding to a sensible figure) and years to months. Use null when the manual gives no distance or no time interval for the item.
- firstAtKm: the one-time initial/break-in service distance in kilometers (rule 4), otherwise null.
- notes: preserve the manual's original phrasing — the original units and figures ("2 years"), footnote conditions ("more often in dusty conditions"), and anything that didn't fit the structured fields. null if there is nothing beyond the structured fields.`;

// v3 = v2 + explicit canonical patterns, months-only-from-time-columns rule,
// distance+annual coexist, no page-ref notes, stronger row-coverage re-scan.
const PROMPT_V3 = `You are a strict transcriber extracting the PERIODIC MAINTENANCE schedule from a vehicle owner's manual. You only report maintenance items and intervals actually printed in the document — never estimate, infer from general knowledge, or invent a plausible schedule.

First decide: does the document contain an actual periodic maintenance schedule table (or an equivalent structured list of components with service intervals)? Set schedule_table_found accordingly. If it is false, items MUST be an empty array — an empty result is the correct, expected answer for a document without a schedule; a fabricated schedule is the worst possible answer.

HOW TO READ GRID-STYLE SCHEDULE TABLES (the common motorcycle-manual layout: item rows × odometer columns, with single-letter marks in the cells):
1. MULTIPLIER HEADERS: the distance columns are usually labeled with a multiplier, e.g. "× 1,000 km" over column labels 1 | 12 | 24 | 36 | 48 — those columns mean 1,000 / 12,000 / 24,000 / 36,000 / 48,000 km. Always multiply the column label by the header's multiplier. When the header shows BOTH a "× 1,000 km" row and a "× 1,000 mi" row, they are the SAME checkpoints in two units — take intervalKm from the km row only; never put a miles figure into intervalKm.
2. CELL MARKS AND THE LEGEND: cells contain letter codes defined in a legend printed near the table, often BELOW it or in a note — typically I = inspect (and clean, adjust, lubricate, or replace if necessary), R = replace, C = clean, L = lubricate, A = adjust. Read the legend the manual actually prints and decode each row's own marks — adjacent rows often differ (e.g. an R row between I rows); never copy a neighbouring row's pattern.
3. THE REPEAT RULE: manuals state (in a note such as "at higher odometer readings, repeat at the frequency interval established here") that each row's mark pattern repeats, so the REGULAR interval is the SPACING between the row's repeating marks. Count the marked distance columns for the row: marks in EVERY main column (e.g. 12, 24, 36, 48 ×1,000 km) → interval = the column spacing (12,000 km); marks in every SECOND column (only 24 and 48) → 24,000 km; a note printed in the row itself like "every 1,000 km" → that value.
4. BREAK-IN COLUMN: a mark in the small first distance column (e.g. "1" = 1,000 km) is the one-time initial/break-in service → firstAtKm; the regular interval still comes from the remaining repeating marks. Only the few rows whose cells ACTUALLY mark that column get firstAtKm — typically engine oil and its filter. Do NOT copy a break-in figure onto other rows; leave firstAtKm null unless that row's own break-in cell is marked.
5. TIME INTERVALS come ONLY from explicit time columns or printed periods: a mark in an "Annual Check" / "every year" column → intervalMonths 12; a "Regular Replace" column period like "2 years" → 24, "3 years" → 36. NEVER derive intervalMonths from the distance interval — a row marked only in distance columns has intervalMonths null even at 24,000 or 36,000 km. A row CAN have both a distance pattern and an annual-check mark; then report both intervalKm and intervalMonths 12.
6. REGULAR REPLACE: when a row has a Regular Replace period AND periodic inspection marks (brake fluid, coolant are classic cases), report the replacement as the item's action with intervalMonths from the period, and put the inspection interval and the original wording ("2 years") in notes.
7. PRE-RIDE COLUMN: a "Pre-ride check" mark is NOT a service interval. Rows whose only marks are pre-ride get intervalKm and intervalMonths null (or may be omitted). NEVER invent a numeric interval for them.
8. FOOTNOTES: row markers like *1, *2, *3 resolve to notes printed after the table — sometimes at the bottom of the page, sometimes on the NEXT page. Look them up and fold the condition into notes (e.g. "service more often when riding in unusually wet or dusty areas").

TRANSCRIBE ROW BY ROW, in the table's own order, one item per printed row. Schedule tables often span two or more pages — include every continuation row, and after transcribing re-scan the table for rows you skipped (typical motorcycle schedules have 25–35 rows); every printed row must appear exactly once. key and name MUST come from the SAME row; double-check alignment on the last rows, where drift is easy. Ignore marketing copy, prose chapters, and troubleshooting sections — only the maintenance table(s) count.

For each item:
- key: a canonical kebab-case component key. STRONGLY prefer one of: {KEYS}. Only mint a new kebab-case slug when none of those fit.
- name: the component name exactly as that row of the manual phrases it.
- action: the primary prescribed action (replace, inspect, adjust, lubricate, clean, or other), decoded from the row's own marks via the table's legend.
- intervalKm / intervalMonths: the REGULAR interval decoded per the rules above, normalized to kilometers and months. Convert miles to kilometers (1 mi = 1.609 km, rounding to a sensible figure) and years to months. Use null when the manual gives no distance or no time interval for the item.
- firstAtKm: the one-time initial/break-in service distance in kilometers (rule 4), otherwise null.
- notes: the manual's original phrasing that didn't fit the structured fields — footnote conditions ("more often in dusty conditions", "ED, KO types only"), original period wording ("2 years"), secondary actions ("inspect every 12,000 km"). Do NOT use notes for page cross-references like "Refer to page 55". null if there is nothing to add.`;

const DESC_V3: Desc = {
  ...DESC_V2,
  intervalMonths: "Regular service interval in months, ONLY from an explicit time column or period: 12 if the row is marked in an annual/yearly-check column; \"Regular Replace\" periods like \"2 years\" → 24, \"3 years\" → 36. NEVER derive months from the distance interval. null when the manual prints no time interval for this row.",
  notes: "The manual's original phrasing: original units/figures (\"2 years\"), footnote conditions (\"more often in dusty conditions\"), secondary actions that didn't fit the structured fields. NOT page cross-references. null if nothing to add.",
};

// v4 = v3 + marks-are-in-the-image-not-the-text warning, named months=km/1000
// anti-pattern, minority-pattern caution, emit-every-row (incl. pre-ride-only).
const PROMPT_V4 = `You are a strict transcriber extracting the PERIODIC MAINTENANCE schedule from a vehicle owner's manual. You only report maintenance items and intervals actually printed in the document — never estimate, infer from general knowledge, or invent a plausible schedule.

First decide: does the document contain an actual periodic maintenance schedule table (or an equivalent structured list of components with service intervals)? Set schedule_table_found accordingly. If it is false, items MUST be an empty array — an empty result is the correct, expected answer for a document without a schedule; a fabricated schedule is the worst possible answer.

HOW TO READ GRID-STYLE SCHEDULE TABLES (the common motorcycle-manual layout: item rows × odometer columns, with single-letter marks in the cells):
1. READ THE PAGE IMAGE. The cell marks (letters like I/R/C/L and check marks) are usually graphics that do NOT survive in the PDF's text layer — the text alone makes every row look empty and identical. Read each row's marks from the rendered table image, cell by cell; never guess a row's pattern from the text layer or from neighbouring rows.
2. MULTIPLIER HEADERS: the distance columns are usually labeled with a multiplier, e.g. "× 1,000 km" over column labels 1 | 12 | 24 | 36 | 48 — those columns mean 1,000 / 12,000 / 24,000 / 36,000 / 48,000 km. Always multiply the column label by the header's multiplier. When the header shows BOTH a "× 1,000 km" row and a "× 1,000 mi" row, they are the SAME checkpoints in two units — take intervalKm from the km row only; never put a miles figure into intervalKm.
3. CELL MARKS AND THE LEGEND: the letter codes are defined in a legend printed near the table, often BELOW it — typically I = inspect (and clean, adjust, lubricate, or replace if necessary), R = replace, C = clean, L = lubricate, A = adjust. Use the legend the manual actually prints.
4. THE REPEAT RULE: manuals state (in a note such as "at higher odometer readings, repeat at the frequency interval established here") that each row's mark pattern repeats, so the REGULAR interval is the SPACING between the row's repeating marks. Count the marked distance columns for the row: marks in EVERY main column (e.g. 12, 24, 36, 48 ×1,000 km) → interval = the column spacing (12,000 km); marks in every SECOND column (only 24 and 48) → 24,000 km; a note printed in the row itself like "every 1,000 km" → that value. Do NOT blanket-apply the majority pattern: in most schedules a minority of rows (often the air cleaner, spark plugs, valve clearance, oil filter, and emission-system items) are marked only at every second checkpoint and/or with a different letter (R instead of I) — verify each of these rows' cells individually.
5. BREAK-IN COLUMN: a mark in the small first distance column (e.g. "1" = 1,000 km) is the one-time initial/break-in service → firstAtKm; the regular interval still comes from the remaining repeating marks. Only the few rows whose cells ACTUALLY mark that column get firstAtKm — typically engine oil and its filter. Do NOT copy a break-in figure onto other rows; leave firstAtKm null unless that row's own break-in cell is marked.
6. TIME INTERVALS come ONLY from explicit time columns or printed periods: a mark in an "Annual Check" / "every year" column → intervalMonths 12; a "Regular Replace" column period like "2 years" → 24, "3 years" → 36. NEVER derive intervalMonths from the distance interval: if you are about to write intervalMonths equal to intervalKm ÷ 1000 (e.g. 24 months for a 24,000 km item), that is exactly this mistake — use null unless the row's annual-check cell or a printed period actually says so. A row CAN have both a distance pattern and an annual-check mark; then report both intervalKm and intervalMonths 12.
7. REGULAR REPLACE: when a row has a Regular Replace period AND periodic inspection marks (brake fluid, coolant are classic cases), report the replacement as the item's action with intervalMonths from the period, and put the inspection interval and the original wording ("2 years") in notes.
8. PRE-RIDE COLUMN: a "Pre-ride check" mark is NOT a service interval. Emit pre-ride-only rows (fuel level, lights/horn, and engine stop switch are typical) with intervalKm and intervalMonths null — check whether the distance columns are truly marked before assigning any interval, and NEVER invent one.
9. FOOTNOTES: row markers like *1, *2, *3 resolve to notes printed after the table — sometimes at the bottom of the page, sometimes on the NEXT page. Look them up and fold the condition into notes (e.g. "service more often when riding in unusually wet or dusty areas").

TRANSCRIBE ROW BY ROW, in the table's own order, one item per printed row. Schedule tables often span two or more pages — count the item rows on every page of the table and emit exactly that many items (typical motorcycle schedules have 25–35), including pre-ride-only rows and rows whose pattern repeats a neighbour's; every printed row must appear exactly once. key and name MUST come from the SAME row; double-check alignment on the last rows, where drift is easy. Ignore marketing copy, prose chapters, and troubleshooting sections — only the maintenance table(s) count.

For each item:
- key: a canonical kebab-case component key. STRONGLY prefer one of: {KEYS}. Only mint a new kebab-case slug when none of those fit.
- name: the component name exactly as that row of the manual phrases it.
- action: the primary prescribed action (replace, inspect, adjust, lubricate, clean, or other), decoded from the row's own marks via the table's legend.
- intervalKm / intervalMonths: the REGULAR interval decoded per the rules above, normalized to kilometers and months. Convert miles to kilometers (1 mi = 1.609 km, rounding to a sensible figure) and years to months. Use null when the manual gives no distance or no time interval for the item.
- firstAtKm: the one-time initial/break-in service distance in kilometers (rule 5), otherwise null.
- notes: the manual's original phrasing that didn't fit the structured fields — footnote conditions ("more often in dusty conditions", "ED, KO types only"), original period wording ("2 years"), secondary actions ("inspect every 12,000 km"). Do NOT use notes for page cross-references like "Refer to page 55". null if there is nothing to add.`;

const DESC_V4: Desc = {
  ...DESC_V3,
  intervalMonths: "Regular service interval in months, ONLY from an explicit time column or period: 12 if the row is marked in an annual/yearly-check column; \"Regular Replace\" periods like \"2 years\" → 24, \"3 years\" → 36. NEVER derive months from the distance interval — intervalMonths equal to intervalKm ÷ 1000 is almost always that mistake. null when the manual prints no time interval for this row.",
};

// v5 = v3 (best so far) + three surgical additions, keeping v3's positive tone
// (v4 showed cautionary "never guess / verify individually" phrasing → abstention):
// image-not-text note, named months=km/1000 anti-pattern, pre-ride rows emitted.
const PROMPT_V5 = `You are a strict transcriber extracting the PERIODIC MAINTENANCE schedule from a vehicle owner's manual. You only report maintenance items and intervals actually printed in the document — never estimate, infer from general knowledge, or invent a plausible schedule.

First decide: does the document contain an actual periodic maintenance schedule table (or an equivalent structured list of components with service intervals)? Set schedule_table_found accordingly. If it is false, items MUST be an empty array — an empty result is the correct, expected answer for a document without a schedule; a fabricated schedule is the worst possible answer.

HOW TO READ GRID-STYLE SCHEDULE TABLES (the common motorcycle-manual layout: item rows × odometer columns, with single-letter marks in the cells):
1. MULTIPLIER HEADERS: the distance columns are usually labeled with a multiplier, e.g. "× 1,000 km" over column labels 1 | 12 | 24 | 36 | 48 — those columns mean 1,000 / 12,000 / 24,000 / 36,000 / 48,000 km. Always multiply the column label by the header's multiplier. When the header shows BOTH a "× 1,000 km" row and a "× 1,000 mi" row, they are the SAME checkpoints in two units — take intervalKm from the km row only; never put a miles figure into intervalKm.
2. CELL MARKS AND THE LEGEND: cells contain letter codes defined in a legend printed near the table, often BELOW it or in a note — typically I = inspect (and clean, adjust, lubricate, or replace if necessary), R = replace, C = clean, L = lubricate, A = adjust. The marks are usually small graphics, so they may be missing from the PDF's embedded text — read each row's cells from the table as laid out on the page. Read the legend the manual actually prints and decode each row's own marks — adjacent rows often differ (e.g. an R row between I rows).
3. THE REPEAT RULE: manuals state (in a note such as "at higher odometer readings, repeat at the frequency interval established here") that each row's mark pattern repeats, so the REGULAR interval is the SPACING between the row's repeating marks. Count the marked distance columns for the row: marks in EVERY main column (e.g. 12, 24, 36, 48 ×1,000 km) → interval = the column spacing (12,000 km); marks in every SECOND column (only 24 and 48) → 24,000 km; a note printed in the row itself like "every 1,000 km" → that value. Expect a mix: some rows repeat at every column, others only at every second one — record what each row actually shows.
4. BREAK-IN COLUMN: a mark in the small first distance column (e.g. "1" = 1,000 km) is the one-time initial/break-in service → firstAtKm; the regular interval still comes from the remaining repeating marks. Only the few rows whose cells ACTUALLY mark that column get firstAtKm — typically engine oil and its filter. Do NOT copy a break-in figure onto other rows; leave firstAtKm null unless that row's own break-in cell is marked.
5. TIME INTERVALS come ONLY from explicit time columns or printed periods: a mark in an "Annual Check" / "every year" column → intervalMonths 12; a "Regular Replace" column period like "2 years" → 24, "3 years" → 36. NEVER derive intervalMonths from the distance interval — writing intervalMonths equal to intervalKm ÷ 1,000 (e.g. 24 months for a 24,000 km item) is exactly that mistake; a row marked only in distance columns has intervalMonths null even at 24,000 or 36,000 km. A row CAN have both a distance pattern and an annual-check mark; then report both intervalKm and intervalMonths 12.
6. REGULAR REPLACE: when a row has a Regular Replace period AND periodic inspection marks (brake fluid, coolant are classic cases), report the replacement as the item's action with intervalMonths from the period, and put the inspection interval and the original wording ("2 years") in notes.
7. PRE-RIDE COLUMN: a "Pre-ride check" mark is NOT a service interval. Emit rows whose only mark is pre-ride with intervalKm and intervalMonths null; NEVER invent a numeric interval for them.
8. FOOTNOTES: row markers like *1, *2, *3 resolve to notes printed after the table — sometimes at the bottom of the page, sometimes on the NEXT page. Look them up and fold the condition into notes (e.g. "service more often when riding in unusually wet or dusty areas").

TRANSCRIBE ROW BY ROW, in the table's own order, one item per printed row. Schedule tables often span two or more pages — include every continuation row, and after transcribing re-scan the table for rows you skipped (typical motorcycle schedules have 25–35 rows, including pre-ride-only rows); every printed row must appear exactly once. key and name MUST come from the SAME row; double-check alignment on the last rows, where drift is easy. Ignore marketing copy, prose chapters, and troubleshooting sections — only the maintenance table(s) count.

For each item:
- key: a canonical kebab-case component key. STRONGLY prefer one of: {KEYS}. Only mint a new kebab-case slug when none of those fit.
- name: the component name exactly as that row of the manual phrases it.
- action: the primary prescribed action (replace, inspect, adjust, lubricate, clean, or other), decoded from the row's own marks via the table's legend.
- intervalKm / intervalMonths: the REGULAR interval decoded per the rules above, normalized to kilometers and months. Convert miles to kilometers (1 mi = 1.609 km, rounding to a sensible figure) and years to months. Use null when the manual gives no distance or no time interval for the item.
- firstAtKm: the one-time initial/break-in service distance in kilometers (rule 4), otherwise null.
- notes: the manual's original phrasing that didn't fit the structured fields — footnote conditions ("more often in dusty conditions", "ED, KO types only"), original period wording ("2 years"), secondary actions ("inspect every 12,000 km"). Do NOT use notes for page cross-references like "Refer to page 55". null if there is nothing to add.`;

// v6 = v3 verbatim + (i) v5's named months=km/1000 anti-pattern in rule 5,
// (ii) component-free worked decode examples, (iii) soft annual↔distance
// coupling hint. Everything else identical to v3 (best run so far).
const PROMPT_V6 = `You are a strict transcriber extracting the PERIODIC MAINTENANCE schedule from a vehicle owner's manual. You only report maintenance items and intervals actually printed in the document — never estimate, infer from general knowledge, or invent a plausible schedule.

First decide: does the document contain an actual periodic maintenance schedule table (or an equivalent structured list of components with service intervals)? Set schedule_table_found accordingly. If it is false, items MUST be an empty array — an empty result is the correct, expected answer for a document without a schedule; a fabricated schedule is the worst possible answer.

HOW TO READ GRID-STYLE SCHEDULE TABLES (the common motorcycle-manual layout: item rows × odometer columns, with single-letter marks in the cells):
1. MULTIPLIER HEADERS: the distance columns are usually labeled with a multiplier, e.g. "× 1,000 km" over column labels 1 | 12 | 24 | 36 | 48 — those columns mean 1,000 / 12,000 / 24,000 / 36,000 / 48,000 km. Always multiply the column label by the header's multiplier. When the header shows BOTH a "× 1,000 km" row and a "× 1,000 mi" row, they are the SAME checkpoints in two units — take intervalKm from the km row only; never put a miles figure into intervalKm.
2. CELL MARKS AND THE LEGEND: cells contain letter codes defined in a legend printed near the table, often BELOW it or in a note — typically I = inspect (and clean, adjust, lubricate, or replace if necessary), R = replace, C = clean, L = lubricate, A = adjust. Read the legend the manual actually prints and decode each row's own marks — adjacent rows often differ (e.g. an R row between I rows); never copy a neighbouring row's pattern.
3. THE REPEAT RULE: manuals state (in a note such as "at higher odometer readings, repeat at the frequency interval established here") that each row's mark pattern repeats, so the REGULAR interval is the SPACING between the row's repeating marks. Count the marked distance columns for the row: marks in EVERY main column (e.g. 12, 24, 36, 48 ×1,000 km) → interval = the column spacing (12,000 km); marks in every SECOND column (only 24 and 48) → 24,000 km; a note printed in the row itself like "every 1,000 km" → that value.
4. BREAK-IN COLUMN: a mark in the small first distance column (e.g. "1" = 1,000 km) is the one-time initial/break-in service → firstAtKm; the regular interval still comes from the remaining repeating marks. Only the few rows whose cells ACTUALLY mark that column get firstAtKm — typically engine oil and its filter. Do NOT copy a break-in figure onto other rows; leave firstAtKm null unless that row's own break-in cell is marked.
5. TIME INTERVALS come ONLY from explicit time columns or printed periods: a mark in an "Annual Check" / "every year" column → intervalMonths 12; a "Regular Replace" column period like "2 years" → 24, "3 years" → 36. NEVER derive intervalMonths from the distance interval — writing intervalMonths equal to intervalKm ÷ 1,000 (e.g. 24 months for a 24,000 km item) is exactly that mistake; a row marked only in distance columns has intervalMonths null even at 24,000 or 36,000 km. A row CAN have both a distance pattern and an annual-check mark; then report both intervalKm and intervalMonths 12. As a rule of thumb, rows marked in the Annual Check column usually carry the every-column (shortest) distance pattern, while every-second-column rows usually have no annual mark.
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
- key: a canonical kebab-case component key. STRONGLY prefer one of: {KEYS}. Only mint a new kebab-case slug when none of those fit.
- name: the component name exactly as that row of the manual phrases it.
- action: the primary prescribed action (replace, inspect, adjust, lubricate, clean, or other), decoded from the row's own marks via the table's legend.
- intervalKm / intervalMonths: the REGULAR interval decoded per the rules above, normalized to kilometers and months. Convert miles to kilometers (1 mi = 1.609 km, rounding to a sensible figure) and years to months. Use null when the manual gives no distance or no time interval for the item.
- firstAtKm: the one-time initial/break-in service distance in kilometers (rule 4), otherwise null.
- notes: the manual's original phrasing that didn't fit the structured fields — footnote conditions ("more often in dusty conditions", "ED, KO types only"), original period wording ("2 years"), secondary actions ("inspect every 12,000 km"). Do NOT use notes for page cross-references like "Refer to page 55". null if there is nothing to add.`;

// v7 = v6 + rebalanced rule 5 (anti-derive-months stays, but Annual Check must be
// applied per row when marked) + key-minted-from-own-name pairing rule.
const PROMPT_V7 = `You are a strict transcriber extracting the PERIODIC MAINTENANCE schedule from a vehicle owner's manual. You only report maintenance items and intervals actually printed in the document — never estimate, infer from general knowledge, or invent a plausible schedule.

First decide: does the document contain an actual periodic maintenance schedule table (or an equivalent structured list of components with service intervals)? Set schedule_table_found accordingly. If it is false, items MUST be an empty array — an empty result is the correct, expected answer for a document without a schedule; a fabricated schedule is the worst possible answer.

HOW TO READ GRID-STYLE SCHEDULE TABLES (the common motorcycle-manual layout: item rows × odometer columns, with single-letter marks in the cells):
1. MULTIPLIER HEADERS: the distance columns are usually labeled with a multiplier, e.g. "× 1,000 km" over column labels 1 | 12 | 24 | 36 | 48 — those columns mean 1,000 / 12,000 / 24,000 / 36,000 / 48,000 km. Always multiply the column label by the header's multiplier. When the header shows BOTH a "× 1,000 km" row and a "× 1,000 mi" row, they are the SAME checkpoints in two units — take intervalKm from the km row only; never put a miles figure into intervalKm.
2. CELL MARKS AND THE LEGEND: cells contain letter codes defined in a legend printed near the table, often BELOW it or in a note — typically I = inspect (and clean, adjust, lubricate, or replace if necessary), R = replace, C = clean, L = lubricate, A = adjust. Read the legend the manual actually prints and decode each row's own marks — adjacent rows often differ (e.g. an R row between I rows); never copy a neighbouring row's pattern.
3. THE REPEAT RULE: manuals state (in a note such as "at higher odometer readings, repeat at the frequency interval established here") that each row's mark pattern repeats, so the REGULAR interval is the SPACING between the row's repeating marks. Count the marked distance columns for the row: marks in EVERY main column (e.g. 12, 24, 36, 48 ×1,000 km) → interval = the column spacing (12,000 km); marks in every SECOND column (only 24 and 48) → 24,000 km; a note printed in the row itself like "every 1,000 km" → that value.
4. BREAK-IN COLUMN: a mark in the small first distance column (e.g. "1" = 1,000 km) is the one-time initial/break-in service → firstAtKm; the regular interval still comes from the remaining repeating marks. Only the few rows whose cells ACTUALLY mark that column get firstAtKm — typically engine oil and its filter. Do NOT copy a break-in figure onto other rows; leave firstAtKm null unless that row's own break-in cell is marked.
5. TIME INTERVALS come ONLY from explicit time columns or printed periods: a mark in an "Annual Check" / "every year" column → intervalMonths 12; a "Regular Replace" column period like "2 years" → 24, "3 years" → 36. NEVER derive intervalMonths from the distance interval — writing intervalMonths equal to intervalKm ÷ 1,000 (e.g. 24 months for a 24,000 km item) is exactly that mistake; a row marked only in distance columns has intervalMonths null even at 24,000 or 36,000 km. A row CAN have both a distance pattern and an annual-check mark; then report both intervalKm and intervalMonths 12. As a rule of thumb, rows marked in the Annual Check column usually carry the every-column (shortest) distance pattern, while every-second-column rows usually have no annual mark. But DO apply the Annual Check column when it is marked: check that cell for EVERY row and set intervalMonths 12 whenever it carries a mark — in many grid schedules most of the inspection rows do. Only rows with neither an annual mark nor a printed period get intervalMonths null.
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
- key: a canonical kebab-case component key. STRONGLY prefer one of: {KEYS}. Only mint a new kebab-case slug when none of those fit — and mint it from THIS row's own name (name "Drive Chain Slider" → key "chain-slider"). Never reuse the previous row's key or a canonical key that names a different component (key "lights" with name "Headlight Aim" is wrong).
- name: the component name exactly as that row of the manual phrases it.
- action: the primary prescribed action (replace, inspect, adjust, lubricate, clean, or other), decoded from the row's own marks via the table's legend.
- intervalKm / intervalMonths: the REGULAR interval decoded per the rules above, normalized to kilometers and months. Convert miles to kilometers (1 mi = 1.609 km, rounding to a sensible figure) and years to months. Use null when the manual gives no distance or no time interval for the item.
- firstAtKm: the one-time initial/break-in service distance in kilometers (rule 4), otherwise null.
- notes: the manual's original phrasing that didn't fit the structured fields — footnote conditions ("more often in dusty conditions", "ED, KO types only"), original period wording ("2 years"), secondary actions ("inspect every 12,000 km"). Do NOT use notes for page cross-references like "Refer to page 55". null if there is nothing to add.`;

// v8 = v6/v7 structure with rule 5 rebalanced: the v5-v7 "months = km/1000 is a
// mistake" phrasing also matched legit 12000km+12mo annual rows and suppressed
// them; replaced with v3's milder wording + "12000 AND 12 is normal".
const PROMPT_V8 = `You are a strict transcriber extracting the PERIODIC MAINTENANCE schedule from a vehicle owner's manual. You only report maintenance items and intervals actually printed in the document — never estimate, infer from general knowledge, or invent a plausible schedule.

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
- key: a canonical kebab-case component key. STRONGLY prefer one of: {KEYS}. Only mint a new kebab-case slug when none of those fit — and mint it from THIS row's own name (name "Drive Chain Slider" → key "chain-slider"). Never reuse the previous row's key or a canonical key that names a different component (key "lights" with name "Headlight Aim" is wrong).
- name: the component name exactly as that row of the manual phrases it.
- action: the primary prescribed action (replace, inspect, adjust, lubricate, clean, or other), decoded from the row's own marks via the table's legend.
- intervalKm / intervalMonths: the REGULAR interval decoded per the rules above, normalized to kilometers and months. Convert miles to kilometers (1 mi = 1.609 km, rounding to a sensible figure) and years to months. Use null when the manual gives no distance or no time interval for the item.
- firstAtKm: the one-time initial/break-in service distance in kilometers (rule 4), otherwise null.
- notes: the manual's original phrasing that didn't fit the structured fields — footnote conditions ("more often in dusty conditions", "ED, KO types only"), original period wording ("2 years"), secondary actions ("inspect every 12,000 km"). Do NOT use notes for page cross-references like "Refer to page 55". null if there is nothing to add.`;

const DESC_V8: Desc = {
  ...DESC_V3,
  intervalMonths: "Regular service interval in months, ONLY from an explicit time column or period: 12 if the row is marked in an annual/yearly-check column (common \u2014 many rows correctly have both intervalKm and 12 here); \"Regular Replace\" periods like \"2 years\" \u2192 24, \"3 years\" \u2192 36. NEVER derive months from the distance interval alone. null when the manual prints no time interval for this row.",
};

const CANDIDATES: Record<string, { prompt: string, desc: Desc }> = {
  v1: { prompt: PROMPT_V1, desc: DESC_V1 },
  v2: { prompt: PROMPT_V2, desc: DESC_V2 },
  v3: { prompt: PROMPT_V3, desc: DESC_V3 },
  v4: { prompt: PROMPT_V4, desc: DESC_V4 },
  v5: { prompt: PROMPT_V5, desc: DESC_V4 },
  v6: { prompt: PROMPT_V6, desc: DESC_V4 },
  v7: { prompt: PROMPT_V7, desc: DESC_V4 },
  v8: { prompt: PROMPT_V8, desc: DESC_V8 },
};

// ---------------------------------------------------------------------------
// Ground truth (transcribed rubric from cb500x-ground-truth.md)
// ---------------------------------------------------------------------------
type Accept = { actions: string[], km: number | null, months: number | null };
type GTRow = {
  id: string;
  keys: string[];               // acceptable key slugs (post-slugify)
  names: string[];              // lowercase substrings matching the name
  nameExclude?: string[];       // substrings that disqualify a name match
  accept: Accept[];             // acceptable (action, km, months) tuples
  first: number | null;         // expected firstAtKm
  preRideOnly?: boolean;        // pre-ride-only row: omit OK, intervals are a fail
  noteHints?: string[];         // lowercase substrings expected somewhere in notes
};

const GT: GTRow[] = [
  { id: "fuel-line", keys: ["fuel-line", "fuel-lines"], names: ["fuel line"], accept: [{ actions: ["inspect"], km: 12000, months: 12 }], first: null },
  { id: "fuel-level", keys: ["fuel-level"], names: ["fuel level"], accept: [], first: null, preRideOnly: true },
  { id: "throttle", keys: ["throttle", "throttle-operation"], names: ["throttle"], accept: [{ actions: ["inspect"], km: 12000, months: 12 }], first: null },
  { id: "air-filter", keys: ["air-filter", "air-cleaner"], names: ["air cleaner", "air filter"], accept: [{ actions: ["replace"], km: 24000, months: null }], first: null, noteHints: ["dust"] },
  { id: "crankcase-breather", keys: ["crankcase-breather"], names: ["crankcase"], accept: [{ actions: ["clean"], km: 12000, months: null }], first: null, noteHints: ["rain"] },
  { id: "spark-plugs", keys: ["spark-plugs", "spark-plug"], names: ["spark plug"], accept: [{ actions: ["replace"], km: 24000, months: null }], first: null },
  { id: "valve-clearance", keys: ["valve-clearance"], names: ["valve clearance", "valve"], accept: [{ actions: ["inspect"], km: 24000, months: null }], first: null },
  { id: "engine-oil", keys: ["engine-oil"], names: ["engine oil"], nameExclude: ["filter"], accept: [{ actions: ["replace"], km: 12000, months: 12 }], first: 1000 },
  { id: "oil-filter", keys: ["oil-filter", "engine-oil-filter"], names: ["oil filter"], accept: [{ actions: ["replace"], km: 24000, months: null }], first: 1000 },
  { id: "engine-idle-speed", keys: ["engine-idle-speed", "idle-speed"], names: ["idle speed"], accept: [{ actions: ["inspect"], km: 12000, months: 12 }], first: null },
  { id: "coolant", keys: ["coolant", "radiator-coolant"], names: ["coolant"], accept: [{ actions: ["replace"], km: null, months: 36 }], first: null, noteHints: ["3 year"] },
  { id: "cooling-system", keys: ["cooling-system"], names: ["cooling system"], accept: [{ actions: ["inspect"], km: 12000, months: 12 }], first: null },
  { id: "secondary-air-supply", keys: ["secondary-air-supply", "secondary-air-supply-system", "secondary-air"], names: ["secondary air"], accept: [{ actions: ["inspect"], km: 24000, months: null }], first: null },
  { id: "evaporative-emission", keys: ["evaporative-emission", "evaporative-emission-control-system", "evap-system"], names: ["evaporative"], accept: [{ actions: ["inspect"], km: 24000, months: null }], first: null, noteHints: ["ed", "ko"] },
  { id: "chain", keys: ["chain", "drive-chain"], names: ["drive chain", "chain"], nameExclude: ["slider"], accept: [{ actions: ["lubricate", "inspect"], km: 1000, months: null }], first: null },
  { id: "chain-slider", keys: ["chain-slider", "drive-chain-slider"], names: ["slider"], accept: [{ actions: ["inspect"], km: 12000, months: null }], first: null },
  { id: "brake-fluid", keys: ["brake-fluid"], names: ["brake fluid"], accept: [{ actions: ["replace"], km: null, months: 24 }], first: null, noteHints: ["2 year"] },
  { id: "brake-pads", keys: ["brake-pads", "brake-pads-front", "brake-pads-rear", "brake-pad-wear", "brake-pads-wear"], names: ["brake pad"], accept: [{ actions: ["inspect"], km: 12000, months: 12 }], first: null },
  { id: "brake-system", keys: ["brake-system"], names: ["brake system"], accept: [{ actions: ["inspect"], km: 12000, months: 12 }], first: null },
  { id: "brakelight-switch", keys: ["brakelight-switch", "brake-light-switch"], names: ["brakelight", "brake light"], accept: [{ actions: ["inspect"], km: 12000, months: 12 }], first: null },
  { id: "headlight-aim", keys: ["headlight-aim", "headlight"], names: ["headlight"], accept: [{ actions: ["inspect"], km: 12000, months: 12 }], first: null },
  { id: "lights-horn", keys: ["lights-horn", "lights", "lights-and-horn"], names: ["horn"], accept: [], first: null, preRideOnly: true },
  { id: "engine-stop-switch", keys: ["engine-stop-switch", "stop-switch"], names: ["stop switch"], accept: [], first: null, preRideOnly: true },
  { id: "clutch", keys: ["clutch", "clutch-system"], names: ["clutch"], accept: [{ actions: ["inspect"], km: 12000, months: 12 }], first: null },
  { id: "side-stand", keys: ["side-stand", "sidestand"], names: ["side stand", "sidestand", "side-stand"], accept: [{ actions: ["inspect"], km: 12000, months: 12 }], first: null },
  { id: "suspension", keys: ["suspension", "suspension-front", "suspension-rear"], names: ["suspension"], accept: [{ actions: ["inspect"], km: 12000, months: 12 }], first: null },
  { id: "nuts-bolts", keys: ["nuts-bolts-fasteners", "nuts-bolts", "fasteners"], names: ["nuts", "bolts", "fastener"], accept: [{ actions: ["inspect"], km: 12000, months: 12 }], first: null },
  { id: "wheels", keys: ["wheels", "wheels-tyres", "wheels-tires", "front-tire", "rear-tire", "tires", "tyres"], names: ["wheels/tyres", "wheels/tires", "wheel", "tyre", "tire"], accept: [{ actions: ["inspect"], km: 12000, months: 12 }], first: null },
  { id: "steering-bearings", keys: ["steering-bearings", "steering-head-bearings"], names: ["steering"], accept: [{ actions: ["inspect"], km: 12000, months: 12 }], first: null },
];

// ---------------------------------------------------------------------------
// Scoring
// ---------------------------------------------------------------------------
type Item = { key: string, name: string, action: string, intervalKm?: number, intervalMonths?: number, firstAtKm?: number, notes?: string };

function nameRowOf(name: string): GTRow | undefined {
  const n = (name || "").toLowerCase();
  let best: { row: GTRow, len: number } | undefined;
  for (const row of GT) {
    if (row.nameExclude?.some((x) => n.includes(x))) continue;
    for (const sub of row.names) {
      if (n.includes(sub) && (!best || sub.length > best.len)) best = { row, len: sub.length };
    }
  }
  return best?.row;
}

function fmt(v: unknown): string { return v === undefined || v === null ? "—" : String(v); }

function score(items: Item[]) {
  const pairingViolations: string[] = [];
  const fabricated: Item[] = [];
  const assigned = new Map<string, Item[]>();

  for (const item of items) {
    const keyRow = GT.find((r) => r.keys.includes(item.key));
    const nameRow = nameRowOf(item.name);
    if (keyRow && nameRow && keyRow.id !== nameRow.id) {
      pairingViolations.push(`key=${item.key} (→${keyRow.id}) paired with name="${item.name}" (→${nameRow.id})`);
    }
    const row = nameRow ?? keyRow;
    if (!row) { fabricated.push(item); continue; }
    assigned.set(row.id, [...(assigned.get(row.id) || []), item]);
  }

  const intervalRows = GT.filter((r) => !r.preRideOnly);
  let covered = 0, intervalOK = 0, kmOK = 0, monthsOK = 0, actionOK = 0;
  const detail: string[] = [];
  for (const row of intervalRows) {
    const candidates = assigned.get(row.id) || [];
    if (!candidates.length) { detail.push(`MISS    ${row.id}`); continue; }
    covered++;
    // best candidate = most rubric points
    let best = candidates[0], bestPts = -1;
    for (const c of candidates) {
      const a = row.accept.find((x) => x.actions.includes(c.action));
      const anyAccept = row.accept[0];
      const km = (a || anyAccept) ? (c.intervalKm ?? null) === (a || anyAccept)!.km : false;
      const mo = (a || anyAccept) ? (c.intervalMonths ?? null) === (a || anyAccept)!.months : false;
      const pts = (a ? 1 : 0) + (km ? 1 : 0) + (mo ? 1 : 0);
      if (pts > bestPts) { best = c; bestPts = pts; }
    }
    const acc = row.accept.find((x) => x.actions.includes(best.action)) || row.accept[0];
    const km = (best.intervalKm ?? null) === acc.km;
    const mo = (best.intervalMonths ?? null) === acc.months;
    const act = row.accept.some((x) => x.actions.includes(best.action));
    if (km) kmOK++;
    if (mo) monthsOK++;
    if (km && mo) intervalOK++;
    if (act) actionOK++;
    const flags = [km ? "" : `km ${fmt(best.intervalKm)}≠${fmt(acc.km)}`, mo ? "" : `mo ${fmt(best.intervalMonths)}≠${fmt(acc.months)}`, act ? "" : `action ${best.action}≠${row.accept.map((a) => a.actions.join("/")).join("|")}`].filter(Boolean);
    detail.push(`${flags.length ? "PARTIAL" : "OK     "} ${row.id}${flags.length ? " — " + flags.join(", ") : ""}`);
  }

  // firstAtKm: exactly engine-oil + oil-filter at 1000
  const firstErrors: string[] = [];
  for (const row of GT) {
    const candidates = assigned.get(row.id) || [];
    const got = candidates.map((c) => c.firstAtKm).find((v) => v !== undefined) ?? null;
    if ((row.first ?? null) !== got && candidates.length) {
      firstErrors.push(`${row.id}: firstAtKm ${fmt(got)} expected ${fmt(row.first)}`);
    }
  }

  // pre-ride rows must not carry invented intervals
  const preRideErrors: string[] = [];
  for (const row of GT.filter((r) => r.preRideOnly)) {
    for (const c of assigned.get(row.id) || []) {
      if (c.intervalKm || c.intervalMonths || c.firstAtKm) {
        preRideErrors.push(`${row.id}: pre-ride-only row given km=${fmt(c.intervalKm)} mo=${fmt(c.intervalMonths)} first=${fmt(c.firstAtKm)}`);
      }
    }
  }

  // note hints
  const noteHits: string[] = [];
  const noteMisses: string[] = [];
  for (const row of GT.filter((r) => r.noteHints)) {
    const notes = (assigned.get(row.id) || []).map((c) => (c.notes || "").toLowerCase()).join(" | ");
    const hit = row.noteHints!.some((h) => notes.includes(h));
    (hit ? noteHits : noteMisses).push(`${row.id} (${row.noteHints!.join("/")})`);
  }

  console.log("\n================ SCORE ================");
  console.log(`coverage:        ${covered}/${intervalRows.length} interval-bearing rows matched (target ≥24)`);
  console.log(`interval decode: ${intervalOK}/${intervalRows.length} both-correct  (km ${kmOK}, months ${monthsOK})  — target ≥85% ≈ ${Math.ceil(intervalRows.length * 0.85)}`);
  console.log(`action decode:   ${actionOK}/${covered} of covered rows`);
  console.log(`pairing:         ${pairingViolations.length} violation(s)${pairingViolations.length ? "\n  - " + pairingViolations.join("\n  - ") : ""}`);
  console.log(`firstAtKm:       ${firstErrors.length ? "FAIL\n  - " + firstErrors.join("\n  - ") : "PASS (engine-oil + oil-filter = 1000, others null)"}`);
  console.log(`pre-ride:        ${preRideErrors.length ? "FAIL\n  - " + preRideErrors.join("\n  - ") : "PASS"}`);
  console.log(`unmatched items: ${fabricated.length}${fabricated.length ? " (possible fabrication)\n  - " + fabricated.map((f) => `${f.key} "${f.name}" km=${fmt(f.intervalKm)} mo=${fmt(f.intervalMonths)}`).join("\n  - ") : ""}`);
  console.log(`notes:           hits [${noteHits.join(", ")}] misses [${noteMisses.join(", ")}]`);
  console.log("\n---- per-row detail ----");
  for (const line of detail) console.log(line);
}

function printTable(items: Item[]) {
  console.log("\n================ EXTRACTED ================");
  console.log("key".padEnd(26) + "name".padEnd(32) + "action".padEnd(11) + "km".padStart(7) + "mo".padStart(5) + "first".padStart(7) + "  notes");
  for (const i of items) {
    console.log(
      i.key.padEnd(26).slice(0, 26) +
      i.name.padEnd(32).slice(0, 32) +
      i.action.padEnd(11) +
      fmt(i.intervalKm).padStart(7) +
      fmt(i.intervalMonths).padStart(5) +
      fmt(i.firstAtKm).padStart(7) +
      "  " + (i.notes || "").slice(0, 60)
    );
  }
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------
(async () => {
  const args = process.argv.slice(2);
  const promptName = args.includes("--prompt") ? args[args.indexOf("--prompt") + 1] : undefined;
  const fromFile = args.includes("--from") ? args[args.indexOf("--from") + 1] : undefined;
  // model comparison: defaults to whatever services/ai.ts's extractFromFile defaults to
  // (MODELS.vision, currently gpt-4o) when omitted — only meaningful with --prompt shipped
  const modelOverride = args.includes("--model") ? args[args.indexOf("--model") + 1] : undefined;

  // env first (AI_MOCK=false must already be in process.env so dotenv won't override it)
  process.env.AI_MOCK = "false";
  const { config } = await import(path.join(REPO, "node_modules/dotenv/lib/main.js"));
  config({ path: path.join(REPO, ".env.local") });
  process.env.AI_MOCK = "false";

  const { normalizeItems } = await import(path.join(REPO, "services/schedule-extraction.ts"));

  let extracted: any;
  if (fromFile) {
    extracted = JSON.parse(fs.readFileSync(path.isAbsolute(fromFile) ? fromFile : path.join(SCRATCH, fromFile), "utf8"));
    console.log(`re-scoring cached run: ${fromFile}`);
  } else {
    if (!promptName || (promptName != "shipped" && !CANDIDATES[promptName])) {
      console.error(`usage: --prompt <shipped|${Object.keys(CANDIDATES).join("|")}> | --from <runs/x.json>`);
      process.exit(1);
    }
    if (!PDF || !fs.existsSync(PDF)) {
      console.error("MANUAL_PDF must point at the CB500X manual PDF (not committed — see the header comment)");
      process.exit(1);
    }
    const { CANONICAL_COMPONENT_KEYS, ScheduleItemActions } = await import(path.join(REPO, "types/MaintenanceSchedule.ts"));
    const { extractFromFile } = await import(path.join(REPO, "services/ai.ts"));
    // "shipped" scores exactly what production sends: the service's exported
    // SCHEDULE_PROMPT + its exported scheduleSchema (the real schema object, not a
    // hand-mirrored copy) — this is what makes --model comparisons meaningful. v1-v8
    // are frozen tuning-history candidates and still use their recorded desc/makeSchema.
    const { prompt, schema } = promptName == "shipped"
      ? await (async () => {
          const svc = await import(path.join(REPO, "services/schedule-extraction.ts"));
          return { prompt: svc.SCHEDULE_PROMPT, schema: svc.scheduleSchema };
        })()
      : (() => {
          const { prompt, desc } = CANDIDATES[promptName];
          return { prompt, schema: makeSchema(desc, CANONICAL_COMPONENT_KEYS, ScheduleItemActions) };
        })();
    const finalPrompt = prompt.replace("{KEYS}", CANONICAL_COMPONENT_KEYS.join(", "));
    const buffer = new Uint8Array(fs.readFileSync(PDF));
    const modelLabel = modelOverride || "gpt-4o(default)";
    console.log(`REAL extraction call — prompt=${promptName}, model=${modelLabel}, pdf=${buffer.length} bytes`);
    const t0 = Date.now();
    extracted = await extractFromFile({ buffer, filename: "CB500X-manual.pdf", prompt: finalPrompt, schemaName: "manualSchedule", schema, model: modelOverride });
    console.log(`done in ${((Date.now() - t0) / 1000).toFixed(1)}s — gate=${extracted.schedule_table_found}, raw items=${extracted.items?.length}`);
    const outDir = path.join(SCRATCH, "runs");
    fs.mkdirSync(outDir, { recursive: true });
    const outFile = path.join(outDir, `${promptName}-${modelOverride || "gpt4o"}-${Date.now()}.json`);
    fs.writeFileSync(outFile, JSON.stringify(extracted, null, 2));
    console.log(`raw output saved: ${outFile}`);
  }

  const items: Item[] = normalizeItems(extracted);
  printTable(items);
  score(items);
})();
