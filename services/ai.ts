import fs from "fs";
import path from "path";
import OpenAI, { toFile } from "openai";

// Single source of truth for model names — nothing else in the codebase names a model.
// Per-feature overrides (odometer → gpt-5.6-luna/none, schedule extraction →
// gpt-5.6-sol/medium) are passed by their callers via extractFromImage/extractFromFile's
// optional `model`/`reasoningEffort` params; `vision` here is only the fallback default
// for callers that don't override (e.g. services/documents.ts's page-transcription
// fallback).
const MODELS = {
  // vision-capable + supports structured outputs (response_format json_schema, strict)
  vision: "gpt-5.6-terra",
  // 1536 dimensions — the Upstash Vector index must be created with cosine metric and
  // this exact dimension count (services/vector.ts assumes they match).
  embedding: "text-embedding-3-small",
};

// Chat Completions' reasoning_effort param (gpt-5.x family): verified against a live
// call that the accepted values are 'none' | 'low' | 'medium' | 'high' | 'xhigh' — wider
// than the installed openai SDK's (4.104.0) shipped type (Shared.ReasoningEffort is
// typed 'low'|'medium'|'high'|null, predating 'none'/'xhigh'), so this is typed by hand
// rather than imported from the SDK.
export type ReasoningEffort = "none" | "low" | "medium" | "high" | "xhigh";

// Lazily constructed so importing this module without OPENAI_API_KEY set (builds,
// `npm run admin`, Edge bundling) doesn't throw — only actually calling it does.
let client: OpenAI | undefined;
function getClient(): OpenAI {
  if (!client) {
    if (!process.env.OPENAI_API_KEY) {
      throw new Error("services.ai: OPENAI_API_KEY is not set");
    }
    client = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
  }
  return client;
}

// Same motivation as STORE_TYPE=memory: Playwright tests must be deterministic and
// must not need (or spend) a real API key. Short-circuits before any network call.
const mock = () => process.env.AI_MOCK == "true";

// Canned responses for AI_MOCK live in test/fixtures/ai-mocks.json, keyed by
// schemaName — test data, so it belongs with the fixtures, and it's only ever read
// when mock mode is on (lazily, so the normal path never touches the filesystem).
// This module is server-only Node runtime (API routes/services, never proxy.ts's Edge
// runtime), so fs is available. A test hitting an unmocked schema is a bug → throw.
let mocks: Record<string, any> | undefined;
function loadMocks(): Record<string, any> {
  if (!mocks) {
    mocks = JSON.parse(fs.readFileSync(path.join(process.cwd(), "test/fixtures/ai-mocks.json"), "utf8"));
  }
  return mocks!;
}

// S14's write-time log classifier mock lives here in code (like embed()'s mockEmbed,
// NOT in test/fixtures/ai-mocks.json — a classification is a function of its input, a
// static canned answer would make every journal entry "match" the same keys):
// deterministic keyword match over the caller's JSON user message ({ entry, keys } —
// services/logs.ts's classifyLogScheduleKeys formats it that way precisely so this mock
// can read it back). A key is returned when a distinctive word of it (a hyphen-part,
// ≥ 3 chars) appears as a word in the entry text: "lubed the chain" → ["chain"],
// "engine-oil" stays out. Good enough for seeded-store dev and specs to behave sensibly.
function mockLogClassifier(messages: ChatMessage[]): { scheduleKeys: string[] } {
  const lastUser = [...messages].reverse().find((message) => message.role == "user");
  let payload: { entry?: string, keys?: string[] } = {};
  try {
    payload = JSON.parse(typeof lastUser?.content == "string" ? lastUser.content : "{}");
  } catch {
    // not the expected JSON payload → no matches
  }

  const words = new Set(`${payload.entry || ""}`.toLowerCase().split(/[^a-z0-9]+/).filter(Boolean));
  const scheduleKeys = (payload.keys || []).filter((key) =>
    `${key}`.toLowerCase().split("-").some((part) => part.length >= 3 && words.has(part)));

  return { scheduleKeys };
}

// A chat message as the Chat Completions API takes it. `content` is `any` on purpose:
// text-only turns pass a string, extractFromImage passes the SDK's content-part arrays.
export type ChatMessage = {
  role: "system" | "user" | "assistant",
  content: any,
};

// Shared real-call internals for the structured-output helpers (extractFromImage +
// chatJSON): one chat completion with response_format json_schema (strict), parsed. The
// mock branches stay in the callers — extractFromImage's is a static lookup while
// chatJSON's walks a script — but the OpenAI plumbing must not drift apart.
async function completeJSON<T>({ messages, schemaName, schema, model, reasoningEffort, context }: {
  messages: ChatMessage[],
  schemaName: string,
  schema: Record<string, unknown>,
  model?: string,
  reasoningEffort?: ReasoningEffort,
  context: string, // caller name for error wrapping, e.g. "services.ai.chatJSON"
}): Promise<T> {
  try {
    const completion = await getClient().chat.completions.create({
      model: model || MODELS.vision,
      ...(reasoningEffort && { reasoning_effort: reasoningEffort as any }),
      messages: messages as any,
      response_format: {
        type: "json_schema",
        json_schema: { name: schemaName, strict: true, schema },
      },
    });

    const content = completion.choices[0]?.message?.content;
    if (!content) {
      throw new Error("empty response");
    }
    return JSON.parse(content) as T;
  } catch (err: any) {
    // wrap with context; routes turn thrown errors into 5xx JSON
    throw new Error(`${context}(${schemaName}): ${err.message}`);
  }
}

