import { apiFailureSchema } from "../../schemas/response.schema";
import { jsonResponse, operation, validationResponse } from "./helpers";

function mcpOperation(
  operationId: string,
  summary: string,
  description: string,
) {
  return operation({
    tags: ["MCP"],
    operationId,
    summary,
    description,
    responses: {
      200: {
        description:
          "MCP Streamable HTTP response. Body and content type are defined by the MCP protocol exchange.",
      },
      400: validationResponse(),
      500: jsonResponse(apiFailureSchema, "MCP bridge failure."),
    },
  });
}

export const mcpDocs = {
  mcpGet: mcpOperation(
    "getMcpSession",
    "Open MCP stream",
    "Opens the MCP Streamable HTTP server-to-client stream for local agents when supported by the client runtime.",
  ),
  mcpPost: mcpOperation(
    "postMcpMessage",
    "Send MCP message",
    "Sends a JSON-RPC MCP message to the local Streamable HTTP transport without changing HTTP API route contracts.",
  ),
  mcpDelete: mcpOperation(
    "deleteMcpSession",
    "Close MCP session",
    "Closes a local MCP Streamable HTTP session when supported by the client, allowing agents to release loopback resources.",
  ),
} as const;
