import { afterEach, beforeEach, describe, expect, test } from "bun:test";

import * as publicMcp from "./index";
import {
  createConnectedMcpTestClient,
  createMcpTestFixture,
  type McpTestFixture,
} from "./mcp.test-fixtures";
describe("MCP remote proxy and security", () => {
  let fixture: McpTestFixture;

  beforeEach(async () => {
    fixture = await createMcpTestFixture();
  });

  afterEach(async () => {
    await fixture?.cleanup();
  });

  test("proxies authenticated remote MCP without putting the bearer token in config", async () => {
    const token = "remote-proxy-test-token-with-more-than-32-characters";
    const observedAuthorization: string[] = [];
    const proxy = await publicMcp.createRemoteMcpProxy({
      url: "https://atlas.example/mcp",
      token,
      expectedDiscoveryPolicy: "prefer-local",
      fetch: async (input, init) => {
        const request = new Request(input, init);
        observedAuthorization.push(request.headers.get("authorization") ?? "");
        const message = (await request.clone().json()) as {
          id?: string | number;
          method: string;
          params?: { protocolVersion?: string; name?: string };
        };
        if (message.id === undefined)
          return new Response(null, { status: 202 });
        const result =
          message.method === "initialize"
            ? {
                protocolVersion:
                  message.params?.protocolVersion ?? "2025-11-25",
                capabilities: { tools: {} },
                serverInfo: { name: "atlas-remote-test", version: "1.0.0" },
                instructions:
                  "Consult matching indexed sources before external search.",
              }
            : message.method === "tools/list"
              ? {
                  tools: [
                    {
                      name: "plan_context",
                      description: "Plan indexed context",
                      inputSchema: { type: "object" },
                    },
                  ],
                }
              : {
                  content: [{ type: "text", text: "remote result" }],
                  isError: false,
                };
        return Response.json(
          { jsonrpc: "2.0", id: message.id, result },
          { headers: { "content-type": "application/json" } },
        );
      },
    });
    fixture.registerCleanup(() => proxy.close());
    const client = await createConnectedMcpTestClient(proxy.server, {
      name: "atlas-proxy-test",
      version: "1.0.0",
    });
    fixture.registerCleanup(() => client.close());
    expect((await client.listTools()).tools.map((tool) => tool.name)).toContain(
      "plan_context",
    );
    expect(
      await client.callTool({ name: "plan_context", arguments: {} }),
    ).toMatchObject({
      content: [{ type: "text", text: "remote result" }],
      isError: false,
    });
    expect(observedAuthorization).not.toContain(token);
    expect(observedAuthorization).toEqual(
      expect.arrayContaining([`Bearer ${token}`]),
    );
  });
});
