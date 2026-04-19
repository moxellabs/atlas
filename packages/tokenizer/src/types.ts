import type { Authority, CorpusChunk, DocKind } from "@atlas/core";

/** Supported tokenizer encoding name. */
export type EncodingName = "o200k_base" | "cl100k_base" | "p50k_base" | "r50k_base" | "gpt2";

/** Supported model names can evolve independently from chunking logic. */
export type ModelName = string;

/** Exact encoded text result. */
export interface EncodedText {
  /** Encoding used for tokenization. */
  encoding: EncodingName;
  /** Exact token IDs emitted by the encoder. */
  tokenIds: number[];
  /** Exact token count. */
  tokenCount: number;
}

/** Stable package-local tokenizer abstraction. */
export interface TextEncoder {
  /** Encoding name used by this encoder. */
  name: EncodingName;
  /** Encodes text into exact token IDs and count. */
  encode(text: string): EncodedText;
  /** Decodes exact token IDs back into text. */
  decode(tokenIds: readonly number[]): string;
  /** Counts exact tokens in text. */
  count(text: string): number;
}

/** Token budget configuration for context planning utilities. */
export interface TokenBudget {
  /** Total maximum tokens available. */
  maxTokens: number;
  /** Tokens reserved for caller-controlled overhead. */
  reservedTokens?: number | undefined;
}

/** Result of checking a token budget. */
export interface BudgetCheckResult {
  fits: boolean;
  usedTokens: number;
  remainingTokens: number;
}

/** Options controlling structure-first chunk construction. */
export interface ChunkingOptions {
  /** Encoding name or model name used to resolve an exact encoder. */
  encoding?: EncodingName | ModelName | undefined;
  /** Maximum tokens allowed per final chunk. */
  maxTokens: number;
  /** Optional token-limited overlap prepended from the previous chunk. */
  overlapTokens?: number | undefined;
  /** Preserve section boundaries. Defaults to true. */
  preserveSectionBoundaries?: boolean | undefined;
  /** Include exact token IDs in emitted tokenized chunks. Defaults to false. */
  includeTokenIds?: boolean | undefined;
}

/** Package-local split unit preserving structural lineage. */
export interface SplitUnit {
  /** Unit text. */
  text: string;
  /** Optional heading lineage associated with the unit. */
  headingPath?: string[] | undefined;
  /** Optional source ordinal. */
  ordinal?: number | undefined;
}

/** Result of splitting text by an exact token budget. */
export interface SplitByBudgetResult {
  /** Source-order units that fit within budget. */
  units: SplitUnit[];
  /** Diagnostics about split strategy choices. */
  diagnostics: SplitDiagnostics;
}

/** Split diagnostics useful for explaining chunk boundaries. */
export interface SplitDiagnostics {
  sourceTokenCount: number;
  outputUnitCount: number;
  paragraphSplits: number;
  listSplits: number;
  codeSplits: number;
  sentenceSplits: number;
  hardFallbackSplits: number;
}

/** Tokenized chunk artifact produced by this package. */
export interface TokenizedChunk extends CorpusChunk {
  /** Section ID when the chunk came from a canonical section. */
  sectionId?: string | undefined;
  /** Encoding used to count the chunk. */
  encoding: EncodingName;
  /** Exact token IDs when requested by options. */
  tokenIds?: number[] | undefined;
}

/** Input metadata needed to create core-compatible corpus chunks. */
export interface ChunkDocumentMetadata {
  docId: string;
  repoId: string;
  packageId?: string | undefined;
  moduleId?: string | undefined;
  skillId?: string | undefined;
  kind: DocKind;
  authority: Authority;
}

/** Diagnostics explaining a section chunking run. */
export interface ChunkingDiagnostics {
  encoding: EncodingName;
  maxTokens: number;
  overlapTokens: number;
  totalSourceTokenCount: number;
  chunkCount: number;
  sectionsKeptWhole: number;
  sectionsSplit: number;
  hardFallbackUsed: boolean;
}

/** Output of section-wise chunk construction. */
export interface ChunkBySectionResult {
  chunks: TokenizedChunk[];
  diagnostics: ChunkingDiagnostics;
}

/** Options for applying overlap to text units. */
export interface OverlapOptions {
  overlapTokens: number;
  maxTokens: number;
  encoder: TextEncoder;
}
