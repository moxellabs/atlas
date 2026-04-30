import {
	atlasDocAudienceSchema,
	atlasDocPurposeSchema,
	atlasDocVisibilitySchema,
} from "@atlas/config";
import { z } from "zod";

import { limitSchema, nonEmptyStringSchema } from "./common.schema";

export const metadataFiltersSchema = z.object({
	profile: nonEmptyStringSchema.optional(),
	audience: z.array(atlasDocAudienceSchema).max(10).optional(),
	purpose: z.array(atlasDocPurposeSchema).max(10).optional(),
	visibility: z.array(atlasDocVisibilitySchema).max(2).optional(),
});

export const findScopesBodySchema = z
	.object({
		query: nonEmptyStringSchema,
		repoId: nonEmptyStringSchema.optional(),
		limit: limitSchema,
		...metadataFiltersSchema.shape,
	})
	.strict();

export const findDocsBodySchema = z
	.object({
		query: nonEmptyStringSchema,
		repoId: nonEmptyStringSchema.optional(),
		scopeIds: z.array(nonEmptyStringSchema).max(20).optional(),
		kinds: z
			.array(
				z.enum([
					"repo-doc",
					"package-doc",
					"module-doc",
					"skill-doc",
					"guide-doc",
					"reference-doc",
				]),
			)
			.max(10)
			.optional(),
		limit: limitSchema,
		...metadataFiltersSchema.shape,
	})
	.strict();

export type FindScopesBody = z.infer<typeof findScopesBodySchema>;
export type FindDocsBody = z.infer<typeof findDocsBodySchema>;
