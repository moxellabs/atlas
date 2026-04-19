import { InvalidTokenBudgetError } from "../errors";
import type { BudgetCheckResult, TextEncoder, TokenBudget } from "../types";

/** Validates and returns usable tokens after reserves. */
export function availableTokens(budget: TokenBudget): number {
  assertNonNegativeInteger(budget.maxTokens, "maxTokens");
  const reserved = budget.reservedTokens ?? 0;
  assertNonNegativeInteger(reserved, "reservedTokens");
  if (reserved > budget.maxTokens) {
    throw new InvalidTokenBudgetError("Reserved tokens cannot exceed max tokens.", {
      operation: "availableTokens",
      stage: "budget"
    });
  }
  return budget.maxTokens - reserved;
}

/** Returns remaining tokens after usage and reserve. */
export function remainingBudget(budget: TokenBudget, usedTokens: number): number {
  assertNonNegativeInteger(usedTokens, "usedTokens");
  return availableTokens(budget) - usedTokens;
}

/** Returns true when a token count fits in the budget after reserves. */
export function fitsWithinBudget(usedTokens: number, budget: TokenBudget): boolean {
  return remainingBudget(budget, usedTokens) >= 0;
}

/** Checks usage against a budget and returns exact remaining tokens. */
export function checkBudget(usedTokens: number, budget: TokenBudget): BudgetCheckResult {
  const remainingTokens = remainingBudget(budget, usedTokens);
  return {
    fits: remainingTokens >= 0,
    usedTokens,
    remainingTokens
  };
}

/** Sums validated token counts. */
export function sumTokenCounts(tokenCounts: readonly number[]): number {
  return tokenCounts.reduce((sum, tokenCount) => {
    assertNonNegativeInteger(tokenCount, "tokenCount");
    return sum + tokenCount;
  }, 0);
}

/** Counts and sums text items with an exact encoder. */
export function countTextItems(encoder: TextEncoder, items: readonly string[]): number {
  return sumTokenCounts(items.map((item) => encoder.count(item)));
}

/** Returns true when appending next tokens would fit under max tokens. */
export function canAppend(currentTokens: number, nextTokens: number, budget: TokenBudget): boolean {
  assertNonNegativeInteger(currentTokens, "currentTokens");
  assertNonNegativeInteger(nextTokens, "nextTokens");
  return fitsWithinBudget(currentTokens + nextTokens, budget);
}

function assertNonNegativeInteger(value: number, name: string): void {
  if (!Number.isInteger(value) || value < 0) {
    throw new InvalidTokenBudgetError(`${name} must be a non-negative integer.`, {
      operation: "validateBudget",
      stage: "budget"
    });
  }
}
