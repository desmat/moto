import fs from "fs";
import path from "path";
import OpenAI, { toFile } from "openai";

// Single source of truth for model names — nothing else in the codebase names a model.
const MODELS = {
  // vision-capable + supports structured outputs (response_format json_schema, strict)
  vision: "gpt-4o",
  // 1536 dimensions — the Upstash Vector index must be created with cosine metric and
  // this exact dimension count (services/vector.ts assumes they match).
  embedding: "text-embedding-3-small",
};

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

export async function extractFromImage<T>({ imageUrl, prompt, schemaName, schema }: {
  imageUrl: string,   // blob URL (public-but-unguessable) — passed straight to OpenAI, no re-download
  prompt: string,
  schemaName: string, // doubles as the json_schema name and the MOCKS key
  schema: Record<string, unknown>, // plain JSON Schema (deliberately not zod — not a dependency)
}): Promise<T> {
  console.log("services.ai.extractFromImage", { schemaName, imageUrl });

  if (mock()) {
    const mocks = loadMocks();
    if (!(schemaName in mocks)) {
      throw new Error(`services.ai.extractFromImage(${schemaName}): no mock registered in test/fixtures/ai-mocks.json (AI_MOCK=true)`);
    }
    return mocks[schemaName] as T;
  }

  try {
    const completion = await getClient().chat.completions.create({
      model: MODELS.vision,
      messages: [
        {
          role: "user",
          content: [
            { type: "text", text: prompt },
            { type: "image_url", image_url: { url: imageUrl } },
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
    throw new Error(`services.ai.extractFromImage(${schemaName}): ${err.message}`);
  }
}

// Whole-file extraction (S10): upload the file to the OpenAI Files API, reference it as
// a `file` content part in a chat completion (verified against openai@4.104's types:
// ChatCompletionContentPart.File is `{ type: "file", file: { file_id } }`), and delete
// the uploaded file in a `finally` — it's a transient input, not something to accumulate
// in the org's file storage. This is the one deliberate full-document AI spend in the
// app (schedule tables in manuals mangle as raw text extraction).
export async function extractFromFile<T>({ buffer, filename, prompt, schemaName, schema }: {
  buffer: Uint8Array, // the file's bytes (already fetched — blob URLs may be data: URLs under BLOB_MOCK)
  filename: string,   // OpenAI uses the extension to sniff the file type — keep it accurate
  prompt: string,
  schemaName: string, // doubles as the json_schema name and the ai-mocks.json key
  schema: Record<string, unknown>, // plain JSON Schema (deliberately not zod — not a dependency)
}): Promise<T> {
  console.log("services.ai.extractFromFile", { schemaName, filename, size: buffer.length });

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
      model: MODELS.vision,
      // Deliberately DEFAULT temperature: temperature 0 was tried during S10b's prompt
      // tuning to tame run-to-run variance and it collapsed the schedule-table decode
      // (interval extraction fell from 22/26 rows to 4/26 — greedy decoding locked into
      // a degenerate "no distance intervals" reading of the grid). Don't re-add it
      // without re-running the eval in docs/prompt-evals/.
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
