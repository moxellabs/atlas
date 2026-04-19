import type {
	Authority,
	CanonicalDocument,
	CanonicalSection,
	ClassifiedDoc,
	CodeBlockFragment,
	DocKind,
	DocMetadataRule,
	SkillNode,
} from "@atlas/core";

/** Compiler pipeline stages used by errors and diagnostics. */
export type CompilerStage =
	| "frontmatter"
	| "parse"
	| "normalize"
	| "sections"
	| "canonical"
	| "outline"
	| "summary"
	| "module-summary"
	| "skill"
	| "contextual-header";

/** Machine-readable compiler diagnostic emitted by deterministic compiler steps. */
export interface CompilerDiagnostic {
	/** Pipeline stage that produced the diagnostic. */
	stage: CompilerStage;
	/** Stable diagnostic code suitable for tests and logs. */
	code: string;
	/** Human-readable explanation of the compiler decision. */
	message: string;
	/** Optional source path associated with the diagnostic. */
	path?: string | undefined;
	/** Optional document identifier associated with the diagnostic. */
	docId?: string | undefined;
}

/** Plain frontmatter object parsed from a markdown document. */
export type FrontmatterData = Record<string, unknown>;

/** Result of optional YAML frontmatter extraction. */
export interface FrontmatterExtraction {
	/** True when a frontmatter marker block was present. */
	present: boolean;
	/** Parsed frontmatter data. Empty when no frontmatter exists. */
	data: FrontmatterData;
	/** Markdown content after frontmatter has been removed. */
	content: string;
	/** Diagnostics explaining extraction behavior. */
	diagnostics: CompilerDiagnostic[];
}

/** Minimal structural markdown root consumed by compiler steps. */
export interface MarkdownRoot {
	type: "root";
	children: MarkdownNode[];
}

/** Minimal structural markdown node shape used without coupling public API to mdast. */
export interface MarkdownNode {
	type: string;
	value?: string | undefined;
	lang?: string | undefined;
	depth?: number | undefined;
	ordered?: boolean | undefined;
	checked?: boolean | null | undefined;
	children?: MarkdownNode[] | undefined;
	[key: string]: unknown;
}

/** Parsed markdown document with frontmatter already separated from body content. */
export interface ParsedMarkdown {
	/** Original markdown supplied by the caller. */
	raw: string;
	/** Markdown body parsed by remark after frontmatter stripping. */
	content: string;
	/** Repository-relative path when known. */
	path?: string | undefined;
	/** Parsed syntax tree. */
	ast: MarkdownRoot;
	/** Frontmatter extraction result. */
	frontmatter: FrontmatterExtraction;
	/** Diagnostics from parsing and frontmatter extraction. */
	diagnostics: CompilerDiagnostic[];
}

/** Normalized content block emitted from top-level markdown traversal. */
export type NormalizedMarkdownBlock =
	| {
			type: "heading";
			depth: number;
			text: string;
			ordinal: number;
	  }
	| {
			type: "text";
			text: string;
			ordinal: number;
	  }
	| {
			type: "code";
			lang?: string | undefined;
			code: string;
			ordinal: number;
	  };

/** Compiler-friendly markdown representation preserving source order. */
export interface NormalizedMarkdown {
	/** Source path when known. */
	path?: string | undefined;
	/** Original markdown supplied by the caller. */
	raw: string;
	/** Markdown body after frontmatter stripping and line-ending normalization. */
	content: string;
	/** Parsed frontmatter data and diagnostics. */
	frontmatter: FrontmatterExtraction;
	/** Source-ordered normalized content blocks. */
	blocks: NormalizedMarkdownBlock[];
	/** Diagnostics from normalization and earlier stages. */
	diagnostics: CompilerDiagnostic[];
}

/** Input accepted by canonical section construction. */
export interface BuildSectionsInput {
	/** Stable document identifier used to derive section IDs. */
	docId: string;
	/** Normalized markdown content. */
	normalized: NormalizedMarkdown;
}

/** Title plus explanation chosen by deterministic title resolution. */
export interface ResolvedDocumentTitle {
	/** Resolved title, if one was found. */
	title?: string | undefined;
	/** Deterministic precedence source used to choose the title. */
	source: "frontmatter" | "h1" | "heading" | "none";
}

