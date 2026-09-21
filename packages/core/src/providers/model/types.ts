import type { ZodType } from "zod";

/**
 * Both adapters (claude.ts, gemini.ts) implement this same shape so
 * callers (cheap-model.ts, and later the agent runners) never branch on
 * provider - they call callStructured and get back validated data plus
 * usage, regardless of which model answered.
 */
export interface StructuredCallArgs<T> {
  prompt: string;
  schema: ZodType<T>;
  /** Used as the Claude tool name / a label in the Gemini call - keep it a short identifier, e.g. "icp", "qualification". */
  schemaName: string;
  system?: string;
  model: string;
}

export interface ModelUsage {
  inputTokens: number;
  outputTokens: number;
}

export interface StructuredCallResult<T> {
  data: T;
  usage: ModelUsage;
  model: string;
  provider: "anthropic" | "google";
}

export type StructuredCaller = <T>(args: StructuredCallArgs<T>) => Promise<StructuredCallResult<T>>;
