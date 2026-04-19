import type { ResolvedAtlasConfig } from "@atlas/config";
import type { AtlasMcpServer } from "@atlas/mcp";
import type { AtlasStoreClient } from "@atlas/store";

import type { ServerEnv } from "../env";
import type { BuildOperationsService } from "./build-operations.service";
import type { McpBridgeService } from "./mcp-bridge.service";
import type { RetrievalHttpService } from "./retrieval-http.service";
import type { StoreReadService } from "./store-read.service";

/** Explicit dependency graph consumed by the Elysia app composition root. */
export interface AtlasServerDependencies {
  /** Validated process-level server environment. */
  env: ServerEnv;
  /** Resolved global ATLAS config. */
  config: ResolvedAtlasConfig;
  /** Open SQLite store client. */
  db: AtlasStoreClient;
  /** Store-backed read service for routes and presenters. */
  store: StoreReadService;
  /** Retrieval-backed query service. */
  retrieval: RetrievalHttpService;
  /** Shared sync/build orchestration adapter over the indexer package. */
  operations: BuildOperationsService;
  /** Optional MCP bridge service. */
  mcp?: McpBridgeService | undefined;
  /** Registered MCP metadata, when MCP is enabled. */
  mcpServer?: AtlasMcpServer | undefined;
  /** Refreshes config-bound runtime services after local config mutation. */
  reloadConfig(config: ResolvedAtlasConfig): void;
}
