import type { CallToolResult, GetPromptResult, ReadResourceResult } from "@modelcontextprotocol/sdk/types.js";

import type { McpJsonObject } from "./types";

/** Converts a structured payload into a tool result with both JSON content and structured content. */
export function toolResult(payload: McpJsonObject): CallToolResult {
  return {
    structuredContent: payload,
    content: [{ type: "text", text: JSON.stringify(payload, null, 2) }]
  };
}

/** Converts a structured payload into an MCP text resource result. */
export function resourceResult(uri: string, payload: McpJsonObject): ReadResourceResult {
  return {
    contents: [
      {
        uri,
        mimeType: "application/json",
        text: JSON.stringify(payload, null, 2)
      }
    ]
  };
}

/** Builds a prompt result with one user message. */
export function promptResult(description: string, text: string): GetPromptResult {
  return {
    description,
    messages: [
      {
        role: "user",
        content: { type: "text", text }
      }
    ]
  };
}
