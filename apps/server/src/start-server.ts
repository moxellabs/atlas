import { createApp } from "./app";
import type { ServerEnv } from "./env";
import { loadServerEnv } from "./env";
import { buildServerDependencies, closeServerDependencies, type ResolvedAtlasConfig } from "./services/dependencies";

/** Running ATLAS server handle returned to the CLI and the standalone entrypoint. */
export interface AtlasRunningServer {
  /** Bound hostname. */
  host: string;
  /** Bound port. */
  port: number;
  /** Effective corpus store path. */
  dbPath: string;
  /** Number of configured repositories. */
  repoCount: number;
  /** Whether OpenAPI is enabled. */
  openApiEnabled: boolean;
  /** Whether MCP is enabled. */
  mcpEnabled: boolean;
  /** Whether the legacy UI toggle is enabled. */
  uiEnabled: boolean;
  /** Stops the server and closes owned dependencies. */
  stop(): void;
}

/** Starts the ATLAS HTTP server from reusable boot primitives. */
export async function startAtlasServer(options: {
  env?: ServerEnv | undefined;
  config?: ResolvedAtlasConfig | undefined;
} = {}): Promise<AtlasRunningServer> {
  const env = options.env ?? loadServerEnv();
  const dependencies = await buildServerDependencies(env, options.config);
  const app = createApp(dependencies).listen({
    hostname: dependencies.env.host,
    port: dependencies.env.port
  });

  return {
    host: app.server?.hostname ?? dependencies.env.host,
    port: app.server?.port ?? dependencies.env.port,
    dbPath: dependencies.config.config.corpusDbPath,
    repoCount: dependencies.config.config.repos.length,
    openApiEnabled: dependencies.env.enableOpenApi,
    mcpEnabled: dependencies.env.enableMcp,
    uiEnabled: dependencies.env.enableUi,
    stop(): void {
      app.stop();
      closeServerDependencies(dependencies);
    }
  };
}
