import { estimateTokenCount, stableHash, stableJson, type CanonicalDocument, type SummaryArtifact } from "@atlas/core";

import { compilerDiagnostic } from "../diagnostics";
import { formatHeadingPath, truncateText } from "../text-utils";
import type { BuildDocSummaryOptions, CompilerDiagnostic } from "../types";

/** Result of deterministic document summary generation. */
export interface BuildDocSummaryResult {
  /** Summary artifact for the requested level. */
  summary: SummaryArtifact;
  /** Diagnostics explaining deterministic summary construction. */
  diagnostics: CompilerDiagnostic[];
}

/** Builds a deterministic rule-based document summary without model calls. */
export function buildDocSummary(document: CanonicalDocument, options: BuildDocSummaryOptions): BuildDocSummaryResult {
  const maxCharacters = options.maxCharacters ?? (options.level === "short" ? 220 : 520);
  const text = options.level === "short" ? buildShortSummary(document, maxCharacters) : buildMediumSummary(document, maxCharacters);
  const summary: SummaryArtifact = {
    summaryId: createSummaryId(document.docId, options.level),
    targetType: "document",
    targetId: document.docId,
    level: options.level,
    text,
    tokenCount: estimateTokenCount(text)
  };

  return {
    summary,
    diagnostics: [
      compilerDiagnostic({
        stage: "summary",
        code: `summary.${options.level}`,
        message: `Built ${options.level} deterministic document summary.`,
        path: document.path,
        docId: document.docId
      })
    ]
  };
}

function buildShortSummary(document: CanonicalDocument, maxCharacters: number): string {
  const title = document.title ?? document.path;
  const firstSection = document.sections.find((section) => section.text.trim().length > 0);
  const preview = firstSection === undefined ? "" : ` ${truncateText(firstSection.text, Math.max(60, maxCharacters - title.length - 3))}`;
  return truncateText(`${title}.${preview}`, maxCharacters);
}

function buildMediumSummary(document: CanonicalDocument, maxCharacters: number): string {
  const title = document.title ?? document.path;
  const headings = document.sections
    .filter((section) => section.headingPath.length > 0)
    .slice(0, 5)
    .map((section) => formatHeadingPath(section.headingPath));
  const opening = document.sections.find((section) => section.text.trim().length > 0)?.text ?? "";
  const headingText = headings.length === 0 ? "No headings." : `Headings: ${headings.join("; ")}.`;
  return truncateText(`${title}. ${headingText} ${opening}`, maxCharacters);
}

function createSummaryId(targetId: string, level: "short" | "medium"): string {
  return `summary_${stableHash(stableJson({ targetType: "document", targetId, level })).slice(0, 24)}`;
}
