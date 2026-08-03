import type { SourceChange } from "@atlas/core";
import type { StoreDatabase } from "@atlas/store";
import type { RetrievalStore } from "@atlas/retrieval";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";

/** Dependencies injected into all MCP tools and resources. */
export interface AtlasMcpIdentity {
  name?: string | undefined;
  title?: string | undefined;
  resourcePrefix?: string | undefined;
}
export const ATLAS_MCP_DISCOVERY_POLICIES = [
  "neutral",
  "prefer-local",
] as const;

export type AtlasMcpDiscoveryPolicy =
  (typeof ATLAS_MCP_DISCOVERY_POLICIES)[number];

export type AtlasMcpExposurePolicy = "full" | "bounded-remote";

export interface AtlasMcpDependencies {
  /** Initialized ATLAS store database. */
  db: StoreDatabase;
  /** Optional MCP identity override for metadata, resources, and skill aliases. */
  identity?: AtlasMcpIdentity | undefined;
  /** Client-visible discovery guidance; neutral never directs tool selection. */
  discoveryPolicy?: AtlasMcpDiscoveryPolicy | undefined;
  /** Controls whether aggregate resources and tools are exposed. */
  exposurePolicy?: AtlasMcpExposurePolicy | undefined;
  /** Optional source-backed diff provider used by what_changed in full runtimes. */
  sourceDiffProvider?: AtlasSourceDiffProvider | undefined;
}

/** MCP dependency view required by retrieval-backed tools. */
export interface AtlasRetrievalMcpDependencies extends AtlasMcpDependencies {
  retrievalStore: RetrievalStore;
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
  /** Rebuilds source-specific discovery surfaces after the local corpus changes. */
  refreshDiscovery: () => boolean;
}

/** Standard JSON object returned as MCP structured content. */
export type McpJsonObject = Record<string, unknown>;
