import type { SourceChange } from "@atlas/core";
import type { StoreDatabase } from "@atlas/store";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { z } from "zod";

/** Dependencies injected into all MCP tools and resources. */
export interface AtlasMcpIdentity {
  name?: string | undefined;
  title?: string | undefined;
  resourcePrefix?: string | undefined;
}

export interface AtlasMcpDependencies {
  /** Initialized ATLAS store database. */
  db: StoreDatabase;
  /** Optional MCP identity override for metadata, resources, and skill aliases. */
  identity?: AtlasMcpIdentity | undefined;
  /** Optional source-backed diff provider used by what_changed in full runtimes. */
  sourceDiffProvider?: AtlasSourceDiffProvider | undefined;
}

/** Read-only source diff request issued by MCP. */
export interface AtlasSourceDiffRequest {
  repoId: string;
  fromRevision: string;
  toRevision: string;
}

/** Source diff payload returned by a runtime-specific provider. */
export interface AtlasSourceDiffResult {
  repoId: string;
  fromRevision: string;
  toRevision: string;
  changes: SourceChange[];
  relevantChanges: SourceChange[];
  relevantDocPaths: string[];
  topologySensitivePaths: string[];
  packageManifestPaths: string[];
  fullRebuildRequired?: boolean | undefined;
  fullRebuildReason?: string | undefined;
}

/** Runtime boundary for source-backed diffing without coupling MCP to source packages. */
export interface AtlasSourceDiffProvider {
  diff(request: AtlasSourceDiffRequest): Promise<AtlasSourceDiffResult>;
}

/** One registered MCP surface diagnostic. */
export interface AtlasMcpDiagnostic {
  /** Stage or surface category that emitted the diagnostic. */
  stage: "server" | "tool" | "resource" | "prompt" | "transport";
  /** Human-readable message. */
  message: string;
  /** Optional structured metadata for tests and inspect surfaces. */
  metadata?: Record<string, unknown> | undefined;
}

/** Result returned by the MCP composition root. */
export interface AtlasMcpServer {
  /** SDK MCP server instance. */
  server: McpServer;
  /** Names of tools registered by the package. */
  tools: string[];
  /** Names of resources registered by the package. */
  resources: string[];
  /** Names of prompts registered by the package. */
  prompts: string[];
  /** Registration diagnostics. */
  diagnostics: AtlasMcpDiagnostic[];
}

/** Standard JSON object returned as MCP structured content. */
export type McpJsonObject = Record<string, unknown>;

/** Convenience type for inferred Zod object schemas. */
export type InferSchema<T extends z.ZodType> = z.infer<T>;
