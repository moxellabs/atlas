import { z } from "zod";

export const nonEmptyStringSchema = z.string().trim().min(1);
export const repoIdParamSchema = z
	.object({ repoId: nonEmptyStringSchema })
	.strict();
export const docIdParamSchema = z
	.object({ docId: nonEmptyStringSchema })
	.strict();
export const sectionIdParamSchema = z
	.object({ docId: nonEmptyStringSchema, sectionId: nonEmptyStringSchema })
	.strict();
export const skillIdParamSchema = z
	.object({ skillId: nonEmptyStringSchema })
	.strict();
export const limitSchema = z.coerce.number().int().min(1).max(100).optional();
