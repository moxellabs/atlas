import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";

import { McpResourceNotFoundError } from "../errors";
import { toolResult } from "../mcp-result";
import { readSectionInputSchema, jsonOutputSchema, type ReadSectionInput } from "../schemas/tool-schemas";
import { getDocument, getSection, provenanceFromDocument } from "../store-mappers";
import type { AtlasMcpDependencies, McpJsonObject } from "../types";

export const READ_SECTION_TOOL = "read_section";

/** Reads exactly one canonical section by section ID or heading path. */
export function executeReadSection(input: ReadSectionInput, dependencies: AtlasMcpDependencies): McpJsonObject {
  const parsed = readSectionInputSchema.parse(input);
  const document = getDocument(dependencies.db, parsed.docId);
  if (document === undefined) {
    throw new McpResourceNotFoundError("Document was not found.", { operation: "readSection", entity: parsed.docId });
  }
  const section = getSection(dependencies.db, parsed.docId, {
    ...(parsed.sectionId === undefined ? {} : { sectionId: parsed.sectionId }),
    ...(parsed.heading === undefined ? {} : { heading: parsed.heading })
  });
  if (section === undefined) {
    throw new McpResourceNotFoundError("Section was not found.", {
      operation: "readSection",
      entity: parsed.sectionId ?? parsed.heading?.join(" > ")
    });
  }
  return {
    section: {
      sectionId: section.sectionId,
      docId: section.docId,
      headingPath: section.headingPath,
      ordinal: section.ordinal,
      text: section.text,
      codeBlocks: section.codeBlocks,
      provenance: provenanceFromDocument(document, section.headingPath)
    }
  };
}

/** Registers the read_section MCP tool. */
export function registerReadSectionTool(server: McpServer, dependencies: AtlasMcpDependencies): void {
  server.registerTool(
    READ_SECTION_TOOL,
    {
      title: "Read ATLAS section",
      description: "Read exact text and provenance for one stored canonical section.",
      inputSchema: readSectionInputSchema,
      outputSchema: jsonOutputSchema
    },
    (input) => toolResult(executeReadSection(input, dependencies))
  );
}
