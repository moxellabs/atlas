import { estimateTokenCount } from "@atlas/core";

import { compilerDiagnostic } from "../diagnostics";
import { SkillExtractionError } from "../errors";
import { truncateText } from "../text-utils";
import type { CompilerDiagnostic, ExtractedSkillContent, ExtractSkillInput, FrontmatterData } from "../types";

/** Result of deterministic skill content extraction. */
export interface ExtractSkillResult {
  /** Skill-oriented content metadata. */
  skill: ExtractedSkillContent;
  /** Diagnostics explaining populated fields. */
  diagnostics: CompilerDiagnostic[];
}

/** Extracts transparent skill metadata from a compiled skill document and topology skill node. */
export function extractSkill(input: ExtractSkillInput): ExtractSkillResult {
  assertSkillInput(input);
  const headings = input.document.sections.filter((section) => section.headingPath.length > 0).map((section) => section.headingPath);
  const description = extractDescription(input);
  const keySections = selectKeySections(input);
  const topics = extractStringList(input.frontmatter, "topics", input.document.metadata.tags);
  const aliases = extractStringList(input.frontmatter, "aliases", []);
  const skill: ExtractedSkillContent = {
    skillId: input.skill.skillId,
    ...(input.document.title === undefined ? {} : { title: input.document.title }),
    ...(description === undefined ? {} : { description }),
    headings,
    keySections,
    topics,
    aliases,
    tokenCount: estimateSkillTokenCount({
      title: input.document.title,
      description,
      headings,
      keySections,
      topics,
      aliases
    })
  };

  return {
    skill,
    diagnostics: [
      compilerDiagnostic({
        stage: "skill",
        code: "skill.extracted",
        message: `Extracted skill metadata with ${headings.length} heading path(s) and ${keySections.length} key section(s).`,
        path: input.document.path,
        docId: input.document.docId
      })
    ]
  };
}

function extractStringList(frontmatter: FrontmatterData | undefined, field: string, fallback: readonly string[]): string[] {
  const value = frontmatter?.[field];
  if (Array.isArray(value)) {
    return uniqueSorted(value.filter((item): item is string => typeof item === "string").flatMap(splitCommaSeparated));
  }
  if (typeof value === "string") {
    return uniqueSorted(splitCommaSeparated(value));
  }
  return uniqueSorted(fallback);
}

function splitCommaSeparated(value: string): string[] {
  return value
    .split(",")
    .map((item) => item.trim())
    .filter(Boolean);
}

function uniqueSorted(values: readonly string[]): string[] {
  return [...new Set(values)].sort((left, right) => left.localeCompare(right));
}

function estimateSkillTokenCount(input: {
  title?: string | undefined;
  description?: string | undefined;
  headings: readonly string[][];
  keySections: readonly string[];
  topics: readonly string[];
  aliases: readonly string[];
}): number {
  const text = [
    input.title,
    input.description,
    ...input.headings.map((heading) => heading.join(" > ")),
    ...input.keySections,
    ...input.topics,
    ...input.aliases
  ]
    .filter((value): value is string => typeof value === "string" && value.trim().length > 0)
    .join("\n");
  return text.length === 0 ? 0 : estimateTokenCount(text);
}

function assertSkillInput(input: ExtractSkillInput): void {
  if (input.document.kind !== "skill-doc") {
    throw new SkillExtractionError("Skill extraction requires a skill-doc canonical document.", {
      path: input.document.path,
      docId: input.document.docId,
      sourceVersion: input.document.sourceVersion
    });
  }
  if (input.skill.skillId !== input.classifiedDoc.skillId || input.document.metadata.skillId !== input.skill.skillId) {
    throw new SkillExtractionError("Skill node, classified document, and canonical document skill IDs must match.", {
      path: input.document.path,
      docId: input.document.docId,
      sourceVersion: input.document.sourceVersion
    });
  }
}

function extractDescription(input: ExtractSkillInput): string | undefined {
  const source =
    input.document.sections.find((section) => section.headingPath.length === 0 && section.text.trim().length > 0) ??
    input.document.sections.find((section) => section.text.trim().length > 0);
  return source === undefined ? undefined : truncateText(source.text, 280);
}

function selectKeySections(input: ExtractSkillInput): string[] {
  const keyHeadingPattern = /\b(usage|procedure|workflow|steps|examples?|commands?|instructions?|api)\b/i;
  return input.document.sections
    .filter((section) => keyHeadingPattern.test(section.headingPath.join(" ")) && section.text.trim().length > 0)
    .slice(0, 5)
    .map((section) => truncateText(section.text, 260));
}
