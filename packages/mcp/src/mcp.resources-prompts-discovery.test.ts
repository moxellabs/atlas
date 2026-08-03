import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { createDocId } from "@atlas/core";
import { DocRepository } from "@atlas/store";

import {
  createMcpTestCatalog,
  createMcpTestFixture,
  type McpTestFixture,
  docId,
  documentSummaryId,
  moduleId,
  packageId,
  relatedDocId,
  repoId,
  sectionId,
  skillId,
} from "./mcp.test-fixtures";
import {
  discoveryDescription,
  discoveryInstructions,
} from "./discovery/indexed-source-catalog";
import { documentResource } from "./resources/document.resource";
import { manifestResource } from "./resources/manifest.resource";
import { moduleResource } from "./resources/module.resource";
import { packageResource } from "./resources/package.resource";
import { repoResource } from "./resources/repo.resource";
import { skillResource } from "./resources/skill.resource";
import { skillArtifactResource } from "./resources/skill-artifact.resource";
import { summaryResource } from "./resources/summary.resource";
describe("MCP resources, prompts, and discovery", () => {
  let fixture: McpTestFixture;

  beforeEach(async () => {
    fixture = await createMcpTestFixture();
  });

  afterEach(async () => {
    await fixture?.cleanup();
  });

  test("reads stable resource payloads from atlas URIs", () => {
    const { store } = fixture;
    const manifestPayload = manifestResource.read(new URL("atlas://manifest"), {
      db: store,
    });
    expect(manifestPayload).toMatchObject({
      manifests: [expect.objectContaining({ repoId })],
      indexedCoverage: [
        expect.objectContaining({
          repoId,
          indexedRevision: "rev_1",
          compilerVersion: "compiler-v1",
          status: "indexed",
          packageCount: 1,
          moduleCount: 1,
          documentCount: 2,
        }),
      ],
      agentGuidance: expect.stringContaining(
        "Use local indexed evidence when it covers the question.",
      ),
      sources: [expect.objectContaining({ repoId, toolSuffix: "atlas" })],
    });
    expect(JSON.stringify(manifestPayload)).not.toMatch(
      /(token|password|secret|authorization|credential)/i,
    );
    expect(
      repoResource.read(new URL(`atlas://repo/${repoId}`), { db: store }),
    ).toMatchObject({
      repo: expect.objectContaining({ repoId }),
      manifest: expect.objectContaining({ repoId, indexedRevision: "rev_1" }),
      freshness: expect.objectContaining({
        repoId,
        repoRevision: "rev_1",
        indexedRevision: "rev_1",
        fresh: true,
        stale: false,
      }),
      packages: [expect.objectContaining({ packageId })],
      modules: [expect.objectContaining({ moduleId })],
      documents: expect.arrayContaining([
        expect.objectContaining({ docId }),
        expect.objectContaining({ docId: relatedDocId }),
      ]),
      skills: [expect.objectContaining({ skillId })],
    });
    expect(
      packageResource.read(
        new URL(`atlas://package/${encodeURIComponent(packageId)}`),
        { db: store },
      ),
    ).toMatchObject({
      package: expect.objectContaining({ packageId }),
      repo: expect.objectContaining({ repoId }),
      manifest: expect.objectContaining({ repoId }),
      modules: [expect.objectContaining({ moduleId })],
      documents: expect.arrayContaining([
        expect.objectContaining({ docId }),
        expect.objectContaining({ docId: relatedDocId }),
      ]),
      skills: [expect.objectContaining({ skillId })],
    });
    expect(
      moduleResource.read(
        new URL(`atlas://module/${encodeURIComponent(moduleId)}`),
        { db: store },
      ),
    ).toMatchObject({
      module: expect.objectContaining({ moduleId }),
      repo: expect.objectContaining({ repoId }),
      package: expect.objectContaining({ packageId }),
      manifest: expect.objectContaining({ repoId }),
      documents: expect.arrayContaining([
        expect.objectContaining({ docId }),
        expect.objectContaining({ docId: relatedDocId }),
      ]),
      summaries: [
        expect.objectContaining({ targetType: "module", targetId: moduleId }),
      ],
      skills: [expect.objectContaining({ skillId })],
    });
    expect(
      documentResource.read(new URL(`atlas://document/${docId}`), {
        db: store,
      }),
    ).toMatchObject({
      document: expect.objectContaining({ docId }),
      outline: [expect.objectContaining({ sectionId })],
    });
    expect(
      skillResource.read(new URL(`atlas://skill/${skillId}`), { db: store }),
    ).toMatchObject({
      skill: expect.objectContaining({
        skillId,
        topics: ["session"],
        aliases: ["session rotation"],
        tokenCount: 18,
      }),
      artifacts: expect.arrayContaining([
        expect.objectContaining({ path: "scripts/check.py" }),
      ]),
      repo: expect.objectContaining({ repoId }),
      package: expect.objectContaining({ packageId }),
      module: expect.objectContaining({ moduleId }),
      manifest: expect.objectContaining({ repoId }),
      sourceDocument: expect.objectContaining({ docId }),
      sourceDocumentSummaries: expect.arrayContaining([
        expect.objectContaining({ summaryId: documentSummaryId }),
      ]),
      sourceOutline: [expect.objectContaining({ sectionId })],
      provenance: expect.objectContaining({ docId, skillId }),
    });
    expect(
      skillArtifactResource.read(
        new URL(
          `atlas://skill-artifact/${encodeURIComponent(skillId)}/scripts/check.py`,
        ),
        { db: store },
      ),
    ).toMatchObject({
      artifact: expect.objectContaining({
        skillId,
        path: "scripts/check.py",
        content: "print('ok')",
      }),
      executionPolicy: "served-only",
    });
    expect(
      summaryResource.read(
        new URL(`atlas://summary/${encodeURIComponent(documentSummaryId)}`),
        { db: store },
      ),
    ).toMatchObject({
      summary: expect.objectContaining({
        summaryId: documentSummaryId,
        targetType: "document",
        targetId: docId,
      }),
    });
  });

  test("keeps autonomous discovery neutral unless prefer-local is explicit", () => {
    const { store } = fixture;
    const catalog = createMcpTestCatalog(store);
    const neutral = discoveryInstructions(catalog);
    const preferLocal = discoveryInstructions(catalog, "prefer-local");

    expect(neutral).toContain("Atlas provides indexed documentation");
    expect(neutral).not.toContain("before external search");
    expect(preferLocal).toContain("before external search");
  });

  test("advertises the root README identity instead of hidden agent artifacts", () => {
    const { store } = fixture;
    const readmeDocId = createDocId({ repoId, path: "README.md" });
    const hiddenDocId = createDocId({
      repoId,
      path: ".pi/skills/gsd-phase.md",
    });
    const docs = new DocRepository(store);
    docs.upsert({
      docId: readmeDocId,
      repoId,
      path: "README.md",
      sourceVersion: "rev_1",
      title: "WaveBridge",
      kind: "repo-doc",
      authority: "canonical",
      scopes: [{ level: "repo", repoId }],
      sections: [],
      metadata: { tags: [] },
    });
    docs.upsert({
      docId: hiddenDocId,
      repoId,
      path: ".pi/skills/gsd-phase.md",
      sourceVersion: "rev_1",
      title: "Private GSD Phase",
      kind: "repo-doc",
      authority: "supplemental",
      scopes: [{ level: "repo", repoId }],
      sections: [],
      metadata: { tags: [] },
    });

    const catalog = createMcpTestCatalog(store);
    expect(catalog.sources[0]).toMatchObject({
      title: "WaveBridge",
      aliases: expect.arrayContaining(["WaveBridge"]),
    });
    expect(catalog.sources[0]?.topics).not.toContain("private");
    expect(discoveryDescription(catalog)).toContain("WaveBridge");
  });
});
