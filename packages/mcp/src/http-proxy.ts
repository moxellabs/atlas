import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import type {
  FetchLike,
  Transport,
} from "@modelcontextprotocol/sdk/shared/transport.js";
import {
  CallToolRequestSchema,
  CompleteRequestSchema,
  GetPromptRequestSchema,
  ListPromptsRequestSchema,
  ListResourcesRequestSchema,
  ListResourceTemplatesRequestSchema,
  ListToolsRequestSchema,
  PromptListChangedNotificationSchema,
  ReadResourceRequestSchema,
  ResourceListChangedNotificationSchema,
  ResourceUpdatedNotificationSchema,
  ToolListChangedNotificationSchema,
  type ServerCapabilities,
} from "@modelcontextprotocol/sdk/types.js";
import type { AtlasMcpDiscoveryPolicy } from "./types";

export interface RemoteMcpProxy {
  readonly server: Server;
  close(): Promise<void>;
}

/**
 * Connects to an authenticated Atlas Streamable HTTP endpoint and mirrors its
 * read-only MCP surface through a local server transport.
 */
export async function createRemoteMcpProxy(input: {
  readonly url: string;
  readonly token: string;
  readonly expectedDiscoveryPolicy?: AtlasMcpDiscoveryPolicy | undefined;
  readonly fetch?: FetchLike | undefined;
}): Promise<RemoteMcpProxy> {
  const url = new URL(input.url);
  if (url.protocol !== "https:")
    throw new Error("Remote Atlas MCP URLs must use HTTPS.");
  if (input.token.length < 32)
    throw new Error(
      "Remote Atlas MCP bearer tokens must be at least 32 characters.",
    );

  const client = new Client(
    { name: "atlas-http-proxy", version: "1.0.0" },
    { capabilities: {} },
  );
  const transport = new StreamableHTTPClientTransport(url, {
    requestInit: {
      headers: { authorization: `Bearer ${input.token}` },
    },
    ...(input.fetch === undefined ? {} : { fetch: input.fetch }),
  });
  await client.connect(compatibleTransport(transport));
  if (
    input.expectedDiscoveryPolicy === "prefer-local" &&
    !client.getInstructions()?.includes("before external search")
  ) {
    await client.close();
    throw new Error(
      "Remote Atlas MCP server does not advertise the required prefer-local discovery policy.",
    );
  }

  const upstreamCapabilities = client.getServerCapabilities() ?? {};
  const instructions = client.getInstructions();
  const server = new Server(
    client.getServerVersion() ?? {
      name: "atlas-http-proxy",
      version: "1.0.0",
    },
    {
      capabilities: proxyCapabilities(upstreamCapabilities),
      ...(instructions === undefined ? {} : { instructions }),
    },
  );

  if (upstreamCapabilities.tools !== undefined) {
    server.setRequestHandler(ListToolsRequestSchema, ({ params }) =>
      client.listTools(params),
    );
    server.setRequestHandler(CallToolRequestSchema, ({ params }) =>
      client.callTool(params),
    );
    client.setNotificationHandler(ToolListChangedNotificationSchema, () =>
      server.sendToolListChanged(),
    );
  }
  if (upstreamCapabilities.resources !== undefined) {
    server.setRequestHandler(ListResourcesRequestSchema, ({ params }) =>
      client.listResources(params),
    );
    server.setRequestHandler(ListResourceTemplatesRequestSchema, ({ params }) =>
      client.listResourceTemplates(params),
    );
    server.setRequestHandler(ReadResourceRequestSchema, ({ params }) =>
      client.readResource(params),
    );
    client.setNotificationHandler(ResourceListChangedNotificationSchema, () =>
      server.sendResourceListChanged(),
    );
    client.setNotificationHandler(
      ResourceUpdatedNotificationSchema,
      ({ params }) => server.sendResourceUpdated(params),
    );
  }
  if (upstreamCapabilities.prompts !== undefined) {
    server.setRequestHandler(ListPromptsRequestSchema, ({ params }) =>
      client.listPrompts(params),
    );
    server.setRequestHandler(GetPromptRequestSchema, ({ params }) =>
      client.getPrompt(params),
    );
    client.setNotificationHandler(PromptListChangedNotificationSchema, () =>
      server.sendPromptListChanged(),
    );
  }
  if (upstreamCapabilities.completions !== undefined)
    server.setRequestHandler(CompleteRequestSchema, ({ params }) =>
      client.complete(params),
    );

  let closed = false;
  return {
    server,
    async close() {
      if (closed) return;
      closed = true;
      await Promise.allSettled([server.close(), client.close()]);
    },
  };
}

function compatibleTransport(
  transport: StreamableHTTPClientTransport,
): Transport {
  return {
    start: () => transport.start(),
    send: (message, options) => transport.send(message, options),
    close: () => transport.close(),
    get onclose() {
      return transport.onclose ?? (() => {});
    },
    set onclose(handler) {
      transport.onclose = handler;
    },
    get onerror() {
      return transport.onerror ?? (() => {});
    },
    set onerror(handler) {
      transport.onerror = handler;
    },
    get onmessage() {
      return transport.onmessage ?? (() => {});
    },
    set onmessage(handler) {
      transport.onmessage = handler;
    },
    setProtocolVersion: (version) => transport.setProtocolVersion?.(version),
  };
}

function proxyCapabilities(upstream: ServerCapabilities): ServerCapabilities {
  return {
    ...(upstream.tools === undefined
      ? {}
      : { tools: { listChanged: upstream.tools.listChanged === true } }),
    ...(upstream.resources === undefined
      ? {}
      : {
          resources: {
            subscribe: false,
            listChanged: upstream.resources.listChanged === true,
          },
        }),
    ...(upstream.prompts === undefined
      ? {}
      : { prompts: { listChanged: upstream.prompts.listChanged === true } }),
    ...(upstream.completions === undefined ? {} : { completions: {} }),
  };
}
