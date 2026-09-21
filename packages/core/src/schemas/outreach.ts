import { z } from "zod";

/**
 * Outreach draft shapes. Unlike icp.ts / qualification.ts / validation.ts,
 * assets/outbound-copywriting-guide.md does not publish a fenced JSON
 * block to contract-test against - it specifies the required output in
 * prose ("Required Output": a 3-step email sequence, each step with
 * Subject line / Email body / Personalization note; optionally a short
 * LinkedIn message) and SYSTEM-DESIGN-NEXTJS.md §16's `outreach_drafts`
 * table. This schema is written directly from those two sources.
 *
 * Modeled as a discriminated union on `channel` rather than one object
 * with optional fields, because the guide's own rules differ by channel:
 * an email step always has a subject line, a LinkedIn message never does
 * (the PRD calls for "a short LinkedIn message", not a subject + body).
 * Loosening this to `subject: z.string().optional()` on a single shape
 * would let a LinkedIn draft carry a subject or an email draft omit one,
 * which the guide never allows.
 */

const PersonalizationNote = z
  .string()
  .min(1, "Personalization must reference real company context, not be left blank");

export const EmailStepSchema = z.object({
  channel: z.literal("email"),
  /** 1, 2, or 3 - assets/outbound-copywriting-guide.md's fixed 3-step sequence. */
  step: z.union([z.literal(1), z.literal(2), z.literal(3)]),
  subject: z.string().min(1),
  body: z.string().min(1),
  personalization_note: PersonalizationNote,
});

export const LinkedInMessageSchema = z.object({
  channel: z.literal("linkedin"),
  step: z.literal(1),
  body: z.string().min(1),
  personalization_note: PersonalizationNote,
});

export const OutreachDraftSchema = z.discriminatedUnion("channel", [
  EmailStepSchema,
  LinkedInMessageSchema,
]);

/** A qualified lead's full outreach output: 3 email steps + 1 LinkedIn message. */
export const OutreachSequenceSchema = z.object({
  emails: z.tuple([EmailStepSchema, EmailStepSchema, EmailStepSchema]),
  linkedin: LinkedInMessageSchema,
});

export type EmailStep = z.infer<typeof EmailStepSchema>;
export type LinkedInMessage = z.infer<typeof LinkedInMessageSchema>;
export type OutreachDraft = z.infer<typeof OutreachDraftSchema>;
export type OutreachSequence = z.infer<typeof OutreachSequenceSchema>;
