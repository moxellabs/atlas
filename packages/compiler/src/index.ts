/** Compatibility version persisted by the indexer to detect rebuild requirements. */
export const ATLAS_COMPILER_VERSION = "atlas-compiler-v1";

export { compileMarkdownDocument } from "./compile-markdown-document";
export { buildCanonicalDocument, resolveDocumentTitle } from "./canonical/build-canonical-doc";
export { buildSections } from "./canonical/build-sections";
export type { BuildSectionsResult } from "./canonical/build-sections";
export { extractCodeBlocks } from "./canonical/extract-code-blocks";
export { buildContextualChunkHeader } from "./contextual/contextual-chunk-header";
export { compilerDiagnostic } from "./diagnostics";
export {
  CanonicalDocumentBuildError,
  CompilerError,
  CompilerFrontmatterError,
  CompilerParseError,
  SkillExtractionError
} from "./errors";
export type { CompilerErrorContext } from "./errors";
export { extractFrontmatter } from "./parse/extract-frontmatter";
export type { ExtractFrontmatterOptions } from "./parse/extract-frontmatter";
export { extractNodeText, normalizeMarkdown } from "./parse/normalize-markdown";
export { parseMarkdown } from "./parse/parse-markdown";
export type { ParseMarkdownOptions } from "./parse/parse-markdown";
export { extractSkill } from "./skills/extract-skill";
export type { ExtractSkillResult } from "./skills/extract-skill";
export { buildDocSummary } from "./summaries/build-doc-summary";
export type { BuildDocSummaryResult } from "./summaries/build-doc-summary";
export { buildModuleSummary } from "./summaries/build-module-summary";
export type { BuildModuleSummaryResult } from "./summaries/build-module-summary";
export { buildOutline } from "./summaries/build-outline";
export type { BuildOutlineOptions, BuildOutlineResult } from "./summaries/build-outline";
export type {
  BuildCanonicalDocumentInput,
  BuildCanonicalDocumentResult,
  BuildDocSummaryOptions,
  BuildModuleSummaryOptions,
  BuildSectionsInput,
  CompileMarkdownDocumentInput,
  CompileMarkdownDocumentResult,
  CompilerDiagnostic,
  CompilerStage,
  ContextualChunkHeader,
  ContextualChunkHeaderInput,
  ExtractedCodeBlock,
  ExtractedSkillContent,
  ExtractSkillInput,
  FrontmatterData,
  FrontmatterExtraction,
  MarkdownNode,
  MarkdownRoot,
  NormalizedMarkdown,
  NormalizedMarkdownBlock,
  OutlineEntry,
  ParsedMarkdown,
  ResolvedDocumentTitle
} from "./types";
