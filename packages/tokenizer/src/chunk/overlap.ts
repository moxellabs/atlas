import { InvalidTokenBudgetError } from "../errors";
import type { OverlapOptions, SplitUnit } from "../types";

/** Applies explicit token-limited trailing overlap between adjacent split units. */
export function applyOverlap(units: readonly SplitUnit[], options: OverlapOptions): SplitUnit[] {
  validateOverlapOptions(options);
  if (options.overlapTokens === 0 || units.length <= 1) {
    return [...units];
  }

  return units.map((unit, index) => {
    if (index === 0) {
      return { ...unit };
    }

    const previous = units[index - 1];
    if (previous === undefined) {
      return { ...unit };
    }

    const currentTokenCount = options.encoder.count(unit.text);
    const overlapBudget = Math.min(options.overlapTokens, Math.max(options.maxTokens - currentTokenCount, 0));
    if (overlapBudget === 0) {
      return { ...unit };
    }

    const overlapText = takeTrailingTokens(previous.text, overlapBudget, options);
    if (overlapText.length === 0) {
      return { ...unit };
    }

    return {
      ...unit,
      text: `${overlapText}\n\n${unit.text}`
    };
  });
}

/** Returns trailing text from the previous chunk bounded by exact token count. */
export function takeTrailingTokens(text: string, tokenCount: number, options: Pick<OverlapOptions, "encoder">): string {
  if (!Number.isInteger(tokenCount) || tokenCount < 0) {
    throw new InvalidTokenBudgetError("overlap token count must be a non-negative integer.", {
      operation: "takeTrailingTokens",
      encoding: options.encoder.name,
      stage: "overlap"
    });
  }
  if (tokenCount === 0 || text.length === 0) {
    return "";
  }
  const tokenIds = options.encoder.encode(text).tokenIds;
  return options.encoder.decode(tokenIds.slice(Math.max(tokenIds.length - tokenCount, 0)));
}

function validateOverlapOptions(options: OverlapOptions): void {
  if (!Number.isInteger(options.maxTokens) || options.maxTokens < 1) {
    throw new InvalidTokenBudgetError("maxTokens must be a positive integer.", {
      operation: "applyOverlap",
      encoding: options.encoder.name,
      stage: "overlap"
    });
  }
  if (!Number.isInteger(options.overlapTokens) || options.overlapTokens < 0) {
    throw new InvalidTokenBudgetError("overlapTokens must be a non-negative integer.", {
      operation: "applyOverlap",
      encoding: options.encoder.name,
      stage: "overlap"
    });
  }
  if (options.overlapTokens >= options.maxTokens) {
    throw new InvalidTokenBudgetError("overlapTokens must be smaller than maxTokens.", {
      operation: "applyOverlap",
      encoding: options.encoder.name,
      stage: "overlap"
    });
  }
}
