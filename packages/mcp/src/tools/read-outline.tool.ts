import { readDocumentOutline } from "@atlas/retrieval";

import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";

import { executeMcpRead } from "../errors";
import { toolResult } from "../mcp-result";
import {
  readOutlineInputSchema,
  jsonOutputSchema,
  type ReadOutlineInput,
} from "../schemas/tool-schemas";
import type { AtlasMcpDependencies, McpJsonObject } from "../types";

export const READ_OUTLINE_TOOL = "read_outline";

/** Reads a compact document outline and outline summaries for an MCP caller. */
export function executeReadOutline(
  input: ReadOutlineInput,
  dependencies: AtlasMcpDependencies,
): McpJsonObject {
  const parsed = readOutlineInputSchema.parse(input);
  const result = executeMcpRead(() =>
    readDocumentOutline(dependencies.db, parsed.docId),
  );
  return {
    document: {
      docId: result.document.docId,
      title: result.document.title,
      kind: result.document.kind,
      authority: result.document.authority,
      path: result.document.path,
      provenance: result.provenance,
    },
    outline: result.outline,
    summaries: result.summaries,
  };
}

/** Registers the read_outline MCP tool. */
export function registerReadOutlineTool(
  server: McpServer,
  dependencies: AtlasMcpDependencies,
): void {
  server.registerTool(
    READ_OUTLINE_TOOL,
    {
      title: "Read ATLAS document outline",
      description:
        "Read a compact outline and summaries for a stored document.",
      inputSchema: readOutlineInputSchema,
      outputSchema: jsonOutputSchema,
      annotations: {
        readOnlyHint: true,
        destructiveHint: false,
        idempotentHint: true,
        openWorldHint: false,
      },
    },
    (input) => toolResult(executeReadOutline(input, dependencies)),
  );
}
