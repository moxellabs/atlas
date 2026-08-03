import { z } from "zod";

import { nonEmptyStringSchema } from "./common.schema";

export const headingQuerySchema = z.union([
	nonEmptyStringSchema,
	z.array(nonEmptyStringSchema).min(1),
]);

export const readSectionByHeadingQuerySchema = z
	.object({ heading: headingQuerySchema })
	.strict()
	.transform((query) => ({
		heading: Array.isArray(query.heading) ? query.heading : [query.heading],
	}));

export type ReadSectionByHeadingQuery = z.infer<typeof readSectionByHeadingQuerySchema>;
