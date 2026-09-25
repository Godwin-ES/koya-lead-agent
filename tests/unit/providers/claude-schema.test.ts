import { describe, expect, it } from "vitest";
import { strictToolSchemaFor, toStrictToolSchema } from "@core/providers/model/claude";
import { ValidationVerdictSchema } from "@core/schemas/validation";

// Live: the objective check's first Claude call was rejected - "For 'number'
// type, properties maximum, minimum are not supported" (strict tool schema).
describe("strict tool schemas", () => {
  it("drop the limits strict tools reject, keeping the shape", () => {
    const schema = toStrictToolSchema({
      type: "object",
      properties: {
        confidence: { type: "number", minimum: 0, maximum: 1 },
        name: { type: "string", minLength: 1, maxLength: 40 },
        tags: { type: "array", items: { type: "string" }, minItems: 2, maxItems: 5 },
        optional: { type: "array", items: { type: "string" }, minItems: 1 },
      },
      additionalProperties: false,
    }) as { properties: Record<string, Record<string, unknown>> };
    expect(schema.properties.confidence).toEqual({ type: "number" });
    expect(schema.properties.name).toEqual({ type: "string" });
    expect(schema.properties.tags).toEqual({ type: "array", items: { type: "string" } });
    expect(schema.properties.optional).toEqual({ type: "array", items: { type: "string" }, minItems: 1 });
  });

  it("leave nothing unsupported in the objective check's schema", () => {
    expect(JSON.stringify(strictToolSchemaFor(ValidationVerdictSchema))).not.toMatch(/"(minimum|maximum|minLength|maxLength|maxItems)"/);
  });
});
