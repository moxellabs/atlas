import { describe, expect, test } from "bun:test";
import { mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { caseMetadata, loadEvalDataset } from "./dataset";

describe("retrieval eval datasets", () => {
  test("preserves optional case metadata", () => {
    expect(
      caseMetadata({
        id: "case",
        category: "category",
        query: "query",
        profile: "maintainer",
        feature: "retrieval",
        scenario: "smoke",
        priority: "p0",
        capability: "Retrieval quality",
        claim: "Atlas retrieves expected docs.",
        whyItMatters: "Developers need grounded evidence.",
        expectedBehavior: "Retrieve docs.",
        coverageType: "source-recall",
        riskArea: "workflow-retrieval",
        expected: {},
      }),
    ).toEqual({
      profile: "maintainer",
      feature: "retrieval",
      scenario: "smoke",
      priority: "p0",
      capability: "Retrieval quality",
      claim: "Atlas retrieves expected docs.",
      whyItMatters: "Developers need grounded evidence.",
      expectedBehavior: "Retrieve docs.",
      coverageType: "source-recall",
      riskArea: "workflow-retrieval",
    });
  });

  test("resolves manifest includes relative to the manifest file", async () => {
    const dir = await mkdtemp(join(tmpdir(), "atlas-eval-test-"));
    await writeFile(
      join(dir, "child.json"),
      JSON.stringify({
        name: "child",
        repoId: "child-repo",
        cases: [
          {
            id: "included",
            category: "smoke",
            query: "query",
            expected: {},
          },
        ],
      }),
    );
    await writeFile(
      join(dir, "manifest.json"),
      JSON.stringify({
        name: "manifest",
        description: "full suite",
        repoId: "manifest-repo",
        includes: ["child.json"],
        cases: [],
      }),
    );

    const dataset = await loadEvalDataset(join(dir, "manifest.json"));

    expect(dataset.name).toBe("manifest");
    expect(dataset.cases).toHaveLength(1);
    expect(dataset.cases[0]?.id).toBe("included");
    expect(dataset.cases[0]?.repoId).toBe("child-repo");
  });

  test("rejects duplicate case ids across includes", async () => {
    const dir = await mkdtemp(join(tmpdir(), "atlas-eval-test-"));
    const child = {
      name: "child",
      cases: [
        {
          id: "duplicate",
          category: "smoke",
          query: "query",
          expected: {},
        },
      ],
    };
    await writeFile(join(dir, "one.json"), JSON.stringify(child));
    await writeFile(join(dir, "two.json"), JSON.stringify(child));
    await writeFile(
      join(dir, "manifest.json"),
      JSON.stringify({
        name: "manifest",
        includes: ["one.json", "two.json"],
        cases: [],
      }),
    );

    await expect(loadEvalDataset(join(dir, "manifest.json"))).rejects.toThrow(
      "Duplicate eval case id",
    );
  });
});
