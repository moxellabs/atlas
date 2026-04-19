import { z } from "zod";

import { limitSchema, nonEmptyStringSchema } from "./common.schema";

export const planContextBodySchema = z
  .object({
    query: nonEmptyStringSchema,
    repoId: nonEmptyStringSchema.optional(),
    budgetTokens: z.number().int().min(1).max(200_000).default(2_000),
    candidateLimit: limitSchema,
    summaryLimit: limitSchema,
    expansionLimit: limitSchema
  })
  .strict();

export type PlanContextBody = z.infer<typeof planContextBodySchema>;