// Text-only structured chat (S13): a whole conversation in, one strict-JSON turn out —
// extractFromImage minus the image. In mock mode a scripted conversation is supported:
// when the ai-mocks.json entry for schemaName is an ARRAY, it's a turn-by-turn script
// indexed by how many `user` messages the transcript holds (0 answers → first turn),
// sticking on the last turn once the script is exhausted.
export async function chatJSON<T>({ messages, schemaName, schema, model, reasoningEffort }: {
  messages: ChatMessage[],
  schemaName: string, // doubles as the json_schema name and the ai-mocks.json key
  schema: Record<string, unknown>, // plain JSON Schema (deliberately not zod — not a dependency)
  model?: string,
  reasoningEffort?: ReasoningEffort,
}): Promise<T> {
  console.log("services.ai.chatJSON", { schemaName, messageCount: messages.length, model: model || MODELS.vision, reasoningEffort });

  if (mock()) {
    // the log classifier's mock is computed from its input (see mockLogClassifier
    // above), not looked up in the fixtures file
    if (schemaName == "logClassifier") {
      return mockLogClassifier(messages) as T;
    }
    const mocks = loadMocks();
    if (!(schemaName in mocks)) {
      throw new Error(`services.ai.chatJSON(${schemaName}): no mock registered in test/fixtures/ai-mocks.json (AI_MOCK=true)`);
    }
    const canned = mocks[schemaName];
    if (Array.isArray(canned)) {
      const userMessageCount = messages.filter((message) => message.role == "user").length;
      return canned[Math.min(userMessageCount, canned.length - 1)] as T;
    }
    return canned as T;
  }

  return completeJSON<T>({ messages, schemaName, schema, model, reasoningEffort, context: "services.ai.chatJSON" });
}

export async function extractFromImage<T>({ imageUrl, imageUrls, prompt, schemaName, schema, model, reasoningEffort }: {
  imageUrl?: string,   // blob URL (public-but-unguessable) — passed straight to OpenAI, no re-download
  imageUrls?: string[], // multi-image alternative (e.g. a receipt photographed page by
                        // page — S11b): all images go in ONE user message, in order, so
                        // the model reads them as one document. Exactly one of
                        // imageUrl/imageUrls must be provided.
  prompt: string,
  schemaName: string, // doubles as the json_schema name and the MOCKS key
  schema: Record<string, unknown>, // plain JSON Schema (deliberately not zod — not a dependency)
  model?: string,               // defaults to MODELS.vision; per-feature override (e.g. odometer → gpt-5.6-luna)
  reasoningEffort?: ReasoningEffort, // gpt-5.x only; omit for models that don't support it
}): Promise<T> {
  const urls = imageUrls ?? (imageUrl ? [imageUrl] : []);
  console.log("services.ai.extractFromImage", { schemaName, imageCount: urls.length, model: model || MODELS.vision, reasoningEffort });

  if (!urls.length) {
    throw new Error(`services.ai.extractFromImage(${schemaName}): imageUrl or imageUrls is required`);
  }

  if (mock()) {
    const mocks = loadMocks();
    if (!(schemaName in mocks)) {
      throw new Error(`services.ai.extractFromImage(${schemaName}): no mock registered in test/fixtures/ai-mocks.json (AI_MOCK=true)`);
    }
    return mocks[schemaName] as T;
  }

  return completeJSON<T>({
    messages: [
      {
        role: "user",
        content: [
          { type: "text", text: prompt },
          ...urls.map((url) => ({ type: "image_url" as const, image_url: { url } })),
        ],
      },
    ],
    schemaName,
    schema,
    model,
    reasoningEffort,
    context: "services.ai.extractFromImage",
  });
}

