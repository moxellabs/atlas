import { z } from "zod";

import { nonEmptyStringSchema } from "./common.schema";

export const syncBodySchema = z
	.object({
		repoId: nonEmptyStringSchema.optional(),
		mode: z.enum(["incremental", "full"]).optional(),
		dryRun: z.boolean().optional(),
	})
	.strict();

export const buildBodySchema = z
	.object({
		repoId: nonEmptyStringSchema.optional(),
		mode: z.enum(["incremental", "full"]).optional(),
		force: z.boolean().optional(),
		docIds: z.array(nonEmptyStringSchema).optional(),
		packageId: nonEmptyStringSchema.optional(),
		moduleId: nonEmptyStringSchema.optional(),
	})
	.strict();
