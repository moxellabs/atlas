import { z } from "zod";

import { DEFAULT_HOST, DEFAULT_PORT } from "./constants";

const emptyStringToUndefined = (value: unknown) => (value === "" ? undefined : value);
const booleanEnv = z.preprocess((value) => {
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

/** Validated server-process environment. */
export interface ServerEnv {
  /** Hostname passed to Bun/Elysia listen. */
  host: string;
  /** Port passed to Bun/Elysia listen. */
  port: number;
  /** Legacy static inspector toggle. The server now redirects browser inspection to OpenAPI. */
  enableUi: boolean;
  /** Enable OpenAPI docs. */
  enableOpenApi: boolean;
  /** Enable MCP Streamable HTTP bridge. */
  enableMcp: boolean;
  /** Enable telemetry plugin. */
  enableTelemetry: boolean;
  /** Enable structured request logging. */
  logRequests: boolean;
}

const serverEnvSchema = z.object({
  ATLAS_HOST: z.preprocess(emptyStringToUndefined, z.string().trim().min(1).optional()),
  ATLAS_PORT: z.preprocess(emptyStringToUndefined, z.coerce.number().int().min(1).max(65535).optional()),
  ATLAS_ENABLE_UI: booleanEnv,
  ATLAS_ENABLE_OPENAPI: booleanEnv,
  ATLAS_ENABLE_MCP: booleanEnv,
  ATLAS_ENABLE_TELEMETRY: booleanEnv,
  ATLAS_LOG_REQUESTS: booleanEnv
});

/** Loads server-process env from Bun's already-loaded environment. */
export function loadServerEnv(env: NodeJS.ProcessEnv = process.env): ServerEnv {
  const parsed = serverEnvSchema.parse(env);
  return {
    host: parsed.ATLAS_HOST ?? DEFAULT_HOST,
    port: parsed.ATLAS_PORT ?? DEFAULT_PORT,
    enableUi: parsed.ATLAS_ENABLE_UI ?? false,
    enableOpenApi: parsed.ATLAS_ENABLE_OPENAPI ?? true,
    enableMcp: parsed.ATLAS_ENABLE_MCP ?? true,
    enableTelemetry: parsed.ATLAS_ENABLE_TELEMETRY ?? false,
    logRequests: parsed.ATLAS_LOG_REQUESTS ?? true
  };
}
