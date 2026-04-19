import { z } from "zod";

import { nonEmptyStringSchema } from "./common.schema";

export const readSectionByHeadingQuerySchema = z
  .object({
    heading: z.union([nonEmptyStringSchema, z.array(nonEmptyStringSchema).min(1)])
  })
  .strict()
  .transform((query) => ({
    heading: Array.isArray(query.heading) ? query.heading : [query.heading]
  }));

export type ReadSectionByHeadingQuery = z.infer<typeof readSectionByHeadingQuerySchema>;
