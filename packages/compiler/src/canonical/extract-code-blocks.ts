import type { CanonicalSection } from "@atlas/core";

import type { ExtractedCodeBlock, NormalizedMarkdown, ParsedMarkdown } from "../types";
import { normalizeMarkdown } from "../parse/normalize-markdown";

/** Extracts fenced code blocks from parsed, normalized, or canonical compiler artifacts in source order. */
export function extractCodeBlocks(input: ParsedMarkdown | NormalizedMarkdown | readonly CanonicalSection[]): ExtractedCodeBlock[] {
  if (isCanonicalSectionArray(input)) {
    return input.flatMap((section: CanonicalSection) =>
      section.codeBlocks.map((block, index: number) => ({
        ...block,
        ordinal: section.ordinal + index,
        headingPath: section.headingPath
      }))
    );
  }

  const normalized: NormalizedMarkdown = "blocks" in input ? input : normalizeMarkdown(input);
  return normalized.blocks
    .filter((block) => block.type === "code")
    .map((block, index) => ({
      ...(block.lang === undefined ? {} : { lang: block.lang }),
      code: block.code,
      ordinal: index
    }));
}

function isCanonicalSectionArray(input: ParsedMarkdown | NormalizedMarkdown | readonly CanonicalSection[]): input is readonly CanonicalSection[] {
  return Array.isArray(input);
}
