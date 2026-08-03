import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import type { BuildReport, SyncReport } from "@atlas/indexer";

import { createApp } from "./app";
import {
  createDependencies,
  createServerTestFixture,
  createStubIndexer,
  docId,
  fakeRecovery,
  fakeTimings,
  moduleId,
  packageId,
  repoId,
  response,
  type ServerTestFixture,
} from "./server.test-fixtures";

describe("server operations", () => {
  let fixture: ServerTestFixture;
  let dbPath: string;
  let store: ServerTestFixture["store"];
  let app: ServerTestFixture["app"];

  beforeEach(async () => {
    fixture = await createServerTestFixture();
    ({ dbPath, store, app } = fixture);
  });

  afterEach(async () => {
    await fixture.destroy();
  });

  test("executes sync and build through the shared indexer adapter", async () => {
    const operationalApp = createApp(
      createDependencies(
        store,
        dbPath,
        {},
        createStubIndexer({
          async syncRepo(inputRepoId): Promise<SyncReport> {
            return {
              repoId: inputRepoId,
              mode: "local-git",
              status: "updated",
              previousRevision: "rev_1",
              currentRevision: "rev_2",
              sourceChanged: true,
              corpusAffected: true,
              corpusImpact: "docs",
              changedPathCount: 1,
              relevantChangedPathCount: 1,
              relevantDocPathCount: 1,
              topologySensitivePathCount: 0,
              packageManifestPathCount: 0,
              diagnostics: [],
              recovery: fakeRecovery(),
              timings: fakeTimings(),
            };
          },
          async buildRepo(inputRepoId, options): Promise<BuildReport> {
            return {
              repoId: inputRepoId,
              strategy: options?.selection ? "targeted" : "full",
              reasonCode: options?.selection ? "targeted_doc" : "force",
              partial: options?.selection !== undefined,
              reason: "stubbed build",
              currentRevision: "rev_2",
              docsConsidered: 1,
              docsRebuilt: 1,
              docsDeleted: 0,
              chunksPersisted: 2,
              skillsUpdated: 0,
              summariesUpdated: 2,
              manifestUpdated: true,
              changedPaths: [],
              affectedDocPaths: [],
              deletedDocPaths: [],
              skippedDocPaths: [],
              diagnostics: [],
              recovery: fakeRecovery(),
              timings: fakeTimings(),
            };
          },
        }),
      ),
    );

    const sync = await response(operationalApp, "/api/sync", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ repoId, mode: "incremental" }),
    });
    expect(sync.status).toBe(200);
    expect(await sync.json()).toMatchObject({
      ok: true,
      data: {
        repoId,
        status: "updated",
        currentRevision: "rev_2",
      },
    });

    const build = await response(operationalApp, "/api/build", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ repoId, moduleId, mode: "incremental" }),
    });
    expect(build.status).toBe(200);
    expect(await build.json()).toMatchObject({
      ok: true,
      data: {
        repoId,
        strategy: "targeted",
        partial: true,
      },
    });
  });

  test("rejects invalid targeted build selector combinations at the route boundary", async () => {
    const build = await response(app, "/api/build", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ repoId, docIds: [docId], packageId }),
    });

    expect(build.status).toBe(400);
    expect(await build.json()).toMatchObject({
      ok: false,
      error: { code: "validation_failed" },
    });
  });
});
