import { ResourceTemplate } from "@modelcontextprotocol/sdk/server/mcp.js";

import { McpResourceNotFoundError } from "../errors";
import {
  getDocument,
  getManifest,
  getModule,
  getPackage,
  getRepo,
  getSkill,
  listSections,
  listSkillArtifacts,
  listSummaries,
  provenanceFromDocument
} from "../store-mappers";
import type { AtlasResourceDefinition } from "./resource-utils";
import { resourceId } from "./resource-utils";

/** Skill resource template. */
export const skillResource: AtlasResourceDefinition = {
  name: "atlas-skill",
  uri: new ResourceTemplate("atlas://skill/{skillId}", { list: undefined }),
  title: "ATLAS skill",
  description: "Skill metadata, ownership, source document linkage, and summaries.",
  read: (uri, dependencies) => {
    const skillId = resourceId(uri);
    const skill = getSkill(dependencies.db, skillId);
    if (skill === undefined) {
      throw new McpResourceNotFoundError("Skill resource was not found.", { operation: "readSkillResource", entity: skillId });
    }
    const document = getDocument(dependencies.db, skill.sourceDocId);
    return {
      skill,
      repo: getRepo(dependencies.db, skill.repoId),
      package: skill.packageId === undefined ? undefined : getPackage(dependencies.db, skill.packageId),
      module: skill.moduleId === undefined ? undefined : getModule(dependencies.db, skill.moduleId),
      manifest: getManifest(dependencies.db, skill.repoId),
      artifacts: listSkillArtifacts(dependencies.db, skillId),
      summaries: listSummaries(dependencies.db, "skill", skillId),
      sourceDocument: document,
      sourceDocumentSummaries: listSummaries(dependencies.db, "document", skill.sourceDocId),
      sourceOutline:
        document === undefined
          ? []
          : listSections(dependencies.db, document.docId).map((section) => ({
              sectionId: section.sectionId,
              headingPath: section.headingPath,
              ordinal: section.ordinal
            })),
      provenance: document === undefined ? undefined : provenanceFromDocument(document, undefined, skillId)
    };
  }
};
