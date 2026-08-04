import { readFileSync, statSync } from "node:fs";

import { z } from "zod";

import { DEFAULT_HOST, DEFAULT_PORT } from "./constants";

const emptyStringToUndefined = (value: unknown) =>
  value === "" ? undefined : value;
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

export interface RemoteServerEnv {
  /** Enables the authenticated remote boundary on a loopback proxy target. */
  enabled: boolean;
  /** Bearer token accepted by the remote read-only boundary. */
  token: string;
  /** Confirms an explicitly trusted reverse proxy terminates HTTPS. */
  tlsTerminated: boolean;
  /** Repositories this dedicated remote process may expose. */
  repoAllowlist: readonly string[];
  /** Per-deployment-token fixed-window request limit. */
  rateLimitPerMinute: number;
  /** Maximum serialized response size. */
  maxResponseBytes: number;
}

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
  /** Tool-advertising policy used by HTTP MCP sessions. */
  discoveryPolicy: "neutral" | "prefer-local";
  /** Default or advanced/debug MCP tool surface. */
  mcpToolProfile: "agent" | "advanced";
  /** Enable structured request logging. */
  logRequests: boolean;
  /** Remote-only security settings. Required for non-loopback binds. */
  remote?: RemoteServerEnv | undefined;
}

const serverEnvSchema = z.object({
  ATLAS_HOST: z.preprocess(
    emptyStringToUndefined,
    z.string().trim().min(1).optional(),
  ),
  ATLAS_PORT: z.preprocess(
    emptyStringToUndefined,
    z.coerce.number().int().min(1).max(65535).optional(),
  ),
  ATLAS_ENABLE_UI: booleanEnv,
  ATLAS_ENABLE_OPENAPI: booleanEnv,
  ATLAS_ENABLE_MCP: booleanEnv,
  ATLAS_ENABLE_TELEMETRY: booleanEnv,
  ATLAS_MCP_DISCOVERY_POLICY: z.enum(["neutral", "prefer-local"]).optional(),
  ATLAS_MCP_TOOL_PROFILE: z.enum(["agent", "advanced"]).optional(),
  ATLAS_LOG_REQUESTS: booleanEnv,
  ATLAS_REMOTE_AUTH_TOKEN: z.preprocess(
    emptyStringToUndefined,
    z.string().optional(),
  ),
  ATLAS_REMOTE_AUTH_TOKEN_FILE: z.preprocess(
    emptyStringToUndefined,
    z.string().optional(),
  ),
  ATLAS_REMOTE_TLS_TERMINATED: booleanEnv,
  ATLAS_REMOTE_REPO_ALLOWLIST: z.preprocess(
    emptyStringToUndefined,
    z.string().optional(),
  ),
  ATLAS_REMOTE_RATE_LIMIT_PER_MINUTE: z.preprocess(
    emptyStringToUndefined,
    z.coerce.number().int().min(1).max(10_000).optional(),
  ),
  ATLAS_REMOTE_MAX_RESPONSE_BYTES: z.preprocess(
    emptyStringToUndefined,
    z.coerce
      .number()
      .int()
      .min(1024)
      .max(50 * 1024 * 1024)
      .optional(),
  ),
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
    logRequests: parsed.ATLAS_LOG_REQUESTS ?? true,
    discoveryPolicy: parsed.ATLAS_MCP_DISCOVERY_POLICY ?? "neutral",
    mcpToolProfile: parsed.ATLAS_MCP_TOOL_PROFILE ?? "agent",
    remote: {
      enabled:
        parsed.ATLAS_REMOTE_AUTH_TOKEN !== undefined ||
        parsed.ATLAS_REMOTE_AUTH_TOKEN_FILE !== undefined ||
        parsed.ATLAS_REMOTE_TLS_TERMINATED === true ||
        parsed.ATLAS_REMOTE_REPO_ALLOWLIST !== undefined,
      token: remoteAuthToken(parsed),
      tlsTerminated: parsed.ATLAS_REMOTE_TLS_TERMINATED ?? false,
      repoAllowlist: (parsed.ATLAS_REMOTE_REPO_ALLOWLIST ?? "")
        .split(",")
        .map((repoId) => repoId.trim())
        .filter((repoId) => repoId.length > 0),
      rateLimitPerMinute: parsed.ATLAS_REMOTE_RATE_LIMIT_PER_MINUTE ?? 120,
      maxResponseBytes:
        parsed.ATLAS_REMOTE_MAX_RESPONSE_BYTES ?? 2 * 1024 * 1024,
    },
  };
}

function remoteAuthToken(parsed: z.infer<typeof serverEnvSchema>): string {
  const direct = parsed.ATLAS_REMOTE_AUTH_TOKEN;
  const file = parsed.ATLAS_REMOTE_AUTH_TOKEN_FILE;
  if (direct !== undefined && file !== undefined)
    throw new Error(
      "Set only one of ATLAS_REMOTE_AUTH_TOKEN or ATLAS_REMOTE_AUTH_TOKEN_FILE.",
    );
  if (file === undefined) return direct ?? "";
  const metadata = statSync(file);
  if (!metadata.isFile())
    throw new Error(`ATLAS_REMOTE_AUTH_TOKEN_FILE is not a file: ${file}.`);
  if ((metadata.mode & 0o077) !== 0)
    throw new Error(
      `ATLAS_REMOTE_AUTH_TOKEN_FILE must not be group- or world-accessible: ${file}.`,
    );
  return readFileSync(file, "utf8").trim();
}
