import { ResourceTemplate } from "@modelcontextprotocol/sdk/server/mcp.js";

import { McpResourceNotFoundError } from "../errors";
import { freshnessForRepo, getManifest, getRepo, listDocumentsByRepo, listModules, listPackages, listSkills, listSummaries } from "../store-mappers";
import type { AtlasResourceDefinition } from "./resource-utils";
import { resourceId } from "./resource-utils";

/** Repository resource template. */
export const repoResource: AtlasResourceDefinition = {
  name: "atlas-repo",
  uri: new ResourceTemplate("atlas://repo/{repoId}", { list: undefined }),
  title: "ATLAS repository",
  description: "Repository metadata, summaries, and manifest freshness.",
  read: (uri, dependencies) => {
    const repoId = resourceId(uri);
    const repo = getRepo(dependencies.db, repoId);
    if (repo === undefined) {
      throw new McpResourceNotFoundError("Repository resource was not found.", { operation: "readRepoResource", entity: repoId });
    }
    const manifest = getManifest(dependencies.db, repoId);
    return {
      repo,
      manifest,
      freshness: freshnessForRepo(repo, manifest),
      summaries: listSummaries(dependencies.db, "repo", repoId),
      packages: listPackages(dependencies.db, repoId),
      modules: listModules(dependencies.db, repoId),
      documents: listDocumentsByRepo(dependencies.db, repoId),
      skills: listSkills(dependencies.db, { repoId })
    };
  }
};
