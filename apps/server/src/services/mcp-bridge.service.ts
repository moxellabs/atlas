import type { RepositoryRefreshStateProvider } from "@atlas/core";
import {
  createAtlasMcpServer,
  createWebStandardStreamableHttpTransport,
} from "@atlas/mcp";
import type {
  AtlasMcpIdentity,
  AtlasMcpExposurePolicy,
  AtlasMcpServer,
  AtlasMcpDiscoveryPolicy,
} from "@atlas/mcp";
import type { AtlasStoreClient } from "@atlas/store";

import { ServerDependencyError } from "../errors";

const DEFAULT_SESSION_IDLE_TIMEOUT_MS = 30 * 60 * 1000;
const DEFAULT_MAX_SESSIONS = 32;
type McpBridgeTransport = ReturnType<
  typeof createWebStandardStreamableHttpTransport
>;

interface McpBridgeSession {
  readonly server: AtlasMcpServer;
  readonly transport: McpBridgeTransport;
  lastSeenAt: number;
  sessionId?: string | undefined;
  disposing?: Promise<void> | undefined;
}

/** Bun/Web-standard MCP bridge hosted by the server app under /mcp. */
export class McpBridgeService {
  private catalogServer: AtlasMcpServer | undefined;
  private readonly sessions = new Map<string, McpBridgeSession>();
  private readonly db: AtlasStoreClient;
  private readonly repositoryRefreshStateProvider?:
    | RepositoryRefreshStateProvider
    | undefined;
  private readonly identity?: AtlasMcpIdentity | undefined;
  private initializationTail: Promise<void> = Promise.resolve();
  private readonly discoveryPolicy: AtlasMcpDiscoveryPolicy;
  private readonly exposurePolicy: AtlasMcpExposurePolicy;
  private closed = false;

  constructor(
    db: AtlasStoreClient,
    repositoryRefreshStateProvider?: RepositoryRefreshStateProvider | undefined,
    identity?: AtlasMcpIdentity | undefined,
    discoveryPolicy: AtlasMcpDiscoveryPolicy = "neutral",
    exposurePolicy: AtlasMcpExposurePolicy = "full",
  ) {
    this.db = db;
    this.repositoryRefreshStateProvider = repositoryRefreshStateProvider;
    this.identity = identity;
    this.discoveryPolicy = discoveryPolicy;
    this.exposurePolicy = exposurePolicy;
  }

  /**
   * Lazy diagnostic/catalog server. Request handling uses per-session servers.
   * Kept for compatibility with dependencies that expose `mcpServer` metadata.
   */
  get atlasMcpServer(): AtlasMcpServer {
    if (this.catalogServer === undefined) {
      this.catalogServer = this.createServer();
    }
    return this.catalogServer;
  }

  /** Handles a single Web Request using the MCP Streamable HTTP transport. */
  async handle(request: Request): Promise<Response> {
    if (this.closed) {
      return jsonRpcErrorResponse(503, -32000, "MCP bridge is closed");
    }
    try {
      this.refreshDiscovery();
      await this.sweepIdleSessions(Date.now());

      const sessionId = request.headers.get("mcp-session-id");
      if (sessionId !== null && sessionId.length > 0) {
        return await this.handleSessionRequest(request, sessionId);
      }

      return await this.handleInitializationRequest(request);
    } catch (error) {
      throw new ServerDependencyError("MCP bridge request failed.", {
        operation: "mcpBridge",
        entity: "mcp",
        cause: error,
      });
    }
  }

  /** Disposes every live session. Safe to call during config reload or shutdown. */
  async close(): Promise<void> {
    this.closed = true;
    await this.initializationTail;
    const sessionIds = [...this.sessions.keys()];
    await Promise.all(
      sessionIds.map((sessionId) => this.disposeSession(sessionId)),
    );
    this.sessions.clear();
    this.catalogServer = undefined;
  }

