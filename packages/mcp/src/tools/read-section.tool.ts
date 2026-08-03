import { readDocumentSection } from "@atlas/retrieval";

import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";

import { executeMcpRead } from "../errors";
import { toolResult } from "../mcp-result";
import {
  readSectionInputSchema,
  jsonOutputSchema,
  type ReadSectionInput,
} from "../schemas/tool-schemas";
import type { AtlasMcpDependencies, McpJsonObject } from "../types";

export const READ_SECTION_TOOL = "read_section";

/** Reads exactly one canonical section by section ID or heading path. */
export function executeReadSection(
  input: ReadSectionInput,
  dependencies: AtlasMcpDependencies,
): McpJsonObject {
  const parsed = readSectionInputSchema.parse(input);
  const result = executeMcpRead(() =>
    readDocumentSection(dependencies.db, parsed.docId, {
      ...(parsed.sectionId === undefined
        ? {}
        : { sectionId: parsed.sectionId }),
      ...(parsed.heading === undefined ? {} : { heading: parsed.heading }),
    }),
  );
  return {
    section: {
      sectionId: result.section.sectionId,
      docId: result.section.docId,
      headingPath: result.section.headingPath,
      ordinal: result.section.ordinal,
      text: result.section.text,
      codeBlocks: result.section.codeBlocks,
      provenance: result.provenance,
    },
  };
}

/** Registers the read_section MCP tool. */
export function registerReadSectionTool(
  server: McpServer,
  dependencies: AtlasMcpDependencies,
): void {
  server.registerTool(
    READ_SECTION_TOOL,
    {
      title: "Read ATLAS section",
      description:
        "Read exact text and provenance for one stored canonical section.",
      inputSchema: readSectionInputSchema,
      outputSchema: jsonOutputSchema,
      annotations: {
        readOnlyHint: true,
        destructiveHint: false,
        idempotentHint: true,
        openWorldHint: false,
      },
    },
    (input) => toolResult(executeReadSection(input, dependencies)),
  );
}
