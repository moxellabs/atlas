import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import type { GhesFetch } from "@atlas/source-ghes";
import { createIndexerServices } from "@atlas/indexer";

import {
  createIndexerTestFixture,
  createTestResolvedConfig,
  disposeIndexerTestFixture,
  repoId,
  type IndexerTestFixture,
} from "./indexer.test-helpers";

describe("GHES and configuration behavior", () => {
  let fixture: IndexerTestFixture;
  let originPath: string;
  let localPath: string;
  let store: IndexerTestFixture["store"];

  beforeEach(async () => {
    fixture = await createIndexerTestFixture();
    ({ originPath, localPath, store } = fixture);
  });

  afterEach(async () => {
    await disposeIndexerTestFixture(fixture);
  });

  test("builds GHES repos through the source adapter without blocking local-git repos", async () => {
    const { service } = createIndexerServices({
      config: createTestResolvedConfig(
        { originPath: originPath, localPath: localPath },
        {
          includeGhesRepo: true,
        },
      ),
      db: store,
      ghesFetch: buildGhesFetch(),
    });

    const report = await service.buildAll({ all: true });

    expect(report.successCount).toBe(2);
    expect(report.failureCount).toBe(0);
    expect(report.reports).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          repoId,
          strategy: expect.any(String),
          diagnostics: expect.not.arrayContaining([
            expect.objectContaining({ severity: "error" }),
          ]),
        }),
        expect.objectContaining({
          repoId: "atlas-ghes",
          strategy: "full",
          docsRebuilt: 2,
          diagnostics: expect.not.arrayContaining([
            expect.objectContaining({ severity: "error" }),
          ]),
        }),
      ]),
    );
  });

  test("preserves old corpus and reports recovery state when a rebuild fails", async () => {
    const first = createIndexerServices({
      config: createTestResolvedConfig(
        { originPath: originPath, localPath: localPath },
        {
          includeGhesRepo: true,
        },
      ),
      db: store,
      ghesFetch: buildGhesFetch(),
    });

    const successful = await first.service.buildRepo("atlas-ghes");
    const manifestBefore = first.deps.store.manifests.get("atlas-ghes");
    const docsBefore = first.deps.store.docs
      .listByRepo("atlas-ghes")
      .map((doc) => doc.docId)
      .sort();

    const second = createIndexerServices({
      config: createTestResolvedConfig(
        { originPath: originPath, localPath: localPath },
        {
          includeGhesRepo: true,
        },
      ),
      db: store,
      ghesFetch: buildFailingGhesFetch(),
    });

    const failed = await second.service.buildRepo("atlas-ghes");

    expect(successful.manifestUpdated).toBe(true);
    expect(failed).toMatchObject({
      repoId: "atlas-ghes",
      manifestUpdated: false,
      recovery: {
        previousCorpusPreserved: true,
        nextAction:
          "Fix the build failure and rerun atlas build for this repo.",
      },
    });
    expect(failed.diagnostics).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          severity: "error",
          path: "packages/auth/docs/api.md",
          cause: expect.objectContaining({
            message: expect.stringContaining("packages/auth/docs/api.md"),
          }),
        }),
      ]),
    );
    expect(second.deps.store.manifests.get("atlas-ghes")).toEqual(
      manifestBefore,
    );
    expect(
      second.deps.store.docs
        .listByRepo("atlas-ghes")
        .map((doc) => doc.docId)
        .sort(),
    ).toEqual(docsBefore);
  });
});

function buildGhesFetch(): GhesFetch {
  return async (input) => {
    const url = new URL(String(input));
    const path = url.pathname;
    if (path === "/api/v3/repos/moxellabs/atlas/commits/main") {
      return jsonResponse({
        sha: "1111111111111111111111111111111111111111",
        commit: { tree: { sha: "tree-sha" } },
      });
    }
    if (path === "/api/v3/repos/moxellabs/atlas/git/trees/tree-sha") {
      return jsonResponse({
        sha: "tree-sha",
        truncated: false,
        tree: [
          {
            path: "docs/index.md",
            mode: "100644",
            type: "blob",
            sha: "repo-doc-sha",
            size: 28,
            url: "https://ghe.example.test/blob1",
          },
          {
            path: "packages/auth/package.json",
            mode: "100644",
            type: "blob",
            sha: "manifest-sha",
            size: 24,
            url: "https://ghe.example.test/blob2",
          },
          {
            path: "packages/auth/docs/api.md",
            mode: "100644",
            type: "blob",
            sha: "package-doc-sha",
            size: 29,
            url: "https://ghe.example.test/blob3",
          },
        ],
      });
    }
    if (path === "/api/v3/repos/moxellabs/atlas/git/blobs/repo-doc-sha") {
      return jsonResponse(blob("# Index\n\nRepository docs.\n"));
    }
    if (path === "/api/v3/repos/moxellabs/atlas/git/blobs/package-doc-sha") {
      return jsonResponse(blob("# API\n\nPackage documentation.\n"));
    }
    return jsonResponse({ message: `Unhandled path: ${path}` }, 404);
  };
}

function buildFailingGhesFetch(): GhesFetch {
  return async (input) => {
    const url = new URL(String(input));
    const path = url.pathname;
    if (path === "/api/v3/repos/moxellabs/atlas/commits/main") {
      return jsonResponse({
        sha: "2222222222222222222222222222222222222222",
        commit: { tree: { sha: "tree-sha-2" } },
      });
    }
    if (
      path ===
      "/api/v3/repos/moxellabs/atlas/compare/1111111111111111111111111111111111111111...2222222222222222222222222222222222222222"
    ) {
      return jsonResponse({
        status: "ahead",
        total_commits: 1,
        files: [{ filename: "packages/auth/docs/api.md", status: "modified" }],
      });
    }
    if (path === "/api/v3/repos/moxellabs/atlas/git/trees/tree-sha-2") {
      return jsonResponse({
        sha: "tree-sha-2",
        truncated: false,
        tree: [
          {
            path: "docs/index.md",
            mode: "100644",
            type: "blob",
            sha: "repo-doc-sha",
            size: 28,
            url: "https://ghe.example.test/blob1",
          },
          {
            path: "packages/auth/package.json",
            mode: "100644",
            type: "blob",
            sha: "manifest-sha",
            size: 24,
            url: "https://ghe.example.test/blob2",
          },
          {
            path: "packages/auth/docs/api.md",
            mode: "100644",
            type: "blob",
            sha: "broken-package-doc-sha",
            size: 29,
            url: "https://ghe.example.test/blob3",
          },
        ],
      });
    }
    if (
      path === "/api/v3/repos/moxellabs/atlas/git/blobs/broken-package-doc-sha"
    ) {
      return jsonResponse({ message: "blob unavailable" }, 500);
    }
    return jsonResponse({ message: `Unhandled path: ${path}` }, 404);
  };
}

function blob(content: string) {
  return {
    sha: "blob-sha",
    size: content.length,
    url: "https://ghe.example.test/blob",
    content: Buffer.from(content, "utf8").toString("base64"),
    encoding: "base64",
  };
}

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      "content-type": "application/json",
    },
  });
}
