import type { CanonicalDocument } from "@atlas/core";

import { compilerDiagnostic } from "../diagnostics";
import { truncateText } from "../text-utils";
import type { CompilerDiagnostic, OutlineEntry } from "../types";

/** Options for compact outline generation. */
export interface BuildOutlineOptions {
  /** Include section text previews when true. */
  includePreviews?: boolean | undefined;
  /** Maximum preview length when previews are enabled. */
  previewMaxCharacters?: number | undefined;
}

/** Result of deterministic outline generation. */
export interface BuildOutlineResult {
  /** Source-ordered outline entries. */
  outline: OutlineEntry[];
  /** Diagnostics explaining outline construction. */
  diagnostics: CompilerDiagnostic[];
}

/** Builds a compact source-ordered structural outline from a canonical document. */
export function buildOutline(document: CanonicalDocument, options: BuildOutlineOptions = {}): BuildOutlineResult {
  const includePreviews = options.includePreviews ?? true;
  const previewMaxCharacters = options.previewMaxCharacters ?? 120;
  const outline = document.sections.map((section): OutlineEntry => {
    const preview = includePreviews && section.text.trim().length > 0 ? truncateText(section.text, previewMaxCharacters) : undefined;
    return {
      headingPath: section.headingPath,
      ordinal: section.ordinal,
      ...(preview === undefined ? {} : { preview })
    };
  });

  return {
    outline,
    diagnostics: [
      compilerDiagnostic({
        stage: "outline",
        code: "outline.created",
        message: `Built outline with ${outline.length} entr${outline.length === 1 ? "y" : "ies"}.`,
        path: document.path,
        docId: document.docId
      })
    ]
  };
}
