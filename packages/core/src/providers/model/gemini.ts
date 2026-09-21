import { GoogleGenAI } from "@google/genai";
import { z } from "zod";
import type { StructuredCallArgs, StructuredCallResult } from "./types";

let cachedClient: GoogleGenAI | null = null;

function getClient(): GoogleGenAI {
  if (!cachedClient) cachedClient = new GoogleGenAI({ apiKey: process.env.GOOGLE_AI_API_KEY });
  return cachedClient;
}

/**
 * Structured output via `responseMimeType: "application/json"` +
 * `responseSchema`. Field names confirmed against the installed
 * @google/genai package's own type declarations before writing this,
 * not assumed from memory.
 */
export async function callGeminiStructured<T>(args: StructuredCallArgs<T>): Promise<StructuredCallResult<T>> {
  const jsonSchema = z.toJSONSchema(args.schema, { target: "draft-7" });
  const client = getClient();

  const response = await client.models.generateContent({
    model: args.model,
    contents: args.prompt,
    config: {
      systemInstruction: args.system,
      responseMimeType: "application/json",
      responseSchema: jsonSchema,
    },
  });

  const text = response.text;
  if (!text) {
    throw new Error(`Gemini returned no text content for schema "${args.schemaName}"`);
  }

  return {
    data: args.schema.parse(JSON.parse(text)),
    usage: {
      inputTokens: response.usageMetadata?.promptTokenCount ?? 0,
      outputTokens: response.usageMetadata?.candidatesTokenCount ?? 0,
    },
    model: args.model,
    provider: "google",
  };
}
