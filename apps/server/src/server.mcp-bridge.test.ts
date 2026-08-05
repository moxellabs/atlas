import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { createApp } from "./app";
import {
  createServerTestFixture,
  mcpRequest,
  response,
  type ServerTestFixture,
} from "./server.test-fixtures";

describe("server MCP bridge", () => {
  let fixture: ServerTestFixture;

  beforeEach(async () => {
    fixture = await createServerTestFixture();
  });

  afterEach(async () => {
    await fixture.destroy();
  });

  test("mcp identity serverInfo uses ATLAS_MCP configuration", async () => {
    const mcpApp = createApp(
      fixture.createDependencies({ enableMcp: true }, undefined, undefined, {
        name: "acme-knowledge",
        title: "Acme Knowledge MCP",
        resourcePrefix: "acme",
      }),
    );
    const initialize = await mcpRequest(mcpApp, {
      id: 1,
      method: "initialize",
      params: {
        protocolVersion: "2025-03-26",
        capabilities: {},
        clientInfo: { name: "test", version: "1" },
      },
    });
    const body = (await initialize.json()) as {
      result: { serverInfo: { name: string; title?: string } };
    };
    expect(body.result.serverInfo).toMatchObject({
      name: "acme-knowledge",
      title: "Acme Knowledge MCP",
    });
  });

  test("bridges SDK-compatible MCP Streamable HTTP requests", async () => {
    const mcpApp = createApp(fixture.createDependencies({ enableMcp: true }));
    const initialize = await mcpRequest(mcpApp, {
      id: 1,
      method: "initialize",
      params: {
        protocolVersion: "2025-03-26",
        capabilities: {},
        clientInfo: { name: "atlas-server-test", version: "0.0.0" },
      },
    });

    expect(initialize.status).toBe(200);
    const sessionId = initialize.headers.get("mcp-session-id");
    expect(sessionId).toBeDefined();
    expect(await initialize.json()).toMatchObject({
      jsonrpc: "2.0",
      id: 1,
      result: {
        serverInfo: expect.objectContaining({ name: expect.any(String) }),
        capabilities: expect.any(Object),
      },
    });

    const tools = await mcpRequest(
      mcpApp,
      {
        id: 2,
        method: "tools/list",
        params: {},
      },
      sessionId ?? undefined,
    );
    expect(tools.status).toBe(200);
    expect(await tools.json()).toMatchObject({
      jsonrpc: "2.0",
      id: 2,
      result: {
        tools: expect.arrayContaining([
          expect.objectContaining({ name: "search_passages" }),
        ]),
      },
    });

    const stream = await response(mcpApp, "/mcp", {
      method: "GET",
      headers: {
        accept: "text/event-stream",
        "mcp-session-id": sessionId ?? "",
        "mcp-protocol-version": "2025-03-26",
      },
    });
    expect(stream.status).toBe(200);
    expect(stream.headers.get("content-type")).toContain("text/event-stream");
    await stream.body?.cancel();

    const deleted = await response(mcpApp, "/mcp", {
      method: "DELETE",
      headers: {
        "mcp-session-id": sessionId ?? "",
        "mcp-protocol-version": "2025-03-26",
      },
    });
    expect(deleted.status).toBe(200);
  });

  test("isolates MCP Streamable HTTP state per session", async () => {
    const mcpApp = createApp(fixture.createDependencies({ enableMcp: true }));
    const firstInitialize = await mcpRequest(mcpApp, {
      id: 1,
      method: "initialize",
      params: {
        protocolVersion: "2025-03-26",
        capabilities: {},
        clientInfo: { name: "atlas-server-test-a", version: "0.0.0" },
      },
    });
    const secondInitialize = await mcpRequest(mcpApp, {
      id: 2,
      method: "initialize",
      params: {
        protocolVersion: "2025-03-26",
        capabilities: {},
        clientInfo: { name: "atlas-server-test-b", version: "0.0.0" },
      },
    });

    expect(firstInitialize.status).toBe(200);
    expect(secondInitialize.status).toBe(200);
    const firstSessionId = firstInitialize.headers.get("mcp-session-id");
    const secondSessionId = secondInitialize.headers.get("mcp-session-id");
    expect(firstSessionId).toBeDefined();
    expect(secondSessionId).toBeDefined();
    expect(firstSessionId).not.toBe(secondSessionId);

    const firstTools = await mcpRequest(
      mcpApp,
      { id: 3, method: "tools/list", params: {} },
      firstSessionId ?? undefined,
    );
    const secondTools = await mcpRequest(
      mcpApp,
      { id: 4, method: "tools/list", params: {} },
      secondSessionId ?? undefined,
    );
    expect(firstTools.status).toBe(200);
    expect(secondTools.status).toBe(200);
    expect(await firstTools.json()).toMatchObject({
      result: {
        tools: expect.arrayContaining([
          expect.objectContaining({ name: "search_passages" }),
        ]),
      },
    });
    expect(await secondTools.json()).toMatchObject({
      result: {
        tools: expect.arrayContaining([
          expect.objectContaining({ name: "search_passages" }),
        ]),
      },
    });

    const deletedFirst = await response(mcpApp, "/mcp", {
      method: "DELETE",
      headers: {
        "mcp-session-id": firstSessionId ?? "",
        "mcp-protocol-version": "2025-03-26",
      },
    });
    expect(deletedFirst.status).toBe(200);

    const deletedSessionTools = await mcpRequest(
      mcpApp,
      { id: 5, method: "tools/list", params: {} },
      firstSessionId ?? undefined,
    );
    expect(deletedSessionTools.status).toBe(404);
    expect(await deletedSessionTools.json()).toMatchObject({
      jsonrpc: "2.0",
      error: { code: -32001, message: "Session not found" },
    });

    const remainingSessionTools = await mcpRequest(
      mcpApp,
      { id: 6, method: "tools/list", params: {} },
      secondSessionId ?? undefined,
    );
    expect(remainingSessionTools.status).toBe(200);
    expect(await remainingSessionTools.json()).toMatchObject({
      result: {
        tools: expect.arrayContaining([
          expect.objectContaining({ name: "search_passages" }),
        ]),
      },
    });
  });

  test("serializes concurrent MCP initialization before enforcing the session cap", async () => {
    const dependencies = fixture.createDependencies({ enableMcp: true });
    const mcpApp = createApp(dependencies);
    try {
      const initialized = await Promise.all(
        Array.from({ length: 33 }, (_, index) =>
          mcpRequest(mcpApp, {
            id: index + 1,
            method: "initialize",
            params: {
              protocolVersion: "2025-03-26",
              capabilities: {},
              clientInfo: {
                name: `atlas-concurrent-test-${index}`,
                version: "0.0.0",
              },
            },
          }),
        ),
      );
      expect(initialized.every((response) => response.status === 200)).toBe(
        true,
      );
      const sessionIds = initialized.map((response) =>
        response.headers.get("mcp-session-id"),
      );
      expect(new Set(sessionIds).size).toBe(33);
      expect(
        (
          await mcpRequest(
            mcpApp,
            { id: 34, method: "tools/list", params: {} },
            sessionIds[0] ?? undefined,
          )
        ).status,
      ).toBe(404);
      expect(
        (
          await mcpRequest(
            mcpApp,
            { id: 35, method: "tools/list", params: {} },
            sessionIds.at(-1) ?? undefined,
          )
        ).status,
      ).toBe(200);
    } finally {
      await dependencies.mcp?.close();
    }
  });

  test("returns MCP protocol errors without escaping the route boundary", async () => {
    const mcpApp = createApp(fixture.createDependencies({ enableMcp: true }));

    const invalidAccept = await mcpRequest(
      mcpApp,
      { id: 1, method: "tools/list", params: {} },
      undefined,
      {
        accept: "application/json",
      },
    );
    expect(invalidAccept.status).toBe(406);
    expect(await invalidAccept.json()).toMatchObject({
      jsonrpc: "2.0",
      error: {
        code: -32000,
        message: expect.stringContaining("Not Acceptable"),
      },
    });

    const missingSession = await response(mcpApp, "/mcp", {
      method: "DELETE",
      headers: { "mcp-protocol-version": "2025-03-26" },
    });
    expect(missingSession.status).toBe(400);
    expect(await missingSession.json()).toMatchObject({
      jsonrpc: "2.0",
      error: {
        code: -32000,
        message: expect.stringContaining("Server not initialized"),
      },
    });
  });
});