  private async handleInitializationRequest(
    request: Request,
  ): Promise<Response> {
    const gate = Promise.withResolvers<void>();
    const previous = this.initializationTail;
    this.initializationTail = gate.promise;
    await previous;
    try {
      if (this.closed)
        return jsonRpcErrorResponse(503, -32000, "MCP bridge is closed");
      await this.enforceSessionLimit();

      let initializedSessionId: string | undefined;
      let session!: McpBridgeSession;
      session = await this.createSession((sessionId) => {
        initializedSessionId = sessionId;
        session.sessionId = sessionId;
        session.lastSeenAt = Date.now();
        this.sessions.set(sessionId, session);
      });

      try {
        const response = await session.transport.handleRequest(request);
        if (response.ok && initializedSessionId !== undefined) {
          session.lastSeenAt = Date.now();
          return response;
        }
        await this.disposeSessionInstance(session, initializedSessionId);
        return response;
      } catch (error) {
        await this.disposeSessionInstance(session, initializedSessionId);
        throw error;
      }
    } finally {
      gate.resolve();
    }
  }

  private async handleSessionRequest(
    request: Request,
    sessionId: string,
  ): Promise<Response> {
    const session = this.sessions.get(sessionId);
    if (session === undefined) {
      return jsonRpcErrorResponse(404, -32001, "Session not found");
    }

    session.lastSeenAt = Date.now();
    const response = await session.transport.handleRequest(request);
    session.lastSeenAt = Date.now();
    if (request.method === "DELETE" && response.ok) {
      await this.disposeSession(sessionId);
    }
    return response;
  }

  private async createSession(
    onsessioninitialized: (sessionId: string) => void,
  ): Promise<McpBridgeSession> {
    const server = this.createServer();
    const transport = createWebStandardStreamableHttpTransport({
      enableJsonResponse: true,
      sessionIdGenerator: () => crypto.randomUUID(),
      onsessioninitialized,
      onsessionclosed: (sessionId) => {
        void this.disposeSession(sessionId);
      },
    });
    await server.server.connect(transport);
    return {
      server,
      transport,
      lastSeenAt: Date.now(),
    };
  }

  private createServer(): AtlasMcpServer {
    return createAtlasMcpServer({
      db: this.db,
      ...(this.identity === undefined ? {} : { identity: this.identity }),
      discoveryPolicy: this.discoveryPolicy,
      exposurePolicy: this.exposurePolicy,
      ...(this.repositoryRefreshStateProvider === undefined
        ? {}
        : {
            repositoryRefreshStateProvider: this.repositoryRefreshStateProvider,
          }),
    });
  }

  refreshDiscovery(): void {
    this.catalogServer?.refreshDiscovery();
    for (const session of this.sessions.values()) {
      session.server.refreshDiscovery();
    }
  }

  private async sweepIdleSessions(now: number): Promise<void> {
    const expired: string[] = [];
    for (const [sessionId, session] of this.sessions.entries()) {
      if (now - session.lastSeenAt > DEFAULT_SESSION_IDLE_TIMEOUT_MS) {
        expired.push(sessionId);
      }
    }
    await Promise.all(
      expired.map((sessionId) => this.disposeSession(sessionId)),
    );
  }

  private async enforceSessionLimit(): Promise<void> {
    if (this.sessions.size < DEFAULT_MAX_SESSIONS) {
      return;
    }
    let oldestId: string | undefined;
    let oldestSeen = Number.POSITIVE_INFINITY;
    for (const [sessionId, session] of this.sessions.entries()) {
      if (session.lastSeenAt < oldestSeen) {
        oldestSeen = session.lastSeenAt;
        oldestId = sessionId;
      }
    }
    if (oldestId !== undefined) {
      await this.disposeSession(oldestId);
    }
  }

  private async disposeSession(sessionId: string): Promise<void> {
    const session = this.sessions.get(sessionId);
    if (session === undefined) {
      return;
    }
    this.sessions.delete(sessionId);
    await this.disposeSessionInstance(session, sessionId);
  }

  private async disposeSessionInstance(
    session: McpBridgeSession,
    sessionId: string | undefined,
  ): Promise<void> {
    if (session.disposing !== undefined) {
      await session.disposing;
      return;
    }
    session.disposing = (async () => {
      try {
        await session.transport.close();
      } catch {
        // Best-effort close: session is already leaving the map.
      }
      if (sessionId !== undefined) {
        this.sessions.delete(sessionId);
      }
    })();
    await session.disposing;
  }
}

function jsonRpcErrorResponse(
  status: number,
  code: number,
  message: string,
): Response {
  return new Response(
    JSON.stringify({
      jsonrpc: "2.0",
      error: { code, message },
      id: null,
    }),
    {
      status,
      headers: { "content-type": "application/json" },
    },
  );
}
