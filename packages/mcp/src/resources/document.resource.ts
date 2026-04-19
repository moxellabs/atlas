import { ResourceTemplate } from "@modelcontextprotocol/sdk/server/mcp.js";

import { McpResourceNotFoundError } from "../errors";
import { getDocument, listSections, listSummaries, provenanceFromDocument } from "../store-mappers";
import type { AtlasResourceDefinition } from "./resource-utils";
import { resourceId } from "./resource-utils";

/** Document resource template. */
export const documentResource: AtlasResourceDefinition = {
  name: "atlas-document",
  uri: new ResourceTemplate("atlas://document/{docId}", { list: undefined }),
  title: "ATLAS document",
  description: "Canonical document metadata, provenance, summaries, and outline.",
  read: (uri, dependencies) => {
    const docId = resourceId(uri);
    const document = getDocument(dependencies.db, docId);
    if (document === undefined) {
      throw new McpResourceNotFoundError("Document resource was not found.", { operation: "readDocumentResource", entity: docId });
    }
    return {
      document,
      provenance: provenanceFromDocument(document),
      summaries: listSummaries(dependencies.db, "document", docId),
      outline: listSections(dependencies.db, docId).map((section) => ({
        sectionId: section.sectionId,
        headingPath: section.headingPath,
        ordinal: section.ordinal
      }))
    };
  }
};
