import { estimateTokenCount, stableHash, stableJson, type CanonicalDocument, type SummaryArtifact } from "@atlas/core";

import { compilerDiagnostic } from "../diagnostics";
import { truncateText } from "../text-utils";
import type { BuildModuleSummaryOptions, CompilerDiagnostic } from "../types";

/** Result of deterministic module summary generation. */
export interface BuildModuleSummaryResult {
  /** Module-level summary artifact. */
  summary: SummaryArtifact;
  /** Diagnostics explaining deterministic aggregation. */
  diagnostics: CompilerDiagnostic[];
}

/** Builds a deterministic module summary, preferring higher-authority documents first. */
export function buildModuleSummary(
  documents: readonly CanonicalDocument[],
  options: BuildModuleSummaryOptions
): BuildModuleSummaryResult {
  const maxDocuments = options.maxDocuments ?? 6;
  const maxCharacters = options.maxCharacters ?? 700;
  const eligible = documents
    .filter((document) => document.metadata.moduleId === options.moduleId || hasModuleScope(document, options.moduleId))
    .sort(compareDocumentsForModuleSummary)
    .slice(0, maxDocuments);
  const lines = eligible.map((document) => {
    const title = document.title ?? document.path;
    const firstHeading = document.sections.find((section) => section.headingPath.length > 0)?.headingPath.join(" > ");
    const firstText = document.sections.find((section) => section.text.trim().length > 0)?.text ?? "";
    const detail = firstHeading === undefined ? firstText : `${firstHeading}. ${firstText}`;
    return `- ${title}: ${truncateText(detail, 160)}`;
  });
  const text =
    lines.length === 0
      ? `Module ${options.moduleId} has no compiled documents.`
      : truncateText(`Module ${options.moduleId} documentation:\n${lines.join("\n")}`, maxCharacters);
  const summary: SummaryArtifact = {
    summaryId: `summary_${stableHash(stableJson({ targetType: "module", targetId: options.moduleId, level: "medium" })).slice(0, 24)}`,
    targetType: "module",
    targetId: options.moduleId,
    level: "medium",
    text,
    tokenCount: estimateTokenCount(text)
  };

  return {
    summary,
    diagnostics: [
      compilerDiagnostic({
        stage: "module-summary",
        code: "moduleSummary.medium",
        message: `Built module summary from ${eligible.length} document(s).`
      })
    ]
  };
}

function hasModuleScope(document: CanonicalDocument, moduleId: string): boolean {
  return document.scopes.some((scope) => scope.level === "module" && scope.moduleId === moduleId);
}

function compareDocumentsForModuleSummary(left: CanonicalDocument, right: CanonicalDocument): number {
  return authorityRank(left) - authorityRank(right) || left.path.localeCompare(right.path);
}

function authorityRank(document: CanonicalDocument): number {
  switch (document.authority) {
    case "canonical":
      return 0;
    case "preferred":
      return 1;
    case "supplemental":
      return 2;
  }
}
