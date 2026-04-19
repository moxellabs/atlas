import matter from "gray-matter";

import { compilerDiagnostic } from "../diagnostics";
import { CompilerFrontmatterError } from "../errors";
import { normalizeLineEndings } from "../text-utils";
import type { FrontmatterData, FrontmatterExtraction } from "../types";

/** Options for optional markdown frontmatter extraction. */
export interface ExtractFrontmatterOptions {
  /** Source path used in diagnostics and errors. */
  path?: string | undefined;
}

/** Extracts optional YAML frontmatter from markdown and returns stripped body content. */
export function extractFrontmatter(markdown: string, options: ExtractFrontmatterOptions = {}): FrontmatterExtraction {
  const content = normalizeLineEndings(markdown);
  if (!startsWithFrontmatter(content)) {
    return {
      present: false,
      data: {},
      content,
      diagnostics: [
        compilerDiagnostic({
          stage: "frontmatter",
          code: "frontmatter.absent",
          message: "No frontmatter block was present.",
          path: options.path
        })
      ]
    };
  }

  assertFrontmatterIsClosed(content, options.path);

  try {
    const parsed = matter(content);
    const data = toPlainFrontmatterData(parsed.data, options.path);
    return {
      present: true,
      data,
      content: normalizeLineEndings(parsed.content),
      diagnostics: [
        compilerDiagnostic({
          stage: "frontmatter",
          code: "frontmatter.present",
          message: `Parsed ${Object.keys(data).length} frontmatter field(s).`,
          path: options.path
        })
      ]
    };
  } catch (error) {
    throw new CompilerFrontmatterError("Malformed frontmatter block.", {
      path: options.path,
      cause: error
    });
  }
}

function startsWithFrontmatter(content: string): boolean {
  return /^---[ \t]*\n/.test(content);
}

function assertFrontmatterIsClosed(content: string, path: string | undefined): void {
  const lines = content.split("\n");
  const closingIndex = lines.findIndex((line, index) => index > 0 && /^---[ \t]*$/.test(line));
  if (closingIndex === -1) {
    throw new CompilerFrontmatterError("Frontmatter opening marker is missing a closing marker.", { path });
  }
}

function toPlainFrontmatterData(value: unknown, path: string | undefined): FrontmatterData {
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    throw new CompilerFrontmatterError("Frontmatter must parse to a mapping object.", { path });
  }
  return Object.fromEntries(Object.entries(value).filter(([, fieldValue]) => fieldValue !== undefined));
}
