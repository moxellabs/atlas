import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { ATLAS_VERSION } from "@atlas/core";

import { createApp } from "./app";
import {
  createDependencies,
  createResolvedConfig,
  createServerTestFixture,
  createStubIndexer,
  json,
  moduleId,
  repoId,
  response,
  type ServerTestFixture,
} from "./server.test-fixtures";

describe("server repos and config", () => {
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

  test("serves health, version, repo, manifest, freshness, and topology inspection", async () => {
    expect(await json(app, "/health")).toMatchObject({
      ok: true,
      data: {
        service: "ATLAS",
        readiness: {
          store: expect.objectContaining({ repoCount: 1, documentCount: 1 }),
        },
      },
    });
    expect(await json(app, "/version")).toMatchObject({
      data: { service: "ATLAS", version: ATLAS_VERSION },
    });
    expect(await json(app, "/api/repos")).toMatchObject({
      data: [expect.objectContaining({ repoId, fresh: true })],
    });
    expect(await json(app, `/api/repos/${repoId}`)).toMatchObject({
      data: {
        repo: expect.objectContaining({ repoId }),
        counts: expect.objectContaining({ documents: 1, skills: 1 }),
      },
    });
    expect(await json(app, "/api/inspect/manifest")).toMatchObject({
      data: { manifests: [expect.objectContaining({ repoId })] },
    });
    expect(await json(app, "/api/inspect/freshness")).toMatchObject({
      data: [expect.objectContaining({ repoId, fresh: true })],
    });
    expect(await json(app, `/api/inspect/topology/${repoId}`)).toMatchObject({
      data: { modules: [expect.objectContaining({ moduleId })] },
    });
  });

  test("mutates repo config locally and blocks mutation on non-loopback hosts", async () => {
    const configPath = dbPath.replace(/atlas\.db$/, "atlas.config.json");
    const mutationConfig = createResolvedConfig(dbPath, configPath).config;
    await Bun.write(
      configPath,
      `${JSON.stringify({ ...mutationConfig, repos: [] }, null, 2)}\n`,
    );
    const mutableApp = createApp(
      createDependencies(store, dbPath, {}, createStubIndexer(), configPath),
    );
    const extraRepoId = "github.com/platform/atlas-extra";
    const extraRepoRoute = encodeURIComponent(extraRepoId);
    const createdRepo = {
      repoId: extraRepoId,
      mode: "local-git",
      git: {
        remote: "file:///tmp/atlas-extra",
        localPath: "/tmp/atlas-extra",
        ref: "main",
      },
      workspace: {
        packageGlobs: ["packages/*"],
        packageManifestFiles: ["package.json"],
      },
      topology: [
        {
          id: "docs",
          kind: "repo-doc",
          match: { include: ["docs/**/*.md"] },
          ownership: { attachTo: "repo" },
          authority: "canonical",
          priority: 1,
        },
      ],
    };

    const create = await response(mutableApp, "/api/repos", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(createdRepo),
    });
    expect(create.status).toBe(201);
    expect(await create.json()).toMatchObject({
      ok: true,
      data: { repoId: extraRepoId },
    });
    expect(await Bun.file(configPath).json()).toMatchObject({
      repos: expect.arrayContaining([
        expect.objectContaining({ repoId: extraRepoId }),
      ]),
    });

    const replace = await response(mutableApp, `/api/repos/${extraRepoRoute}`, {
      method: "PUT",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        ...createdRepo,
        git: { ...createdRepo.git, ref: "release" },
      }),
    });
    expect(replace.status).toBe(200);
    expect(await replace.json()).toMatchObject({
      data: { git: expect.objectContaining({ ref: "release" }) },
    });

    const remove = await response(mutableApp, `/api/repos/${extraRepoRoute}`, {
      method: "DELETE",
    });
    expect(remove.status).toBe(200);
    expect(await remove.json()).toMatchObject({
      data: { repoId: extraRepoId, deleted: true },
    });

    const publicApp = createApp(
      createDependencies(
        store,
        dbPath,
        { host: "0.0.0.0" },
        createStubIndexer(),
        configPath,
      ),
    );
    const blocked = await response(publicApp, "/api/repos", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(createdRepo),
    });
    expect(blocked.status).toBe(403);
    expect(await blocked.json()).toMatchObject({
      ok: false,
      error: { code: "forbidden" },
    });
  });
});
