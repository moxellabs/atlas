import { describe, expect, test } from "bun:test";

import { stableHash } from "./hash";
import { stableJson } from "./stable-json";

describe("stableJson", () => {
  test("orders object keys recursively", () => {
    expect(stableJson({ b: 1, a: { d: 4, c: 3 } })).toBe(stableJson({ a: { c: 3, d: 4 }, b: 1 }));
  });

  test("preserves array order", () => {
    expect(stableJson({ values: [2, 1] })).not.toBe(stableJson({ values: [1, 2] }));
  });
});

describe("stableHash", () => {
  test("returns deterministic sha-256 hex digests", () => {
    const digest = stableHash("atlas");

    expect(digest).toHaveLength(64);
    expect(digest).toBe(stableHash("atlas"));
    expect(digest).not.toBe(stableHash("ATLAS"));
  });
});
