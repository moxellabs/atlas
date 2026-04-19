/** Returns a deterministic rough token estimate for generic budget planning. */
export function estimateTokenCount(text: string): number {
  const trimmed = text.trim();
  return trimmed.length === 0 ? 0 : Math.ceil(trimmed.length / 4);
}

/** Returns true when a token count fits within a non-negative token budget. */
export function fitsWithinTokenBudget(tokenCount: number, budget: number): boolean {
  assertNonNegativeInteger(tokenCount, "tokenCount");
  assertNonNegativeInteger(budget, "budget");
  return tokenCount <= budget;
}

/** Adds token counts after validating that every input is a non-negative integer. */
export function sumTokenCounts(...tokenCounts: number[]): number {
  return tokenCounts.reduce((total, tokenCount) => {
    assertNonNegativeInteger(tokenCount, "tokenCount");
    return total + tokenCount;
  }, 0);
}

function assertNonNegativeInteger(value: number, name: string): void {
  if (!Number.isInteger(value) || value < 0) {
    throw new TypeError(`${name} must be a non-negative integer.`);
  }
}
