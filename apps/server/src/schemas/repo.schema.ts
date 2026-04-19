import { z } from "zod";
import { atlasRepoConfigSchema } from "@atlas/config";

import { limitSchema, nonEmptyStringSchema } from "./common.schema";

export const repoMutationBodySchema = atlasRepoConfigSchema;

export const listSkillsQuerySchema = z
  .object({
    repoId: nonEmptyStringSchema.optional(),
    packageId: nonEmptyStringSchema.optional(),
    moduleId: nonEmptyStringSchema.optional(),
    limit: limitSchema
  })
  .strict();

export const inspectRetrievalQuerySchema = z
  .object({
    query: nonEmptyStringSchema,
    repoId: nonEmptyStringSchema.optional(),
    budgetTokens: z.coerce.number().int().min(1).max(200_000).default(2_000)
  })
  .strict();

export type ListSkillsQuery = z.infer<typeof listSkillsQuerySchema>;
export type InspectRetrievalQuery = z.infer<typeof inspectRetrievalQuerySchema>;
export type RepoMutationBody = z.infer<typeof repoMutationBodySchema>;
