import { createChunkId, type CanonicalDocument, type CanonicalSection } from "@atlas/core";

import { InvalidTokenBudgetError } from "../errors";
import { createTextEncoder } from "../encode/encoder";
import { applyOverlap } from "./overlap";
import { splitByBudget } from "./split-by-budget";
import type {
  ChunkBySectionResult,
  ChunkDocumentMetadata,
  ChunkingDiagnostics,
  ChunkingOptions,
  SplitUnit,
  TextEncoder,
  TokenizedChunk
} from "../types";

/** Input accepted by section-wise tokenized chunk construction. */
export type ChunkBySectionInput =
  | {
      document: CanonicalDocument;
      options: ChunkingOptions;
    }
  | {
      sections: readonly CanonicalSection[];
      metadata: ChunkDocumentMetadata;
      options: ChunkingOptions;
    };

/** Builds exact-token chunks from canonical sections using structure-first splitting. */
export function chunkBySection(input: ChunkBySectionInput): ChunkBySectionResult {
  const encoder = createTextEncoder(input.options.encoding);
  validateChunkingOptions(input.options, encoder);
  const sections = "document" in input ? input.document.sections : input.sections;
  const metadata = "document" in input ? metadataFromDocument(input.document) : input.metadata;
  const overlapTokens = input.options.overlapTokens ?? 0;

  const diagnostics: ChunkingDiagnostics = {
    encoding: encoder.name,
    maxTokens: input.options.maxTokens,
    overlapTokens,
    totalSourceTokenCount: 0,
    chunkCount: 0,
    sectionsKeptWhole: 0,
    sectionsSplit: 0,
    hardFallbackUsed: false
  };

  const units = input.options.preserveSectionBoundaries === false
    ? buildPackedUnits(sections, input.options, encoder, diagnostics)
    : buildSectionLocalUnits(sections, input.options, encoder, diagnostics);
  const overlapped = applyOverlap(units, { overlapTokens, maxTokens: input.options.maxTokens, encoder });
  const chunks = overlapped.map((unit, ordinal) => buildTokenizedChunk(unit, ordinal, metadata, encoder, input.options.includeTokenIds === true));

  return {
    chunks,
    diagnostics: {
      ...diagnostics,
      chunkCount: chunks.length
    }
  };
}

function buildSectionLocalUnits(
  sections: readonly CanonicalSection[],
  options: ChunkingOptions,
  encoder: TextEncoder,
  diagnostics: ChunkingDiagnostics
): SplitUnit[] {
  return sections.flatMap((section) => {
    const text = buildSectionText(section);
    const tokenCount = encoder.count(text);
    diagnostics.totalSourceTokenCount += tokenCount;
    if (tokenCount <= options.maxTokens) {
      diagnostics.sectionsKeptWhole += 1;
      return [
        {
          text,
          headingPath: section.headingPath,
          ordinal: section.ordinal,
          sectionId: section.sectionId
        } as SectionSplitUnit
      ];
    }

    diagnostics.sectionsSplit += 1;
    const result = splitByBudget({
      text,
      headingPath: section.headingPath,
      maxTokens: options.maxTokens,
      encoder
    });
    diagnostics.hardFallbackUsed = diagnostics.hardFallbackUsed || result.diagnostics.hardFallbackSplits > 0;
    return result.units.map(
      (unit): SectionSplitUnit => ({
        ...unit,
        headingPath: section.headingPath,
        sectionId: section.sectionId
      })
    );
  });
}

function buildPackedUnits(
  sections: readonly CanonicalSection[],
  options: ChunkingOptions,
  encoder: TextEncoder,
  diagnostics: ChunkingDiagnostics
): SplitUnit[] {
  const sectionUnits = buildSectionLocalUnits(sections, options, encoder, diagnostics) as SectionSplitUnit[];
  const packed: SectionSplitUnit[] = [];
  let current: SectionSplitUnit | undefined;

  for (const unit of sectionUnits) {
    if (current === undefined) {
      current = { ...unit };
      continue;
    }
    const candidateText = `${current.text}\n\n${unit.text}`;
    if (encoder.count(candidateText) <= options.maxTokens) {
      current = {
        ...current,
        text: candidateText,
        headingPath: current.headingPath ?? unit.headingPath
      };
    } else {
      packed.push(current);
      current = { ...unit };
    }
  }
  if (current !== undefined) {
    packed.push(current);
  }
  return packed;
}

interface SectionSplitUnit extends SplitUnit {
  sectionId?: string | undefined;
}

function buildTokenizedChunk(
  unit: SplitUnit,
  ordinal: number,
  metadata: ChunkDocumentMetadata,
  encoder: TextEncoder,
  includeTokenIds: boolean
): TokenizedChunk {
  const sectionId = "sectionId" in unit && typeof unit.sectionId === "string" ? unit.sectionId : undefined;
  const encoded = encoder.encode(unit.text);
  return {
    chunkId: createChunkId({ docId: metadata.docId, ...(sectionId === undefined ? {} : { sectionId }), ordinal }),
    docId: metadata.docId,
    repoId: metadata.repoId,
    ...(metadata.packageId === undefined ? {} : { packageId: metadata.packageId }),
    ...(metadata.moduleId === undefined ? {} : { moduleId: metadata.moduleId }),
    ...(metadata.skillId === undefined ? {} : { skillId: metadata.skillId }),
    ...(sectionId === undefined ? {} : { sectionId }),
    kind: metadata.kind,
    authority: metadata.authority,
    headingPath: unit.headingPath ?? [],
    ordinal,
    text: unit.text,
    tokenCount: encoded.tokenCount,
    encoding: encoder.name,
    ...(includeTokenIds ? { tokenIds: encoded.tokenIds } : {})
  };
}

function buildSectionText(section: CanonicalSection): string {
  const codeText = section.codeBlocks
    .map((block) => `\`\`\`${block.lang ?? ""}\n${block.code}\n\`\`\``)
    .join("\n\n");
  return [section.text, codeText].filter((part) => part.trim().length > 0).join("\n\n");
}

function metadataFromDocument(document: CanonicalDocument): ChunkDocumentMetadata {
  return {
    docId: document.docId,
    repoId: document.repoId,
    ...(document.metadata.packageId === undefined ? {} : { packageId: document.metadata.packageId }),
    ...(document.metadata.moduleId === undefined ? {} : { moduleId: document.metadata.moduleId }),
    ...(document.metadata.skillId === undefined ? {} : { skillId: document.metadata.skillId }),
    kind: document.kind,
    authority: document.authority
  };
}

function validateChunkingOptions(options: ChunkingOptions, encoder: TextEncoder): void {
  if (!Number.isInteger(options.maxTokens) || options.maxTokens < 1) {
    throw new InvalidTokenBudgetError("maxTokens must be a positive integer.", {
      operation: "chunkBySection",
      encoding: encoder.name,
      stage: "options"
    });
  }
  const overlapTokens = options.overlapTokens ?? 0;
  if (!Number.isInteger(overlapTokens) || overlapTokens < 0) {
    throw new InvalidTokenBudgetError("overlapTokens must be a non-negative integer.", {
      operation: "chunkBySection",
      encoding: encoder.name,
      stage: "options"
    });
  }
  if (overlapTokens >= options.maxTokens) {
    throw new InvalidTokenBudgetError("overlapTokens must be smaller than maxTokens.", {
      operation: "chunkBySection",
      encoding: encoder.name,
      stage: "options"
    });
  }
}
