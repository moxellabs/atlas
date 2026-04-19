import { formatHeadingPath } from "../text-utils";
import type { ContextualChunkHeader, ContextualChunkHeaderInput } from "../types";

/** Builds compact deterministic contextual text for future retrieval chunk enrichment. */
export function buildContextualChunkHeader(input: ContextualChunkHeaderInput): ContextualChunkHeader {
  const parts = [
    `repo: ${input.repoId}`,
    input.packageId === undefined ? undefined : `package: ${input.packageId}`,
    input.moduleId === undefined ? undefined : `module: ${input.moduleId}`,
    input.skillId === undefined ? undefined : `skill: ${input.skillId}`,
    `kind: ${input.docKind}`,
    `authority: ${input.authority}`,
    input.title === undefined ? undefined : `title: ${input.title}`,
    input.headingPath === undefined || input.headingPath.length === 0 ? undefined : `section: ${formatHeadingPath(input.headingPath)}`
  ].filter((part): part is string => part !== undefined);

  return {
    input,
    text: parts.join(" | ")
  };
}
