import { describe, expect, test } from "bun:test";
import { createChunkId, createDocId, createSectionId, type CanonicalDocument } from "@atlas/core";

import {
  availableTokens,
  canAppend,
  checkBudget,
  chunkBySection,
  createTextEncoder,
  DEFAULT_ENCODING,
  InvalidTokenBudgetError,
  applyOverlap,
  resolveEncodingName,
  splitByBudget,
  takeTrailingTokens,
  type TextEncoder,
  type TokenizedChunk,
  TokenizerUnsupportedEncodingError
} from "./index";

const repoId = "atlas";
const docId = createDocId({ repoId, path: "docs/tokenizer.md" });
const sectionId = createSectionId({ docId, headingPath: ["Tokenizer"], ordinal: 0 });

describe("tokenizer", () => {
  test("resolves supported encodings and model names to exact encoders", () => {
    expect(DEFAULT_ENCODING).toBe("o200k_base");
    expect(resolveEncodingName("gpt-5")).toBe("o200k_base");
    expect(resolveEncodingName("gpt-4")).toBe("cl100k_base");
    expect(() => resolveEncodingName("not-a-real-model")).toThrow(TokenizerUnsupportedEncodingError);

    const encoder = createTextEncoder();
    const encoded = encoder.encode("hello world");

    expect(encoded.encoding).toBe("o200k_base");
    expect(encoded.tokenIds).toEqual([24912, 2375]);
    expect(encoded.tokenCount).toBe(2);
    expect(encoder.decode(encoded.tokenIds)).toBe("hello world");
  });

  test("uses explicit non-default encodings end to end", () => {
    const encoder = createTextEncoder("cl100k_base");
    const encoded = encoder.encode("hello world");
    const result = chunkBySection({
      document: createDocument("Explicit encoding chunks."),
      options: {
        encoding: "cl100k_base",
        maxTokens: 32,
        includeTokenIds: true
      }
    });

    expect(encoded.encoding).toBe("cl100k_base");
    expect(encoded.tokenIds).toEqual([15339, 1917]);
    expect(result.diagnostics.encoding).toBe("cl100k_base");
    assertChunkTokenInvariants(result.chunks, encoder, 32, true);
  });

  test("resolves model aliases through chunking options and rejects unsupported names", () => {
    const result = chunkBySection({
      document: createDocument("Model aliases resolve before chunking."),
      options: {
        encoding: "gpt-4",
        maxTokens: 32
      }
    });

    expect(result.diagnostics.encoding).toBe("cl100k_base");
    expect(() =>
      chunkBySection({
        document: createDocument(),
        options: {
          encoding: "not-a-real-model",
          maxTokens: 32
        }
      })
    ).toThrow(TokenizerUnsupportedEncodingError);
  });

  test("computes token-budget arithmetic without retrieval policy", () => {
    expect(availableTokens({ maxTokens: 20, reservedTokens: 4 })).toBe(16);
    expect(checkBudget(12, { maxTokens: 20, reservedTokens: 4 })).toEqual({
      fits: true,
      usedTokens: 12,
      remainingTokens: 4
    });
    expect(canAppend(12, 5, { maxTokens: 20, reservedTokens: 4 })).toBe(false);
    expect(() => availableTokens({ maxTokens: 4, reservedTokens: 5 })).toThrow(InvalidTokenBudgetError);
  });

  test("splits oversized text by natural boundaries before hard fallback", () => {
    const encoder = createTextEncoder();
    const result = splitByBudget({
      encoder,
      maxTokens: 12,
      headingPath: ["Guide"],
      text: [
        "First paragraph has useful setup text.",
        "Second paragraph has useful follow up text.",
        "- first item",
        "- second item",
        "- third item"
      ].join("\n\n")
    });

    expect(result.units.length).toBeGreaterThan(1);
    expect(result.units.every((unit) => encoder.count(unit.text) <= 12)).toBe(true);
    expect(result.units.map((unit) => unit.headingPath)).toEqual(result.units.map(() => ["Guide"]));
    expect(result.diagnostics.paragraphSplits).toBeGreaterThan(0);
    expect(result.diagnostics.hardFallbackSplits).toBe(0);
  });

  test("splits list-only content at list boundaries before hard fallback", () => {
    const encoder = createTextEncoder();
    const result = splitByBudget({
      encoder,
      maxTokens: 8,
      headingPath: ["Checklist"],
      text: [
        "- install dependencies",
        "- run exact tokenizer checks",
        "- inspect generated chunk boundaries",
        "- persist chunks only after validation"
      ].join("\n")
    });

    expect(result.units.length).toBeGreaterThan(1);
    expect(result.units.every((unit) => encoder.count(unit.text) <= 8)).toBe(true);
    expect(result.diagnostics.listSplits).toBeGreaterThan(0);
    expect(result.diagnostics.hardFallbackSplits).toBe(0);
  });

  test("splits sentence-heavy single paragraphs deterministically", () => {
    const encoder = createTextEncoder();
    const result = splitByBudget({
      encoder,
      maxTokens: 9,
      text: "First sentence stays readable. Second sentence stays readable. Third sentence stays readable."
    });

    expect(result.units.map((unit) => unit.text)).toEqual([
      "First sentence stays readable.",
      "Second sentence stays readable.",
      "Third sentence stays readable."
    ]);
    expect(result.units.every((unit) => encoder.count(unit.text) <= 9)).toBe(true);
    expect(result.diagnostics.sentenceSplits).toBe(2);
    expect(result.diagnostics.hardFallbackSplits).toBe(0);
  });

  test("splits oversized code fence content with exact-token hard fallback", () => {
    const encoder = createTextEncoder();
    const result = splitByBudget({
      encoder,
      maxTokens: 6,
      text: `\`\`\`ts\n${"longidentifier".repeat(80)}\n\`\`\``
    });

    expect(result.units.length).toBeGreaterThan(1);
    expect(result.units.every((unit) => encoder.count(unit.text) <= 6)).toBe(true);
    expect(result.diagnostics.hardFallbackSplits).toBeGreaterThan(0);
  });

  test("uses exact token hard fallback for one giant unit", () => {
    const encoder = createTextEncoder();
    const result = splitByBudget({
      encoder,
      maxTokens: 3,
      text: "abcdefghijabcdefghijabcdefghijabcdefghij"
    });

    expect(result.units.length).toBeGreaterThan(1);
    expect(result.units.every((unit) => encoder.count(unit.text) <= 3)).toBe(true);
    expect(result.diagnostics.hardFallbackSplits).toBeGreaterThan(0);
  });

  test("handles empty and whitespace-only split input deterministically", () => {
    const encoder = createTextEncoder();

    expect(splitByBudget({ encoder, maxTokens: 4, text: "" }).units).toEqual([{ text: "", ordinal: 0 }]);
    expect(splitByBudget({ encoder, maxTokens: 4, text: "   \n\t " }).units).toEqual([{ text: "   \n\t ", ordinal: 0 }]);
  });

  test("applies token-limited overlap without exceeding max chunk budget", () => {
    const encoder = createTextEncoder();
    const previous = "alpha beta gamma delta";
    const overlap = takeTrailingTokens(previous, 2, { encoder });

    expect(encoder.count(overlap)).toBeLessThanOrEqual(2);
    expect(overlap.length).toBeGreaterThan(0);
  });

  test("applies, clamps, and disables overlap deterministically", () => {
    const encoder = createTextEncoder();
    const units = [
      { text: "alpha beta gamma", headingPath: ["A"] },
      { text: "delta epsilon", headingPath: ["B"] },
      { text: "zeta", headingPath: ["C"] }
    ];
    const overlapped = applyOverlap(units, { encoder, maxTokens: 8, overlapTokens: 2 });
    const clamped = applyOverlap([{ text: "alpha" }, { text: "beta" }], { encoder, maxTokens: 6, overlapTokens: 4 });
    const disabled = applyOverlap(units, { encoder, maxTokens: 8, overlapTokens: 0 });

    expect(overlapped[0]?.text).toBe("alpha beta gamma");
    expect(overlapped[1]?.text.startsWith(" beta gamma\n\ndelta epsilon")).toBe(true);
    expect(overlapped.every((unit) => encoder.count(unit.text) <= 8)).toBe(true);
    expect(clamped[1]?.text).toBe("alpha\n\nbeta");
    expect(disabled).toEqual(units);
  });

  test("chunks canonical sections deterministically with code blocks and token IDs", () => {
    const document = createDocument();
    const result = chunkBySection({
      document,
      options: {
        maxTokens: 40,
        overlapTokens: 2,
        includeTokenIds: true
      }
    });

    expect(result.diagnostics).toMatchObject({
      encoding: "o200k_base",
      maxTokens: 40,
      overlapTokens: 2,
      sectionsKeptWhole: 2,
      sectionsSplit: 0,
      hardFallbackUsed: false
    });
    expect(result.chunks).toEqual([
      expect.objectContaining({
        chunkId: createChunkId({ docId, sectionId, ordinal: 0 }),
        docId,
        repoId,
        sectionId,
        headingPath: ["Tokenizer"],
        ordinal: 0,
        text: "Tokenizer chunks preserve sections.\n\n```ts\nexport const exact = true;\n```",
        encoding: "o200k_base"
      }),
      expect.objectContaining({
        chunkId: createChunkId({
          docId,
          sectionId: document.sections[1]?.sectionId,
          ordinal: 1
        }),
        docId,
        repoId,
        headingPath: ["Tokenizer", "Budget"],
        ordinal: 1,
        encoding: "o200k_base"
      })
    ]);
    assertChunkTokenInvariants(result.chunks, createTextEncoder(), 40, true);
  });

  test("splits oversized canonical sections and keeps stable ordinals", () => {
    const document = createDocument(
      Array.from({ length: 10 }, (_, index) => `Paragraph ${index + 1} explains deterministic token chunking.`).join("\n\n")
    );
    const result = chunkBySection({
      document,
      options: {
        maxTokens: 12
      }
    });

    expect(result.chunks.length).toBeGreaterThan(1);
    assertContiguousOrdinals(result.chunks);
    assertChunkTokenInvariants(result.chunks, createTextEncoder(), 12, false);
    expect(result.diagnostics.sectionsSplit).toBe(1);
  });

  test("chunks empty, whitespace-only, and code-only sections without crashing", () => {
    const document = createCustomDocument([
      { headingPath: ["Empty"], text: "", codeBlocks: [] },
      { headingPath: ["Whitespace"], text: "   \n\t ", codeBlocks: [] },
      { headingPath: ["Code"], text: "", codeBlocks: [{ lang: "sh", code: "echo ok" }] }
    ]);
    const result = chunkBySection({
      document,
      options: { maxTokens: 20 }
    });

    expect(result.chunks.map((chunk) => chunk.text)).toEqual(["", "", "```sh\necho ok\n```"]);
    assertContiguousOrdinals(result.chunks);
    assertChunkTokenInvariants(result.chunks, createTextEncoder(), 20, false);
  });

  test("packs adjacent sections only when section boundary preservation is disabled", () => {
    const document = createCustomDocument([
      { headingPath: ["A"], text: "Alpha section.", codeBlocks: [] },
      { headingPath: ["B"], text: "Beta section.", codeBlocks: [] }
    ]);
    const sectionLocal = chunkBySection({ document, options: { maxTokens: 30 } });
    const packed = chunkBySection({
      document,
      options: {
        maxTokens: 30,
        preserveSectionBoundaries: false
      }
    });

    expect(sectionLocal.chunks).toHaveLength(2);
    expect(packed.chunks).toHaveLength(1);
    expect(packed.chunks[0]?.text).toBe("Alpha section.\n\nBeta section.");
    assertChunkTokenInvariants(packed.chunks, createTextEncoder(), 30, false);
  });

  test("propagates package, module, and skill metadata into chunks", () => {
    const document = createDocument("Metadata survives chunking.");
    const result = chunkBySection({
      document: {
        ...document,
        kind: "skill-doc",
        metadata: {
          packageId: "pkg_auth",
          moduleId: "mod_auth",
          skillId: "skill_auth",
          tags: []
        }
      },
      options: { maxTokens: 32 }
    });

    expect(result.chunks[0]).toMatchObject({
      repoId,
      packageId: "pkg_auth",
      moduleId: "mod_auth",
      skillId: "skill_auth",
      kind: "skill-doc"
    });
  });

  test("omits token IDs by default", () => {
    const result = chunkBySection({
      document: createDocument(),
      options: { maxTokens: 40 }
    });

    expect(result.chunks.every((chunk) => chunk.tokenIds === undefined)).toBe(true);
  });

  test("rejects impossible chunking budgets", () => {
    expect(() =>
      chunkBySection({
        document: createDocument(),
        options: { maxTokens: 10, overlapTokens: 10 }
      })
    ).toThrow(InvalidTokenBudgetError);
  });
});

