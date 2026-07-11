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

// Canned responses for AI_MOCK, keyed by schemaName. Each story registers its schema's
// mock here (S6 adds "odometer"). A test hitting an unmocked schema is a bug → throw.
const MOCKS: Record<string, any> = {
  odometer: { odometer_digits_clearly_visible: true, reading: 12345, unit: "km", confidence: "high" },
};

export async function extractFromImage<T>({ imageUrl, prompt, schemaName, schema }: {
  imageUrl: string,   // blob URL (public-but-unguessable) — passed straight to OpenAI, no re-download
  prompt: string,
  schemaName: string, // doubles as the json_schema name and the MOCKS key
  schema: Record<string, unknown>, // plain JSON Schema (deliberately not zod — not a dependency)
}): Promise<T> {
  console.log("services.ai.extractFromImage", { schemaName, imageUrl });

  if (mock()) {
    if (!(schemaName in MOCKS)) {
      throw new Error(`services.ai.extractFromImage(${schemaName}): no mock registered (AI_MOCK=true)`);
    }
    return MOCKS[schemaName] as T;
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
