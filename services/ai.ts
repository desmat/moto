import fs from "fs";
import path from "path";
import OpenAI from "openai";

// Single source of truth for model names — nothing else in the codebase names a model.
const MODELS = {
  // vision-capable + supports structured outputs (response_format json_schema, strict)
  vision: "gpt-4o",
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