interface SectionFixture {
  headingPath: string[];
  text: string;
  codeBlocks: CanonicalDocument["sections"][number]["codeBlocks"];
}

function createDocument(firstSectionText = "Tokenizer chunks preserve sections."): CanonicalDocument {
  const secondSectionId = createSectionId({ docId, headingPath: ["Tokenizer", "Budget"], ordinal: 1 });
  return {
    docId,
    repoId,
    path: "docs/tokenizer.md",
    sourceVersion: "rev_1",
    title: "Tokenizer",
    kind: "repo-doc",
    authority: "canonical",
    scopes: [{ level: "repo", repoId }],
    sections: [
      {
        sectionId,
        headingPath: ["Tokenizer"],
        ordinal: 0,
        text: firstSectionText,
        codeBlocks: [{ lang: "ts", code: "export const exact = true;" }]
      },
      {
        sectionId: secondSectionId,
        headingPath: ["Tokenizer", "Budget"],
        ordinal: 1,
        text: "Budgets are exact.",
        codeBlocks: []
      }
    ],
    metadata: {
      tags: []
    }
  };
}

function createCustomDocument(sections: readonly SectionFixture[]): CanonicalDocument {
  return {
    docId,
    repoId,
    path: "docs/tokenizer.md",
    sourceVersion: "rev_1",
    title: "Tokenizer",
    kind: "repo-doc",
    authority: "canonical",
    scopes: [{ level: "repo", repoId }],
    sections: sections.map((section, ordinal) => ({
      sectionId: createSectionId({ docId, headingPath: section.headingPath, ordinal }),
      headingPath: section.headingPath,
      ordinal,
      text: section.text,
      codeBlocks: section.codeBlocks
    })),
    metadata: {
      tags: []
    }
  };
}

function assertContiguousOrdinals(chunks: readonly TokenizedChunk[]): void {
  expect(chunks.map((chunk) => chunk.ordinal)).toEqual(chunks.map((_, index) => index));
}

function assertChunkTokenInvariants(
  chunks: readonly TokenizedChunk[],
  encoder: TextEncoder,
  maxTokens: number,
  expectTokenIds: boolean
): void {
  assertContiguousOrdinals(chunks);
  expect(chunks.every((chunk) => chunk.tokenCount === encoder.count(chunk.text))).toBe(true);
  expect(chunks.every((chunk) => chunk.tokenCount <= maxTokens)).toBe(true);
  if (expectTokenIds) {
    expect(chunks.every((chunk) => Array.isArray(chunk.tokenIds) && chunk.tokenIds.length === chunk.tokenCount)).toBe(true);
  } else {
    expect(chunks.every((chunk) => chunk.tokenIds === undefined)).toBe(true);
  }
}
