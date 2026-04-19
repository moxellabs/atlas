import { SkillRepository } from "@atlas/store";
import { ResourceTemplate } from "@modelcontextprotocol/sdk/server/mcp.js";

import { McpResourceNotFoundError } from "../errors";
import type { AtlasResourceDefinition } from "./resource-utils";

/** Skill artifact resource template. */
export const skillArtifactResource: AtlasResourceDefinition = {
  name: "atlas-skill-artifact",
  uri: new ResourceTemplate("atlas://skill-artifact/{skillId}/{artifactPath}", { list: undefined }),
  title: "ATLAS skill artifact",
  description: "Read-only script, reference, agent profile, or auxiliary file bundled with an ATLAS skill.",
  read: (uri, dependencies) => {
    const [skillId, ...artifactParts] = uri.pathname
      .replace(/^\/+/, "")
      .split("/")
      .map((part) => decodeURIComponent(part));
    const artifactPath = artifactParts.join("/");
    if (skillId === undefined || skillId.length === 0 || artifactPath.length === 0) {
      throw new McpResourceNotFoundError("Skill artifact resource path was invalid.", {
        operation: "readSkillArtifactResource",
        entity: uri.href
      });
    }
    const artifact = new SkillRepository(dependencies.db).getArtifact(skillId, artifactPath);
    if (artifact === undefined) {
      throw new McpResourceNotFoundError("Skill artifact resource was not found.", {
        operation: "readSkillArtifactResource",
        entity: `${skillId}:${artifactPath}`
      });
    }
    return {
      artifact,
      executionPolicy: artifact.kind === "script" ? "served-only" : "not-executable"
    };
  }
};
