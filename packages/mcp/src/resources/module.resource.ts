import { ResourceTemplate } from "@modelcontextprotocol/sdk/server/mcp.js";

import { McpResourceNotFoundError } from "../errors";
import { getManifest, getModule, getPackage, getRepo, listDocumentsByModule, listSkills, listSummaries } from "../store-mappers";
import type { AtlasResourceDefinition } from "./resource-utils";
import { resourceId } from "./resource-utils";

/** Module resource template. */
export const moduleResource: AtlasResourceDefinition = {
  name: "atlas-module",
  uri: new ResourceTemplate("atlas://module/{moduleId}", { list: undefined }),
  title: "ATLAS module",
  description: "Module metadata, module summaries, and associated skills.",
  read: (uri, dependencies) => {
    const moduleId = resourceId(uri);
    const module = getModule(dependencies.db, moduleId);
    if (module === undefined) {
      throw new McpResourceNotFoundError("Module resource was not found.", { operation: "readModuleResource", entity: moduleId });
    }
    return {
      module,
      repo: getRepo(dependencies.db, module.repoId),
      package: module.packageId === undefined ? undefined : getPackage(dependencies.db, module.packageId),
      manifest: getManifest(dependencies.db, module.repoId),
      summaries: listSummaries(dependencies.db, "module", moduleId),
      documents: listDocumentsByModule(dependencies.db, moduleId),
      skills: listSkills(dependencies.db, { repoId: module.repoId, moduleId })
    };
  }
};
