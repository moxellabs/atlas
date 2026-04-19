import { createSectionId, type CanonicalSection, type CodeBlockFragment } from "@atlas/core";

import { compilerDiagnostic } from "../diagnostics";
import type { BuildSectionsInput, CompilerDiagnostic, NormalizedMarkdownBlock } from "../types";

/** Result of deterministic canonical section construction. */
export interface BuildSectionsResult {
  /** Source-ordered canonical sections. */
  sections: CanonicalSection[];
  /** Diagnostics explaining section construction. */
  diagnostics: CompilerDiagnostic[];
}

/** Builds source-ordered canonical sections while preserving heading hierarchy and leading content. */
export function buildSections(input: BuildSectionsInput): BuildSectionsResult {
  const builder = new SectionBuilder(input.docId);
  for (const block of input.normalized.blocks) {
    builder.accept(block);
  }
  const sections = builder.finish();
  return {
    sections,
    diagnostics: [
      ...input.normalized.diagnostics,
      compilerDiagnostic({
        stage: "sections",
        code: "sections.created",
        message: `Created ${sections.length} canonical section(s).`,
        path: input.normalized.path,
        docId: input.docId
      }),
      compilerDiagnostic({
        stage: "sections",
        code: "sections.codeBlocks",
        message: `Preserved ${sections.reduce((total, section) => total + section.codeBlocks.length, 0)} code block(s).`,
        path: input.normalized.path,
        docId: input.docId
      })
    ]
  };
}

class SectionBuilder {
  private headingPath: string[] = [];
  private current: MutableSection = createMutableSection([]);
  private readonly sections: MutableSection[] = [];

  constructor(private readonly docId: string) {}

  accept(block: NormalizedMarkdownBlock): void {
    if (block.type === "heading") {
      this.flush();
      this.headingPath = nextHeadingPath(this.headingPath, block.depth, block.text);
      this.current = createMutableSection(this.headingPath);
      return;
    }

    if (block.type === "text") {
      this.current.textParts.push(block.text);
      return;
    }

    this.current.codeBlocks.push({
      ...(block.lang === undefined ? {} : { lang: block.lang }),
      code: block.code
    });
  }

  finish(): CanonicalSection[] {
    this.flush({ includeEmpty: this.sections.length === 0 });
    return this.sections.map((section, ordinal) => ({
      sectionId: createSectionId({ docId: this.docId, headingPath: section.headingPath, ordinal }),
      headingPath: section.headingPath,
      ordinal,
      text: section.textParts.join("\n\n").trim(),
      codeBlocks: section.codeBlocks
    }));
  }

  private flush(options: { includeEmpty?: boolean } = {}): void {
    const hasContent = this.current.textParts.some((part) => part.trim().length > 0) || this.current.codeBlocks.length > 0;
    const hasHeading = this.current.headingPath.length > 0;
    if (hasContent || hasHeading || options.includeEmpty === true) {
      this.sections.push(this.current);
    }
  }
}

interface MutableSection {
  headingPath: string[];
  textParts: string[];
  codeBlocks: CodeBlockFragment[];
}

function createMutableSection(headingPath: string[]): MutableSection {
  return {
    headingPath: [...headingPath],
    textParts: [],
    codeBlocks: []
  };
}

function nextHeadingPath(current: readonly string[], depth: number, text: string): string[] {
  const normalizedText = text.trim();
  const path = current.slice(0, Math.max(depth - 1, 0));
  while (path.length < depth - 1) {
    path.push("");
  }
  path.push(normalizedText);
  return path;
}
