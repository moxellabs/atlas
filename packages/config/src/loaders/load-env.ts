import { ZodError } from "zod";

import { atlasEnvSchema, normalizeEnvInput, type AtlasEnv } from "../env.schema";

export class AtlasEnvValidationError extends Error {
  readonly code = "ATLAS_ENV_VALIDATION_FAILED";
  readonly issues: string[];

  constructor(issues: string[], options?: ErrorOptions) {
    super(`Invalid ATLAS environment: ${issues.join("; ")}`, options);
    this.name = "AtlasEnvValidationError";
    this.issues = issues;
  }
}

const formatEnvIssues = (error: ZodError): string[] =>
  error.issues.map((issue) => {
    const path = issue.path.join(".");

    return path.length > 0 ? `${path}: ${issue.message}` : issue.message;
  });

export const loadEnv = async (env: NodeJS.ProcessEnv = process.env): Promise<AtlasEnv> => {
  const result = atlasEnvSchema.safeParse(normalizeEnvInput(env));

  if (!result.success) {
    throw new AtlasEnvValidationError(formatEnvIssues(result.error), { cause: result.error });
  }

  return result.data;
};
