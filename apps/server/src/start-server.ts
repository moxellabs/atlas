import { node } from "@elysia/node";
import { createApp } from "./app";
import type { ServerEnv } from "./env";
import { loadServerEnv } from "./env";
import {
  buildServerDependencies,
  closeServerDependencies,
  type ResolvedAtlasConfig,
} from "./services/dependencies";
import {
  assertRemoteExposureSafe,
  MAX_HTTP_REQUEST_BODY_BYTES,
} from "./services/remote-security.service";

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
  stop(): void | Promise<void>;
}

/** Starts the ATLAS HTTP server from reusable boot primitives. */
export async function startAtlasServer(
  options: {
    env?: ServerEnv | undefined;
    config?: ResolvedAtlasConfig | undefined;
  } = {},
): Promise<AtlasRunningServer> {
  const env = options.env ?? loadServerEnv();
  const dependencies = await buildServerDependencies(env, options.config);
  try {
    assertRemoteExposureSafe(
      dependencies.env,
      dependencies.config,
      dependencies.store.listRepos().map(({ repo }) => repo.repoId),
    );
  } catch (error) {
    await closeServerDependencies(dependencies);
    throw error;
  }

  const app = createApp(
    dependencies,
    typeof Bun === "undefined" ? node() : undefined,
  );
  let listeningServer:
    | {
        readonly hostname?: string | undefined;
        readonly port?: number | undefined;
        readonly raw?: { ready(): Promise<unknown> } | undefined;
        stop(closeActiveConnections?: boolean): unknown;
      }
    | undefined;
  try {
    app.listen(
      {
        hostname: dependencies.env.host,
        port: dependencies.env.port,
        maxRequestBodySize: MAX_HTTP_REQUEST_BODY_BYTES,
      },
      (server) => {
        listeningServer = server;
      },
    );
    if (listeningServer === undefined) {
      throw new Error(
        "ATLAS server adapter did not return a listening server.",
      );
    }
    await listeningServer.raw?.ready();
  } catch (error) {
    try {
      await listeningServer?.stop(true);
    } finally {
      await closeServerDependencies(dependencies);
    }
    throw error;
  }
  const boundServer = listeningServer;

  let stopped = false;
  return {
    host: boundServer.hostname ?? dependencies.env.host,
    port: boundServer.port ?? dependencies.env.port,
    dbPath: dependencies.config.config.corpusDbPath,
    repoCount: dependencies.config.config.repos.length,
    openApiEnabled: dependencies.env.enableOpenApi,
    mcpEnabled: dependencies.env.enableMcp,
    uiEnabled: dependencies.env.enableUi,
    async stop() {
      if (stopped) return;
      stopped = true;
      try {
        await boundServer.stop();
      } finally {
        await closeServerDependencies(dependencies);
      }
    },
  };
}
