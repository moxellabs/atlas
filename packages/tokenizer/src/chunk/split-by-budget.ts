import { ChunkSplitError, InvalidTokenBudgetError } from "../errors";
import type { SplitByBudgetResult, SplitDiagnostics, SplitUnit, TextEncoder } from "../types";

/** Options for deterministic token-budget text splitting. */
export interface SplitByBudgetOptions {
  text: string;
  headingPath?: string[] | undefined;
  maxTokens: number;
  encoder: TextEncoder;
}

/** Splits text into source-ordered units that fit an exact token budget. */
export function splitByBudget(options: SplitByBudgetOptions): SplitByBudgetResult {
  validateSplitOptions(options);
  const sourceTokenCount = options.encoder.count(options.text);
  const diagnostics = emptyDiagnostics(sourceTokenCount);

  if (sourceTokenCount <= options.maxTokens) {
    return {
      units: [{ text: options.text, ...(options.headingPath === undefined ? {} : { headingPath: options.headingPath }), ordinal: 0 }],
      diagnostics: { ...diagnostics, outputUnitCount: 1 }
    };
  }

  const atomicUnits = buildAtomicUnits(options.text, diagnostics);
  const packed = packUnits(atomicUnits, options, diagnostics);
  return {
    units: packed.map((unit, ordinal) => ({ ...unit, ordinal })),
    diagnostics: { ...diagnostics, outputUnitCount: packed.length }
  };
}

interface AtomicUnit {
  text: string;
}

function validateSplitOptions(options: SplitByBudgetOptions): void {
  if (!Number.isInteger(options.maxTokens) || options.maxTokens < 1) {
    throw new InvalidTokenBudgetError("maxTokens must be a positive integer.", {
      operation: "splitByBudget",
      encoding: options.encoder.name,
      stage: "options"
    });
  }
}

function emptyDiagnostics(sourceTokenCount: number): SplitDiagnostics {
  return {
    sourceTokenCount,
    outputUnitCount: 0,
    paragraphSplits: 0,
    listSplits: 0,
    codeSplits: 0,
    sentenceSplits: 0,
    hardFallbackSplits: 0
  };
}

function buildAtomicUnits(text: string, diagnostics: SplitDiagnostics): AtomicUnit[] {
  const paragraphUnits = splitByParagraphs(text);
  if (paragraphUnits.length > 1) {
    diagnostics.paragraphSplits += paragraphUnits.length - 1;
  }

  return paragraphUnits.flatMap((paragraph) => {
    const codeUnits = splitByCodeFences(paragraph);
    if (codeUnits.length > 1) {
      diagnostics.codeSplits += codeUnits.length - 1;
    }
    return codeUnits.flatMap((codeUnit) => {
      const listUnits = splitByListItems(codeUnit);
      if (listUnits.length > 1) {
        diagnostics.listSplits += listUnits.length - 1;
      }
      return listUnits.flatMap((listUnit) => {
        const sentenceUnits = splitBySentences(listUnit);
        if (sentenceUnits.length > 1) {
          diagnostics.sentenceSplits += sentenceUnits.length - 1;
        }
        return sentenceUnits.map((unit) => ({ text: unit }));
      });
    });
  });
}

function packUnits(units: readonly AtomicUnit[], options: SplitByBudgetOptions, diagnostics: SplitDiagnostics): SplitUnit[] {
  const output: SplitUnit[] = [];
  let current = "";

  for (const unit of units) {
    const fragments = splitUnitIfNeeded(unit.text, options, diagnostics);
    for (const fragment of fragments) {
      const candidate = current.length === 0 ? fragment : `${current}\n\n${fragment}`;
      if (options.encoder.count(candidate) <= options.maxTokens) {
        current = candidate;
      } else {
        if (current.length > 0) {
          output.push(withHeading(current, options.headingPath));
        }
        current = fragment;
      }
    }
  }

  if (current.length > 0 || output.length === 0) {
    output.push(withHeading(current, options.headingPath));
  }
  return output;
}

function splitUnitIfNeeded(unit: string, options: SplitByBudgetOptions, diagnostics: SplitDiagnostics): string[] {
  if (options.encoder.count(unit) <= options.maxTokens) {
    return [unit];
  }

  const tokenIds = options.encoder.encode(unit).tokenIds;
  if (options.maxTokens < 1) {
    throw new ChunkSplitError("Cannot split text with a budget below one token.", {
      operation: "splitByBudget",
      encoding: options.encoder.name,
      stage: "hardFallback"
    });
  }

  diagnostics.hardFallbackSplits += Math.ceil(tokenIds.length / options.maxTokens) - 1;
  const chunks: string[] = [];
  for (let index = 0; index < tokenIds.length; index += options.maxTokens) {
    chunks.push(options.encoder.decode(tokenIds.slice(index, index + options.maxTokens)));
  }
  return chunks;
}

function withHeading(text: string, headingPath: string[] | undefined): SplitUnit {
  return {
    text,
    ...(headingPath === undefined ? {} : { headingPath })
  };
}

function splitByParagraphs(text: string): string[] {
  return splitAndKeep(text, /\n{2,}/g);
}

function splitByCodeFences(text: string): string[] {
  if (!text.includes("```")) {
    return [text];
  }
  const parts = text.split(/(```[\s\S]*?```)/g).filter((part) => part.length > 0);
  return parts.length === 0 ? [text] : parts;
}

function splitByListItems(text: string): string[] {
  const lines = text.split("\n");
  if (lines.filter((line) => /^(\s*[-*+]|\s*\d+\.)\s+/.test(line)).length < 2) {
    return [text];
  }

  const items: string[] = [];
  let current = "";
  for (const line of lines) {
    if (/^(\s*[-*+]|\s*\d+\.)\s+/.test(line) && current.length > 0) {
      items.push(current.trimEnd());
      current = line;
    } else {
      current = current.length === 0 ? line : `${current}\n${line}`;
    }
  }
  if (current.length > 0) {
    items.push(current.trimEnd());
  }
  return items;
}

function splitBySentences(text: string): string[] {
  const parts = text.match(/[^.!?\n]+[.!?]+(?:\s+|$)|[^.!?\n]+(?:\n|$)/g);
  if (parts === null || parts.length < 2) {
    return [text];
  }
  return parts.map((part) => part.trim()).filter((part) => part.length > 0);
}

function splitAndKeep(text: string, separator: RegExp): string[] {
  return text
    .split(separator)
    .map((part) => part.trim())
    .filter((part) => part.length > 0);
}
