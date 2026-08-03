import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { createApp } from "./app";
import { loadServerEnv } from "./env";
import {
  buildServerDependencies,
  closeServerDependencies,
} from "./services/dependencies";
import {
  assertRemoteExposureSafe,
  RemoteSecurityService,
} from "./services/remote-security.service";
import { RepoRepository, SkillRepository } from "@atlas/store";
import {
  createDependencies,
  createServerTestFixture,
  createResolvedConfig,
  remoteHeaders,
  repoId,
  skillId,
  type ServerTestFixture,
} from "./server.test-fixtures";

describe("server remote security", () => {
  let fixture: ServerTestFixture;
  let dbPath: string;
  let store: ServerTestFixture["store"];
  beforeEach(async () => {
    fixture = await createServerTestFixture();
    ({ dbPath, store } = fixture);
  });

  afterEach(async () => {
    await fixture.destroy();
  });

  test("fails closed and enforces authenticated read-only public access", async () => {
    const token = "remote-test-token-that-is-at-least-32-characters";
    const remote = {
      enabled: true,
      token,
      tlsTerminated: true,
      repoAllowlist: [repoId],
      rateLimitPerMinute: 20,
      maxResponseBytes: 2 * 1024 * 1024,
    };
    const publicDependencies = fixture.createDependencies({
      enableMcp: true,
      host: "127.0.0.1",
      remote,
    });
    assertRemoteExposureSafe(publicDependencies.env, publicDependencies.config);
    expect(() =>
      assertRemoteExposureSafe(
        { ...publicDependencies.env, host: "0.0.0.0" },
        publicDependencies.config,
      ),
    ).toThrow("public listener binds are refused");
    expect(() =>
      assertRemoteExposureSafe(
        { ...publicDependencies.env, enableTelemetry: true },
        publicDependencies.config,
      ),
    ).toThrow("ATLAS_ENABLE_TELEMETRY=false");
    const publicApp = createApp(publicDependencies);

    expect(
      (await publicApp.handle(new Request("http://atlas.local/api/repos")))
        .status,
    ).toBe(400);
    const unauthorized = await publicApp.handle(
      new Request("http://atlas.local/api/repos", {
        headers: { "x-forwarded-proto": "https" },
      }),
    );
    expect(unauthorized.status).toBe(401);
    expect(await unauthorized.json()).toMatchObject({
      ok: false,
      error: { code: "unauthorized" },
    });
    expect(unauthorized.headers.get("cache-control")).toBe("private, no-store");
    expect(
      (
        await publicApp.handle(
          new Request("http://atlas.local/api/repos", {
            headers: remoteHeaders(token),
          }),
        )
      ).status,
    ).toBe(200);
    expect(
      (
        await publicApp.handle(
          new Request("http://atlas.local/api/build", {
            method: "POST",
            headers: remoteHeaders(token),
            body: JSON.stringify({ repoId }),
          }),
        )
      ).status,
    ).toBe(405);
    expect(
      (
        await publicApp.handle(
          new Request("http://atlas.local/api/search/docs", {
            method: "POST",
            headers: remoteHeaders(token),
            body: JSON.stringify({
              query: "session rotation",
              repoId: "github.com/private/other",
            }),
          }),
        )
      ).status,
    ).toBe(403);
    expect(
      (
        await publicApp.handle(
          new Request(
            "http://atlas.local/api/repos/github.com%2Fprivate%2Fother",
            { headers: remoteHeaders(token) },
          ),
        )
      ).status,
    ).toBe(405);
    expect(() =>
      assertRemoteExposureSafe(
        { ...publicDependencies.env, remote: { ...remote, repoAllowlist: [] } },
        publicDependencies.config,
      ),
    ).toThrow("ATLAS_REMOTE_REPO_ALLOWLIST");
    expect(() =>
      assertRemoteExposureSafe(
        {
          ...publicDependencies.env,
          remote: {
            ...remote,
            repoAllowlist: Array.from(
              { length: 101 },
              (_, index) => `github.com/private/repo-${index}`,
            ),
          },
        },
        publicDependencies.config,
      ),
    ).toThrow("at most 100 repositories");
    const bounded = new RemoteSecurityService(
      {
        ...publicDependencies.env,
        remote: {
          ...remote,
          rateLimitPerMinute: 1,
          maxResponseBytes: 1024,
        },
      },
      () => [repoId],
    );
    const boundedRequest = new Request("http://atlas.local/api/repos", {
      headers: remoteHeaders(token),
    });
    expect(await bounded.authorize(boundedRequest)).toBeUndefined();
    expect((await bounded.authorize(boundedRequest))?.status).toBe(429);
    expect(
      (
        (await bounded.limitResponse(
          boundedRequest,
          new Response("x".repeat(1025)),
        )) as Response
      ).status,
    ).toBe(502);
    const oversizedStream = new Response(
      new ReadableStream<Uint8Array>({
        start(controller) {
          controller.enqueue(new TextEncoder().encode("x".repeat(1025)));
          controller.close();
        },
      }),
      { headers: { "content-type": "text/event-stream" } },
    );
    const limitedStream = (await bounded.limitResponse(
      boundedRequest,
      oversizedStream,
    )) as Response;
    await expect(
      Promise.resolve().then(() => limitedStream.text()),
    ).rejects.toThrow("stream exceeded the configured size limit");
    const oversizedBodyGuard = new RemoteSecurityService(
      publicDependencies.env,
      () => [repoId],
    );
    expect(
      (
        await oversizedBodyGuard.authorize(
          new Request("http://atlas.local/api/search/docs", {
            method: "POST",
            headers: remoteHeaders(token),
            body: "x".repeat(1024 * 1024 + 1),
          }),
        )
      )?.status,
    ).toBe(413);
    expect(
      (
        await publicApp.handle(
          new Request("http://atlas.local/mcp", {
            method: "POST",
            headers: remoteHeaders(token),
            body: JSON.stringify([
              { jsonrpc: "2.0", id: 1, method: "tools/list", params: {} },
              { jsonrpc: "2.0", id: 2, method: "tools/list", params: {} },
            ]),
          }),
        )
      ).status,
    ).toBe(400);
    new RepoRepository(store).upsert({
      repoId: "github.com/private/residual",
      mode: "local-git",
      revision: "rev_1",
    });
    expect(() =>
      assertRemoteExposureSafe(
        publicDependencies.env,
        publicDependencies.config,
        [repoId, "github.com/private/residual"],
      ),
    ).toThrow("config or corpus contains repositories outside");
    expect(
      (
        await publicApp.handle(
          new Request("http://atlas.local/api/repos", {
            headers: remoteHeaders(token),
          }),
        )
      ).status,
    ).toBe(503);
    await publicDependencies.mcp?.close();
  });

  test("serves remote mode from an immutable corpus snapshot", async () => {
    const remoteEnv = loadServerEnv({
      ATLAS_ENABLE_MCP: "false",
      ATLAS_ENABLE_TELEMETRY: "false",
      ATLAS_REMOTE_AUTH_TOKEN: "x".repeat(32),
      ATLAS_REMOTE_TLS_TERMINATED: "true",
      ATLAS_REMOTE_REPO_ALLOWLIST: repoId,
    });
    const dependencies = await buildServerDependencies(
      remoteEnv,
      createResolvedConfig(dbPath),
    );
    try {
      expect(dependencies.ownedDbDir).toBeString();
      new RepoRepository(store).upsert({
        repoId: "github.com/private/late-write",
        mode: "local-git",
        revision: "rev_2",
      });
      expect(
        dependencies.store.listRepos().map(({ repo }) => repo.repoId),
      ).toEqual([repoId]);
    } finally {
      await closeServerDependencies(dependencies);
    }
  });

  test("rejects corpus values that cannot fit a bounded remote response", async () => {
    store.run("UPDATE sections SET text = $text", {
      $text: "x".repeat(2_000),
    });
    const remoteEnv = loadServerEnv({
      ATLAS_ENABLE_MCP: "false",
      ATLAS_ENABLE_TELEMETRY: "false",
      ATLAS_REMOTE_AUTH_TOKEN: "x".repeat(32),
      ATLAS_REMOTE_TLS_TERMINATED: "true",
      ATLAS_REMOTE_REPO_ALLOWLIST: repoId,
      ATLAS_REMOTE_MAX_RESPONSE_BYTES: "8192",
    });
    await expect(
      buildServerDependencies(remoteEnv, createResolvedConfig(dbPath)),
    ).rejects.toThrow("safe per-value limit");
  });

  test("checks stored skill artifact bytes instead of declared size", async () => {
    new SkillRepository(store).replaceArtifacts(skillId, [
      {
        skillId,
        path: "references/oversized.md",
        kind: "reference",
        contentHash: "mismatched-declared-size",
        sizeBytes: 1,
        mimeType: "text/markdown",
        content: "x".repeat(2_000),
      },
    ]);
    const remoteEnv = loadServerEnv({
      ATLAS_ENABLE_MCP: "false",
      ATLAS_ENABLE_TELEMETRY: "false",
      ATLAS_REMOTE_AUTH_TOKEN: "x".repeat(32),
      ATLAS_REMOTE_TLS_TERMINATED: "true",
      ATLAS_REMOTE_REPO_ALLOWLIST: repoId,
      ATLAS_REMOTE_MAX_RESPONSE_BYTES: "8192",
    });
    await expect(
      buildServerDependencies(remoteEnv, createResolvedConfig(dbPath)),
    ).rejects.toThrow("skill artifact payload");
  });

  test("does not log authorization header values", async () => {
    const loggingApp = createApp(
      createDependencies(store, dbPath, { logRequests: true }),
    );
    const originalLog = console.log;
    const logs: string[] = [];
    console.log = (message?: unknown) => {
      logs.push(String(message));
    };

    try {
      const loggedResponse = await loggingApp.handle(
        new Request("http://atlas.local/health", {
          headers: { authorization: "Bearer redaction-canary-header" },
        }),
      );
      await loggedResponse.text();
      await Bun.sleep(0);
    } finally {
      console.log = originalLog;
    }

    expect(logs.join("\n")).not.toContain("redaction-canary-header");
  });
});
