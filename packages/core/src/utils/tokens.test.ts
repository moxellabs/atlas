import { describe, expect, test } from "bun:test";

import { estimateTokenCount, fitsWithinTokenBudget, sumTokenCounts } from "./tokens";

describe("estimateTokenCount", () => {
  test("returns a deterministic nonzero estimate for text", () => {
    expect(estimateTokenCount("ATLAS local docs")).toBe(4);
  });

  test("handles empty text and token budget arithmetic", () => {
    expect(estimateTokenCount("   ")).toBe(0);
    expect(sumTokenCounts(1, 2, 3)).toBe(6);
    expect(fitsWithinTokenBudget(6, 6)).toBe(true);
    expect(fitsWithinTokenBudget(7, 6)).toBe(false);
    expect(() => sumTokenCounts(1.2)).toThrow(TypeError);
  });
});
