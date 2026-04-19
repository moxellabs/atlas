import { describe, expect, expectTypeOf, test } from "bun:test";

import type { SourceChange } from "./change.types";

describe("SourceChange", () => {
  test("preserves raw source fidelity separately from normalized semantics", () => {
    expectTypeOf<SourceChange["rawKind"]>().toEqualTypeOf<
      "added" | "modified" | "deleted" | "renamed" | "copied" | "type-changed"
    >();
    expectTypeOf<SourceChange["normalizedKind"]>().toEqualTypeOf<"added" | "modified" | "deleted" | "renamed">();
    expectTypeOf<SourceChange["path"]>().toEqualTypeOf<string>();
    expectTypeOf<SourceChange["oldPath"]>().toEqualTypeOf<string | undefined>();
  });

  test("represents copied changes without losing the original path", () => {
    const change: SourceChange = {
      rawKind: "copied",
      normalizedKind: "modified",
      oldPath: "docs/source.md",
      path: "docs/copy.md"
    };

    expect(change).toEqual({
      rawKind: "copied",
      normalizedKind: "modified",
      oldPath: "docs/source.md",
      path: "docs/copy.md"
    });
  });

  test("represents type changes as raw type-changed and normalized modified", () => {
    const change: SourceChange = {
      rawKind: "type-changed",
      normalizedKind: "modified",
      path: "bin/tool"
    };

    expect(change).toEqual({
      rawKind: "type-changed",
      normalizedKind: "modified",
      path: "bin/tool"
    });
  });

  test("represents renamed changes with old and new paths", () => {
    const change: SourceChange = {
      rawKind: "renamed",
      normalizedKind: "renamed",
      oldPath: "docs/old.md",
      path: "docs/new.md"
    };

    expect(change).toEqual({
      rawKind: "renamed",
      normalizedKind: "renamed",
      oldPath: "docs/old.md",
      path: "docs/new.md"
    });
  });

  test("represents deleted changes with the deleted path", () => {
    const change: SourceChange = {
      rawKind: "deleted",
      normalizedKind: "deleted",
      path: "docs/removed.md"
    };

    expect(change).toEqual({
      rawKind: "deleted",
      normalizedKind: "deleted",
      path: "docs/removed.md"
    });
  });
});