/** Input accepted by canonical document assembly. */
export interface BuildCanonicalDocumentInput {
	/** Topology-classified document identity and scope. */
	classifiedDoc: ClassifiedDoc;
	/** Source revision or version supplied by the source adapter. */
	sourceVersion: string;
	/** Normalized markdown content. */
	normalized: NormalizedMarkdown;
	/** Canonical sections for the document. If omitted, sections are built. */
	sections?: CanonicalSection[] | undefined;
	/** Optional repo-level document metadata rules. */
	metadataRules?: DocMetadataRule[] | undefined;
}

/** Canonical document plus compiler diagnostics from assembly. */
export interface BuildCanonicalDocumentResult {
	/** Canonical document consumed by downstream packages. */
	document: CanonicalDocument;
	/** Deterministic title decision. */
	title: ResolvedDocumentTitle;
	/** Compiler diagnostics emitted during assembly. */
	diagnostics: CompilerDiagnostic[];
}

/** Compact structural document outline entry. */
export interface OutlineEntry {
	/** Heading lineage for the section. */
	headingPath: string[];
	/** Section ordinal in source order. */
	ordinal: number;
	/** Optional deterministic preview of section content. */
	preview?: string | undefined;
}

/** Options for deterministic document summary generation. */
export interface BuildDocSummaryOptions {
	/** Summary level to generate. */
	level: "short" | "medium";
	/** Maximum number of characters in the generated summary text. */
	maxCharacters?: number | undefined;
}

/** Options for deterministic module summary generation. */
export interface BuildModuleSummaryOptions {
	/** Module identifier to summarize. */
	moduleId: string;
	/** Maximum number of documents to include after authority and path ordering. */
	maxDocuments?: number | undefined;
	/** Maximum number of characters in the generated summary text. */
	maxCharacters?: number | undefined;
}

/** Extracted skill content derived from a compiled skill document. */
export interface ExtractedSkillContent {
	/** Stable skill identifier from topology. */
	skillId: string;
	/** Resolved skill title when available. */
	title?: string | undefined;
	/** Deterministically selected introductory description when available. */
	description?: string | undefined;
	/** Heading paths present in the compiled skill document. */
	headings: string[][];
	/** Key section excerpts selected by transparent heading rules. */
	keySections: string[];
	/** Topic labels from skill metadata or document tags. */
	topics: string[];
	/** Alternate names or invocation phrases from skill metadata. */
	aliases: string[];
	/** Deterministic estimated token count for skill metadata. */
	tokenCount: number;
}

/** Input for deterministic skill extraction. */
export interface ExtractSkillInput {
	/** Topology skill node. */
	skill: SkillNode;
	/** Topology classification for the source skill document. */
	classifiedDoc: ClassifiedDoc;
	/** Compiled canonical skill document. */
	document: CanonicalDocument;
	/** Parsed frontmatter for the compiled skill document. */
	frontmatter?: FrontmatterData | undefined;
}

/** Contextual retrieval header input for future chunk enrichment. */
export interface ContextualChunkHeaderInput {
	repoId: string;
	packageId?: string | undefined;
	moduleId?: string | undefined;
	skillId?: string | undefined;
	docKind: DocKind;
	authority: Authority;
	title?: string | undefined;
	headingPath?: string[] | undefined;
}

/** Contextual retrieval header payload and rendered compact text. */
export interface ContextualChunkHeader {
	/** Structured deterministic context fields. */
	input: ContextualChunkHeaderInput;
	/** Compact additive text suitable for prepending to chunk content. */
	text: string;
}

/** Output of the top-level deterministic markdown compilation pipeline. */
export interface CompileMarkdownDocumentResult {
	/** Parsed markdown tree and frontmatter. */
	parsed: ParsedMarkdown;
	/** Normalized source-ordered blocks. */
	normalized: NormalizedMarkdown;
	/** Compiled canonical document result. */
	canonical: BuildCanonicalDocumentResult;
}

/** Input for the top-level deterministic markdown compilation pipeline. */
export interface CompileMarkdownDocumentInput {
	/** Raw markdown content. */
	markdown: string;
	/** Topology-classified document identity and scope. */
	classifiedDoc: ClassifiedDoc;
	/** Source revision or version supplied by the source adapter. */
	sourceVersion: string;
	/** Optional repo-level document metadata rules. */
	metadataRules?: DocMetadataRule[] | undefined;
}

/** Result of ordered code block extraction. */
export interface ExtractedCodeBlock extends CodeBlockFragment {
	/** Source-order ordinal of the code block. */
	ordinal: number;
	/** Heading lineage if extracted from canonical sections. */
	headingPath?: string[] | undefined;
}
