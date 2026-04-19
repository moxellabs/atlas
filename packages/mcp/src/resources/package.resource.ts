import { ResourceTemplate } from "@modelcontextprotocol/sdk/server/mcp.js";

import { McpResourceNotFoundError } from "../errors";
import { getManifest, getPackage, getRepo, listDocumentsByPackage, listModules, listSkills, listSummaries } from "../store-mappers";
import type { AtlasResourceDefinition } from "./resource-utils";
import { resourceId } from "./resource-utils";

/** Package resource template. */
export const packageResource: AtlasResourceDefinition = {
  name: "atlas-package",
  uri: new ResourceTemplate("atlas://package/{packageId}", { list: undefined }),
  title: "ATLAS package",
  description: "Package metadata and package-level summaries.",
  read: (uri, dependencies) => {
    const packageId = resourceId(uri);
    const pkg = getPackage(dependencies.db, packageId);
    if (pkg === undefined) {
      throw new McpResourceNotFoundError("Package resource was not found.", { operation: "readPackageResource", entity: packageId });
    }
    return {
      package: pkg,
      repo: getRepo(dependencies.db, pkg.repoId),
      manifest: getManifest(dependencies.db, pkg.repoId),
      summaries: listSummaries(dependencies.db, "package", packageId),
      modules: listModules(dependencies.db, pkg.repoId, packageId),
      documents: listDocumentsByPackage(dependencies.db, pkg.repoId, packageId),
      skills: listSkills(dependencies.db, { repoId: pkg.repoId, packageId })
    };
  }
};
