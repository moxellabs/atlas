import { z } from "zod";

export const nonEmptyStringSchema = z.string().trim().min(1);
export const repoIdParamSchema = z.object({ repoId: nonEmptyStringSchema }).strict();
export const docIdParamSchema = z.object({ docId: nonEmptyStringSchema }).strict();
export const sectionIdParamSchema = z.object({ docId: nonEmptyStringSchema, sectionId: nonEmptyStringSchema }).strict();
export const skillIdParamSchema = z.object({ skillId: nonEmptyStringSchema }).strict();
export const limitSchema = z.coerce.number().int().min(1).max(100).optional();
export const booleanQuerySchema = z.preprocess((value) => {
  if (value === undefined || value === "") {
    return undefined;
  }
  if (typeof value !== "string") {
    return value;
  }
  if (["1", "true", "yes", "on"].includes(value.toLowerCase())) {
    return true;
  }
  if (["0", "false", "no", "off"].includes(value.toLowerCase())) {
    return false;
  }
  return value;
}, z.boolean().optional());