// Whole-file extraction (S10): upload the file to the OpenAI Files API, reference it as
// a `file` content part in a chat completion (verified against openai@4.104's types:
// ChatCompletionContentPart.File is `{ type: "file", file: { file_id } }`), and delete
// the uploaded file in a `finally` — it's a transient input, not something to accumulate
// in the org's file storage. This is the one deliberate full-document AI spend in the
// app (schedule tables in manuals mangle as raw text extraction).
export async function extractFromFile<T>({ buffer, filename, prompt, schemaName, schema, model, reasoningEffort }: {
  buffer: Uint8Array, // the file's bytes (already fetched — blob URLs may be data: URLs under BLOB_MOCK)
  filename: string,   // OpenAI uses the extension to sniff the file type — keep it accurate
  prompt: string,
  schemaName: string, // doubles as the json_schema name and the ai-mocks.json key
  schema: Record<string, unknown>, // plain JSON Schema (deliberately not zod — not a dependency)
  model?: string,      // defaults to MODELS.vision; per-feature override (e.g. schedule
                       // extraction → gpt-5.6-sol) and docs/prompt-evals/ comparisons
  reasoningEffort?: ReasoningEffort, // gpt-5.x only; omit for models that don't support it
}): Promise<T> {
  console.log("services.ai.extractFromFile", { schemaName, filename, size: buffer.length, model: model || MODELS.vision, reasoningEffort });

  if (mock()) {
    const mocks = loadMocks();
    if (!(schemaName in mocks)) {
      throw new Error(`services.ai.extractFromFile(${schemaName}): no mock registered in test/fixtures/ai-mocks.json (AI_MOCK=true)`);
    }
    return mocks[schemaName] as T;
  }

  let uploadedFileId: string | undefined;
  try {
    const uploaded = await getClient().files.create({
      file: await toFile(buffer, filename),
      purpose: "user_data",
    });
    uploadedFileId = uploaded.id;

    const completion = await getClient().chat.completions.create({
      model: model || MODELS.vision,
      ...(reasoningEffort && { reasoning_effort: reasoningEffort as any }),
      // Deliberately DEFAULT temperature: temperature 0 was tried during S10b's prompt
      // tuning (on gpt-4o) to tame run-to-run variance and it collapsed the
      // schedule-table decode (interval extraction fell from 22/26 rows to 4/26 —
      // greedy decoding locked into a degenerate "no distance intervals" reading of the
      // grid). Don't re-add it without re-running the eval in docs/prompt-evals/.
      // reasoning_effort is the equivalent lever for gpt-5.x models — use that instead.
      messages: [
        {
          role: "user",
          content: [
            { type: "file", file: { file_id: uploaded.id } },
            { type: "text", text: prompt },
          ],
        },
      ],
      response_format: {
        type: "json_schema",
        json_schema: { name: schemaName, strict: true, schema },
      },
    });

    const content = completion.choices[0]?.message?.content;
    if (!content) {
      throw new Error("empty response");
    }
    return JSON.parse(content) as T;
  } catch (err: any) {
    // wrap with context; routes turn thrown errors into 5xx JSON
    throw new Error(`services.ai.extractFromFile(${schemaName}): ${err.message}`);
  } finally {
    if (uploadedFileId) {
      // best-effort: a failed delete must not mask the real result/error
      await getClient().files.del(uploadedFileId).catch((err) =>
        console.error("services.ai.extractFromFile: failed to delete uploaded file", { uploadedFileId, err }));
    }
  }
}

// Mock embeddings live here in code (not in test/fixtures/ai-mocks.json — that registry
// is for static canned responses; an embedding is a function of its input): deterministic
// bag-of-words hash vectors — each token is hashed into one of a fixed 256 dimensions,
// the token counts summed, and the result normalized, so token overlap ≈ cosine
// similarity. Real enough for "search finds the chunk containing the query words".
// NOTE the dimension mismatch is deliberate: mock vectors are 256-dim while the real
// model's are 1536-dim — fine, because the mock vector store in services/vector.ts
// (also gated on AI_MOCK) is the only thing that ever sees mock vectors.
const MOCK_EMBED_DIMS = 256;
function mockEmbed(text: string): number[] {
  const vector = new Array(MOCK_EMBED_DIMS).fill(0);
  for (const token of text.toLowerCase().split(/[^a-z0-9]+/).filter(Boolean)) {
    // FNV-1a over the token's chars picks its dimension
    let hash = 0x811c9dc5;
    for (let i = 0; i < token.length; i++) {
      hash ^= token.charCodeAt(i);
      hash = Math.imul(hash, 0x01000193);
    }
    vector[(hash >>> 0) % MOCK_EMBED_DIMS] += 1;
  }
  const norm = Math.sqrt(vector.reduce((sum: number, x: number) => sum + x * x, 0)) || 1;
  return vector.map((x: number) => x / norm);
}

export async function embed(texts: string[]): Promise<number[][]> {
  console.log("services.ai.embed", { count: texts.length });

  if (mock()) {
    return texts.map(mockEmbed);
  }

  try {
    // ≤ 100 inputs per API call; loop for more
    const BATCH_SIZE = 100;
    const vectors: number[][] = [];
    for (let i = 0; i < texts.length; i += BATCH_SIZE) {
      const response = await getClient().embeddings.create({
        model: MODELS.embedding,
        input: texts.slice(i, i + BATCH_SIZE),
      });
      // sort by index defensively — the API documents data[] as input-ordered, but each
      // entry carries its index, so honor it
      vectors.push(
        ...response.data
          .sort((a, b) => a.index - b.index)
          .map((d) => d.embedding)
      );
    }
    return vectors;
  } catch (err: any) {
    // wrap with context; routes turn thrown errors into 5xx JSON
    throw new Error(`services.ai.embed: ${err.message}`);
  }
}
