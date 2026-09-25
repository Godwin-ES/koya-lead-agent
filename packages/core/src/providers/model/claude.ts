import Anthropic from "@anthropic-ai/sdk";
import { z } from "zod";
import type { StructuredCallArgs, StructuredCallResult } from "./types";

let cachedClient: Anthropic | null = null;

function getClient(): Anthropic {
  // Reads ANTHROPIC_API_KEY from the environment - never hardcoded, and
  // never present in the browser (worker-only, per SYSTEM-DESIGN-NEXTJS.md §15).
  if (!cachedClient) cachedClient = new Anthropic();
  return cachedClient;
}

/**
 * Structured output via a single forced tool call with `strict: true`
 * (guarantees `tool_use.input` validates exactly against the JSON schema,
 * no beta header needed). Re-validated through the original Zod schema
 * on top of that - `strict` guarantees JSON-schema-shape correctness,
 * but Zod refinements (`.min()`, `.url()`, enum membership, etc.) can be
 * stricter than what JSON Schema alone expresses.
 */
/**
 * Keywords strict tool schemas reject. Found live when the objective check
 * first ran on Claude in production (it had only run on Gemini): "For
 * 'number' type, properties maximum, minimum are not supported" - from
 * `confidence: z.number().min(0).max(1)`. They're dropped from what's sent
 * only; the Zod parse below still enforces every one of them.
 */
const UNSUPPORTED_IN_STRICT = new Set(["minimum", "maximum", "exclusiveMinimum", "exclusiveMaximum", "multipleOf", "minLength", "maxLength", "maxItems"]);

export function toStrictToolSchema(node: unknown): unknown {
  if (Array.isArray(node)) return node.map(toStrictToolSchema);
  if (!node || typeof node !== "object") return node;
  const out: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(node as Record<string, unknown>)) {
    if (UNSUPPORTED_IN_STRICT.has(key)) continue;
    // Only minItems of 0 or 1 is supported.
    if (key === "minItems" && typeof value === "number" && value > 1) continue;
    out[key] = toStrictToolSchema(value);
  }
  return out;
}

/** The JSON schema sent as a strict tool's input_schema, from a Zod schema. */
export function strictToolSchemaFor(schema: z.ZodType): Record<string, unknown> {
  return toStrictToolSchema(z.toJSONSchema(schema, { target: "draft-7" })) as Record<string, unknown>;
}

export async function callClaudeStructured<T>(args: StructuredCallArgs<T>): Promise<StructuredCallResult<T>> {
  const jsonSchema = strictToolSchemaFor(args.schema);
  const client = getClient();

  const response = await client.messages.create({
    model: args.model,
    max_tokens: 4096,
    system: args.system,
    messages: [{ role: "user", content: args.prompt }],
    tools: [
      {
        name: args.schemaName,
        description: `Return the ${args.schemaName} result as structured data.`,
        input_schema: jsonSchema as Anthropic.Messages.Tool.InputSchema,
        strict: true,
      },
    ],
    tool_choice: { type: "tool", name: args.schemaName },
  });

  const toolUse = response.content.find(
    (block): block is Anthropic.Messages.ToolUseBlock => block.type === "tool_use",
  );
  if (!toolUse) {
    throw new Error(`Claude did not return a tool_use block for schema "${args.schemaName}"`);
  }

  return {
    data: args.schema.parse(toolUse.input),
    usage: { inputTokens: response.usage.input_tokens, outputTokens: response.usage.output_tokens },
    model: args.model,
    provider: "anthropic",
  };
}
