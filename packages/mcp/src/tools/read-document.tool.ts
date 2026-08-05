import { readDocumentOutline, readDocumentSection } from "@atlas/retrieval";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";

import { executeMcpRead } from "../errors";
import { toolResult } from "../mcp-result";
import { readDocumentOutputSchema } from "../schemas/tool-output-schemas";
import {
  type ReadDocumentInput,
  readDocumentInputSchema,
} from "../schemas/tool-schemas";
import type { AtlasMcpDependencies, McpJsonObject } from "../types";

export const READ_DOCUMENT_TOOL = "read_document";

/** Reads a compact outline or exactly one canonical section. */
export function executeReadDocument(
  input: ReadDocumentInput,
  dependencies: AtlasMcpDependencies,
): McpJsonObject {
  const parsed = readDocumentInputSchema.parse(input);
  if (parsed.sectionId === undefined && parsed.heading === undefined) {
    const result = executeMcpRead(() =>
      readDocumentOutline(dependencies.db, parsed.docId),
    );
    return readDocumentOutputSchema.parse({
      status: "outline",
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
      nextActionGuidance:
        "Choose the one relevant outline section and call read_document once with its sectionId. If the summaries already support the claim, answer now.",
    });
  }

  const result = executeMcpRead(() =>
    readDocumentSection(dependencies.db, parsed.docId, {
      ...(parsed.sectionId === undefined
        ? {}
        : { sectionId: parsed.sectionId }),
      ...(parsed.heading === undefined ? {} : { heading: parsed.heading }),
    }),
  );
  return readDocumentOutputSchema.parse({
    status: "section",
    section: {
      sectionId: result.section.sectionId,
      docId: result.section.docId,
      headingPath: result.section.headingPath,
      ordinal: result.section.ordinal,
      text: result.section.text,
      codeBlocks: result.section.codeBlocks,
      provenance: result.provenance,
    },
    nextActionGuidance:
      "TERMINAL: answer now from section.text and section.provenance. This is the requested exact section; do not call another Atlas tool.",
  });
}

/** Registers the read_document MCP tool. */
export function registerReadDocumentTool(
  server: McpServer,
  dependencies: AtlasMcpDependencies,
): void {
  server.registerTool(
    READ_DOCUMENT_TOOL,
    {
      title: "Read indexed document",
      description:
        "Read a stored document after find_docs or plan_context returns its stable docId. When the caller already knows the docId and an exact section heading, pass heading directly and do not request an outline first; a unique trailing heading is accepted when the full path is unknown. Otherwise omit sectionId and heading for a compact outline. Pass exactly one selector for exact section text and provenance.",
      inputSchema: readDocumentInputSchema,
      outputSchema: readDocumentOutputSchema,
      annotations: {
        readOnlyHint: true,
        destructiveHint: false,
        idempotentHint: true,
        openWorldHint: false,
      },
    },
    (input) => toolResult(executeReadDocument(input, dependencies)),
  );
}
