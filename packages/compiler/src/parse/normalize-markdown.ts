import { compilerDiagnostic } from "../diagnostics";
import { collapseWhitespace } from "../text-utils";
import type { MarkdownNode, NormalizedMarkdown, NormalizedMarkdownBlock, ParsedMarkdown } from "../types";

/** Converts a parsed markdown AST into source-ordered compiler-friendly blocks. */
export function normalizeMarkdown(parsed: ParsedMarkdown): NormalizedMarkdown {
  const blocks = parsed.ast.children.flatMap((node, index) => normalizeTopLevelNode(node, index));
  return {
    ...(parsed.path === undefined ? {} : { path: parsed.path }),
    raw: parsed.raw,
    content: parsed.content,
    frontmatter: parsed.frontmatter,
    blocks,
    diagnostics: [
      ...parsed.diagnostics,
      compilerDiagnostic({
        stage: "normalize",
        code: "normalize.blocks",
        message: `Normalized markdown into ${blocks.length} source-ordered block(s).`,
        path: parsed.path
      })
    ]
  };
}

/** Extracts readable plain text from markdown inline or block nodes. */
export function extractNodeText(node: MarkdownNode): string {
  if (typeof node.value === "string") {
    return node.value;
  }
  if (Array.isArray(node.children)) {
    return collapseWhitespace(node.children.map(extractNodeText).filter(Boolean).join(" "));
  }
  return "";
}

function normalizeTopLevelNode(node: MarkdownNode, ordinal: number): NormalizedMarkdownBlock[] {
  if (node.type === "heading") {
    return [
      {
        type: "heading",
        depth: normalizeHeadingDepth(node.depth),
        text: extractNodeText(node),
        ordinal
      }
    ];
  }

  if (node.type === "code") {
    return [
      {
        type: "code",
        ...(typeof node.lang === "string" && node.lang.length > 0 ? { lang: node.lang } : {}),
        code: typeof node.value === "string" ? node.value : "",
        ordinal
      }
    ];
  }

  const text = renderBlockNode(node);
  return text.length === 0 ? [] : [{ type: "text", text, ordinal }];
}

function normalizeHeadingDepth(depth: number | undefined): number {
  return Number.isInteger(depth) && depth !== undefined && depth >= 1 && depth <= 6 ? depth : 1;
}

function renderBlockNode(node: MarkdownNode): string {
  switch (node.type) {
    case "paragraph":
      return extractNodeText(node);
    case "blockquote":
      return renderChildren(node)
        .split("\n")
        .filter((line) => line.length > 0)
        .map((line) => `> ${line}`)
        .join("\n");
    case "list":
      return renderList(node);
    case "table":
      return renderTable(node);
    case "html":
      return typeof node.value === "string" ? node.value.trim() : "";
    case "thematicBreak":
      return "---";
    case "definition":
    case "footnoteDefinition":
      return "";
    default:
      return renderChildren(node);
  }
}

function renderChildren(node: MarkdownNode): string {
  if (!Array.isArray(node.children)) {
    return extractNodeText(node);
  }
  return node.children.map(renderBlockNode).filter(Boolean).join("\n");
}

function renderList(node: MarkdownNode): string {
  if (!Array.isArray(node.children)) {
    return "";
  }
  const ordered = node.ordered === true;
  return node.children
    .map((child, index) => {
      const marker = ordered ? `${index + 1}.` : "-";
      const checkbox = child.checked === true ? "[x] " : child.checked === false ? "[ ] " : "";
      const rendered = renderChildren(child).replace(/\n/g, "\n  ");
      return `${marker} ${checkbox}${rendered}`.trimEnd();
    })
    .join("\n");
}

function renderTable(node: MarkdownNode): string {
  if (!Array.isArray(node.children)) {
    return "";
  }
  return node.children
    .map((row) => {
      if (!Array.isArray(row.children)) {
        return "";
      }
      const cells = row.children.map((cell) => extractNodeText(cell));
      return cells.join(" | ");
    })
    .filter(Boolean)
    .join("\n");
}
