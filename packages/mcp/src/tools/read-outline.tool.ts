import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";

import { McpResourceNotFoundError } from "../errors";
import { toolResult } from "../mcp-result";
import { readOutlineInputSchema, jsonOutputSchema, type ReadOutlineInput } from "../schemas/tool-schemas";
import { getDocument, listSections, listSummaries, provenanceFromDocument } from "../store-mappers";
import type { AtlasMcpDependencies, McpJsonObject } from "../types";

export const READ_OUTLINE_TOOL = "read_outline";

/** Reads a compact document outline and outline summaries for an MCP caller. */
export function executeReadOutline(input: ReadOutlineInput, dependencies: AtlasMcpDependencies): McpJsonObject {
  const parsed = readOutlineInputSchema.parse(input);
  const document = getDocument(dependencies.db, parsed.docId);
  if (document === undefined) {
    throw new McpResourceNotFoundError("Document was not found.", { operation: "readOutline", entity: parsed.docId });
  }
  return {
    document: {
      docId: document.docId,
      title: document.title,
      kind: document.kind,
      authority: document.authority,
      path: document.path,
      provenance: provenanceFromDocument(document)
    },
    outline: listSections(dependencies.db, document.docId).map((section) => ({
      sectionId: section.sectionId,
      headingPath: section.headingPath,
      ordinal: section.ordinal,
      preview: section.text.slice(0, 240)
    })),
    summaries: listSummaries(dependencies.db, "document", document.docId)
  };
}

/** Registers the read_outline MCP tool. */
export function registerReadOutlineTool(server: McpServer, dependencies: AtlasMcpDependencies): void {
  server.registerTool(
    READ_OUTLINE_TOOL,
    {
      title: "Read ATLAS document outline",
      description: "Read a compact outline and summaries for a stored document.",
      inputSchema: readOutlineInputSchema,
      outputSchema: jsonOutputSchema
    },
    (input) => toolResult(executeReadOutline(input, dependencies))
  );
}
