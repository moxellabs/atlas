import { describe, expect, test } from "bun:test";

import { parseNameStatusOutput, parseNullDelimitedPaths, parseRevisionOutput } from "./parse-git-output";

describe("parseRevisionOutput", () => {
  test("returns a trimmed revision", () => {
    expect(parseRevisionOutput("abc123\n")).toBe("abc123");
  });
});

describe("parseNameStatusOutput", () => {
  test("parses added, modified, deleted, and renamed paths", () => {
    const output = [
      "A",
      "docs/new.md",
      "M",
      "README.md",
      "D",
      "old.md",
      "R100",
      "docs/a.md",
      "docs/b.md",
      "C100",
      "docs/source.md",
      "docs/copy.md",
      "T",
      "bin/tool",
      ""
    ].join("\0");

    expect(parseNameStatusOutput(output)).toEqual([
      { status: "A", path: "docs/new.md" },
      { status: "M", path: "README.md" },
      { status: "D", path: "old.md" },
      { status: "R", oldPath: "docs/a.md", path: "docs/b.md" },
      { status: "C", oldPath: "docs/source.md", path: "docs/copy.md" },
      { status: "T", path: "bin/tool" }
    ]);
  });

  test("rejects malformed rename output", () => {
    expect(() => parseNameStatusOutput(["R100", "docs/a.md"].join("\0"))).toThrow(
      "Malformed Git name-status output"
    );
  });
});

describe("parseNullDelimitedPaths", () => {
  test("parses NUL-delimited path lists", () => {
    expect(parseNullDelimitedPaths("a.md\0docs/b.md\0")).toEqual(["a.md", "docs/b.md"]);
  });
});
