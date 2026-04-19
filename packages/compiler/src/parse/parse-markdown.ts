import remarkFrontmatter from "remark-frontmatter";
import remarkGfm from "remark-gfm";
import remarkParse from "remark-parse";
import { unified } from "unified";

import { compilerDiagnostic } from "../diagnostics";
import { CompilerParseError } from "../errors";
import type { MarkdownRoot, ParsedMarkdown } from "../types";
import { extractFrontmatter } from "./extract-frontmatter";

/** Options for AST-based markdown parsing. */
export interface ParseMarkdownOptions {
  /** Source path used in diagnostics and errors. */
  path?: string | undefined;
}

/** Parses markdown with remark/GFM after explicit frontmatter extraction. */
export function parseMarkdown(markdown: string, options: ParseMarkdownOptions = {}): ParsedMarkdown {
  const frontmatter = extractFrontmatter(markdown, { path: options.path });

  try {
    const ast = unified().use(remarkParse).use(remarkFrontmatter).use(remarkGfm).parse(frontmatter.content) as MarkdownRoot;
    const diagnostics = [
      ...frontmatter.diagnostics,
      compilerDiagnostic({
        stage: "parse",
        code: "parse.ok",
        message: `Parsed markdown AST with ${ast.children.length} top-level node(s).`,
        path: options.path
      })
    ];

    return {
      raw: markdown,
      content: frontmatter.content,
      ...(options.path === undefined ? {} : { path: options.path }),
      ast,
      frontmatter,
      diagnostics
    };
  } catch (error) {
    throw new CompilerParseError("Failed to parse markdown content.", {
      path: options.path,
      cause: error
    });
  }
}
