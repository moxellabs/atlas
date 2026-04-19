import { z } from "zod";

const emptyStringToUndefined = (value: unknown) =>
	value === "" ? undefined : value;

export const logLevelSchema = z.enum(["debug", "info", "warn", "error"]);

export const atlasEnvSchema = z.object({
	ATLAS_CONFIG: z.preprocess(
		emptyStringToUndefined,
		z.string().trim().min(1).optional(),
	),
	ATLAS_CACHE_DIR: z.preprocess(
		emptyStringToUndefined,
		z.string().trim().min(1).optional(),
	),
	ATLAS_IDENTITY_ROOT: z.preprocess(
		emptyStringToUndefined,
		z.string().trim().min(1).optional(),
	),
	ATLAS_MCP_NAME: z.preprocess(
		emptyStringToUndefined,
		z.string().trim().min(1).optional(),
	),
	ATLAS_MCP_TITLE: z.preprocess(
		emptyStringToUndefined,
		z.string().trim().min(1).optional(),
	),
	ATLAS_LOG_LEVEL: z.preprocess(
		emptyStringToUndefined,
		logLevelSchema.optional(),
	),
	ATLAS_CA_CERT_PATH: z.preprocess(
		emptyStringToUndefined,
		z.string().trim().min(1).optional(),
	),
	GHES_TOKEN: z.preprocess(
		emptyStringToUndefined,
		z.string().trim().min(1).optional(),
	),
	NODE_ENV: z.preprocess(
		emptyStringToUndefined,
		z.string().trim().min(1).optional(),
	),
});

export type AtlasEnv = z.infer<typeof atlasEnvSchema>;

export const normalizeEnvInput = (
	env: NodeJS.ProcessEnv,
): Record<string, string | undefined> => ({
	ATLAS_CONFIG: env.ATLAS_CONFIG,
	ATLAS_CACHE_DIR: env.ATLAS_CACHE_DIR,
	ATLAS_IDENTITY_ROOT: env.ATLAS_IDENTITY_ROOT,
	ATLAS_MCP_NAME: env.ATLAS_MCP_NAME,
	ATLAS_MCP_TITLE: env.ATLAS_MCP_TITLE,
	ATLAS_LOG_LEVEL: env.ATLAS_LOG_LEVEL,
	ATLAS_CA_CERT_PATH: env.ATLAS_CA_CERT_PATH,
	GHES_TOKEN: env.GHES_TOKEN,
	NODE_ENV: env.NODE_ENV,
});
