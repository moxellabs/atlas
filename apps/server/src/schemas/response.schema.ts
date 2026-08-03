import { z } from "zod";

export const requestIdSchema = z
  .string()
  .describe("Caller supplied x-request-id header, or 'local' when omitted.");

export const apiFailureSchema = z
  .object({
    ok: z.literal(false),
    requestId: requestIdSchema,
    error: z.object({
      code: z.string(),
      message: z.string(),
      details: z.unknown().optional(),
    }),
  })
  .strict();

export const apiSuccessSchema = z
  .object({
    ok: z.literal(true),
    requestId: requestIdSchema,
    data: z.unknown(),
  })
  .strict();
