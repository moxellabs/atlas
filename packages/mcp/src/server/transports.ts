import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { StreamableHTTPServerTransport, type StreamableHTTPServerTransportOptions } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import {
  WebStandardStreamableHTTPServerTransport,
  type WebStandardStreamableHTTPServerTransportOptions
} from "@modelcontextprotocol/sdk/server/webStandardStreamableHttp.js";
import type { Readable, Writable } from "node:stream";

import { McpTransportError } from "../errors";

/** Supported MCP transport modes. */
export type AtlasMcpTransportMode = "stdio" | "streamable-http";

/** Options for creating an MCP transport. */
export interface CreateAtlasTransportOptions {
  /** Transport mode. */
  mode: AtlasMcpTransportMode;
  /** Options forwarded to the Streamable HTTP transport. */
  http?: StreamableHTTPServerTransportOptions | undefined;
}

/** Creates a stdio MCP server transport. */
export function createStdioTransport(stdin?: Readable, stdout?: Writable): StdioServerTransport {
  try {
    return new StdioServerTransport(stdin, stdout);
  } catch (error) {
    throw new McpTransportError("Failed to create stdio MCP transport.", {
      operation: "createStdioTransport",
      entity: "stdio",
      cause: error
    });
  }
}

/** Creates a Streamable HTTP MCP server transport. */
export function createStreamableHttpTransport(options: StreamableHTTPServerTransportOptions = {}): StreamableHTTPServerTransport {
  try {
    return new StreamableHTTPServerTransport(options);
  } catch (error) {
    throw new McpTransportError("Failed to create Streamable HTTP MCP transport.", {
      operation: "createStreamableHttpTransport",
      entity: "streamable-http",
      cause: error
    });
  }
}

/** Creates a Web Standard Streamable HTTP MCP server transport for runtimes such as Bun. */
export function createWebStandardStreamableHttpTransport(
  options: WebStandardStreamableHTTPServerTransportOptions = {}
): WebStandardStreamableHTTPServerTransport {
  try {
    return new WebStandardStreamableHTTPServerTransport(options);
  } catch (error) {
    throw new McpTransportError("Failed to create Web Standard Streamable HTTP MCP transport.", {
      operation: "createWebStandardStreamableHttpTransport",
      entity: "web-standard-streamable-http",
      cause: error
    });
  }
}

/** Creates one supported MCP transport by mode. */
export function createAtlasTransport(options: CreateAtlasTransportOptions): StdioServerTransport | StreamableHTTPServerTransport {
  if (options.mode === "stdio") {
    return createStdioTransport();
  }
  return createStreamableHttpTransport(options.http);
}
