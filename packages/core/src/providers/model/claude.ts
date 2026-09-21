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
export async function callClaudeStructured<T>(args: StructuredCallArgs<T>): Promise<StructuredCallResult<T>> {
  const jsonSchema = z.toJSONSchema(args.schema, { target: "draft-7" }) as Record<string, unknown>;
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
