import { createAtlasMcpServer, createWebStandardStreamableHttpTransport } from "@atlas/mcp";
import type { AtlasMcpIdentity, AtlasMcpServer, AtlasSourceDiffProvider } from "@atlas/mcp";
import type { AtlasStoreClient } from "@atlas/store";

import { ServerDependencyError } from "../errors";

const DEFAULT_SESSION_IDLE_TIMEOUT_MS = 30 * 60 * 1000;
const DEFAULT_MAX_SESSIONS = 32;
type McpBridgeTransport = ReturnType<typeof createWebStandardStreamableHttpTransport>;

interface McpBridgeSession {
  readonly server: AtlasMcpServer;
  readonly transport: McpBridgeTransport;
  lastSeenAt: number;
}

/** Bun/Web-standard MCP bridge hosted by the server app under /mcp. */
export class McpBridgeService {
  readonly atlasMcpServer: AtlasMcpServer;
  private readonly sessions = new Map<string, McpBridgeSession>();

  constructor(db: AtlasStoreClient, sourceDiffProvider?: AtlasSourceDiffProvider | undefined, identity?: AtlasMcpIdentity | undefined) {
    this.atlasMcpServer = createAtlasMcpServer({
      db,
      ...(identity === undefined ? {} : { identity }),
      ...(sourceDiffProvider === undefined ? {} : { sourceDiffProvider })
    });
    this.db = db;
    this.sourceDiffProvider = sourceDiffProvider;
    this.identity = identity;
  }

  /** Handles a single Web Request using the MCP Streamable HTTP transport. */
  async handle(request: Request): Promise<Response> {
    try {
      this.sweepIdleSessions(Date.now());

      const sessionId = request.headers.get("mcp-session-id");
      if (sessionId !== null && sessionId.length > 0) {
        return await this.handleSessionRequest(request, sessionId);
      }

      return await this.handleInitializationRequest(request);
    } catch (error) {
      throw new ServerDependencyError("MCP bridge request failed.", {
        operation: "mcpBridge",
        entity: "mcp",
        cause: error
      });
    }
  }

  private readonly db: AtlasStoreClient;
  private readonly sourceDiffProvider?: AtlasSourceDiffProvider | undefined;
  private readonly identity?: AtlasMcpIdentity | undefined;

  private async handleInitializationRequest(request: Request): Promise<Response> {
    this.enforceSessionLimit();

    let initializedSessionId: string | undefined;
    const session = await this.createSession((sessionId) => {
      initializedSessionId = sessionId;
    });

    const response = await session.transport.handleRequest(request);
    if (response.ok && initializedSessionId !== undefined) {
      session.lastSeenAt = Date.now();
      this.sessions.set(initializedSessionId, session);
    } else {
      await session.transport.close();
    }
    return response;
  }

  private async handleSessionRequest(request: Request, sessionId: string): Promise<Response> {
    const session = this.sessions.get(sessionId);
    if (session === undefined) {
      return jsonRpcErrorResponse(404, -32001, "Session not found");
    }

    session.lastSeenAt = Date.now();
    const response = await session.transport.handleRequest(request);
    session.lastSeenAt = Date.now();
    if (request.method === "DELETE" && response.ok) {
      this.sessions.delete(sessionId);
    }
    return response;
  }

  private async createSession(onsessioninitialized: (sessionId: string) => void): Promise<McpBridgeSession> {
    const server = createAtlasMcpServer({
      db: this.db,
      ...(this.identity === undefined ? {} : { identity: this.identity }),
      ...(this.sourceDiffProvider === undefined ? {} : { sourceDiffProvider: this.sourceDiffProvider })
    });
    const transport = createWebStandardStreamableHttpTransport({
      enableJsonResponse: true,
      sessionIdGenerator: () => crypto.randomUUID(),
      onsessioninitialized,
      onsessionclosed: (sessionId) => {
        this.sessions.delete(sessionId);
      }
    });
    await server.server.connect(transport);
    return {
      server,
      transport,
      lastSeenAt: Date.now()
    };
  }

  private sweepIdleSessions(now: number): void {
    for (const [sessionId, session] of this.sessions.entries()) {
      if (now - session.lastSeenAt <= DEFAULT_SESSION_IDLE_TIMEOUT_MS) {
        continue;
      }
      this.sessions.delete(sessionId);
      void session.transport.close();
    }
  }

  private enforceSessionLimit(): void {
    if (this.sessions.size < DEFAULT_MAX_SESSIONS) {
      return;
    }
    const oldestSession = [...this.sessions.entries()].sort(([, left], [, right]) => left.lastSeenAt - right.lastSeenAt)[0];
    if (oldestSession === undefined) {
      return;
    }
    const [sessionId, session] = oldestSession;
    this.sessions.delete(sessionId);
    void session.transport.close();
  }
}

function jsonRpcErrorResponse(status: number, code: number, message: string): Response {
  return new Response(
    JSON.stringify({
      jsonrpc: "2.0",
      error: { code, message },
      id: null
    }),
    {
      status,
      headers: { "content-type": "application/json" }
    }
  );
}
