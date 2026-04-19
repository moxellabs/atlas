import { SummaryRepository } from "@atlas/store";
import { ResourceTemplate } from "@modelcontextprotocol/sdk/server/mcp.js";

import { McpResourceNotFoundError } from "../errors";
import type { AtlasResourceDefinition } from "./resource-utils";
import { resourceId } from "./resource-utils";

/** Summary resource template. */
export const summaryResource: AtlasResourceDefinition = {
  name: "atlas-summary",
  uri: new ResourceTemplate("atlas://summary/{summaryId}", { list: undefined }),
  title: "ATLAS summary",
  description: "Stored summary artifact metadata and text.",
  read: (uri, dependencies) => {
    const summaryId = resourceId(uri);
    const summary = new SummaryRepository(dependencies.db).getById(summaryId);
    if (summary === undefined) {
      throw new McpResourceNotFoundError("Summary resource was not found.", { operation: "readSummaryResource", entity: summaryId });
    }
    return { summary };
  }
};
