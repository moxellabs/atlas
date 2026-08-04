import { describe, expect, test } from "bun:test";
import { PassThrough } from "node:stream";
import {
  type AtlasConfig,
  DEFAULT_REPOSITORY_REFRESH_INTERVAL_MS,
} from "@atlas/config";
import type { CliCommandContext } from "../runtime/types";
import { parseRepoRef, resolveRepoIdentity } from "./repo-identity";

const context: CliCommandContext = {
  positionals: [],
  options: {},
  cwd: "/tmp/atlas-repo-identity-test",
  output: { json: false, verbose: false, quiet: false },
  stdin: new PassThrough() as unknown as NodeJS.ReadStream,
  stdout: new PassThrough() as unknown as NodeJS.WriteStream,
  stderr: new PassThrough() as unknown as NodeJS.WriteStream,
  env: {},
};

function configWithEnterpriseDefault(): AtlasConfig {
  return {
    version: 1,
    cacheDir: "/tmp/atlas-cache",
    corpusDbPath: "/tmp/atlas-cache/corpus.db",
    logLevel: "warn",
    server: { transport: "stdio" },
    lifecycle: {
      repositoryRefresh: {
        enabled: false,
        intervalMs: DEFAULT_REPOSITORY_REFRESH_INTERVAL_MS,
      },
    },
    docs: { metadata: { rules: [], profiles: {} } },
    repos: [],
    hosts: [
      {
        name: "github.enterprise.test",
        webUrl: "https://github.enterprise.test",
        apiUrl: "https://github.enterprise.test/api/v3",
        protocol: "ssh",
        priority: 10,
        default: true,
      },
      {
        name: "github.com",
        webUrl: "https://github.com",
        apiUrl: "https://api.github.com",
        protocol: "ssh",
        priority: 100,
        default: false,
      },
    ],
  };
}

describe("parseRepoRef", () => {
  test.each([
    ["git@GitHub.com:MoxelLabs/Atlas.git", "ssh-url"],
    ["ssh://git@github.com/MoxelLabs/Atlas.git", "ssh-url"],
    ["https://github.com/MoxelLabs/Atlas.git", "https-url"],
    ["https://github.com/MoxelLabs/Atlas.git/", "https-url"],
    ["GitHub.com/MoxelLabs/Atlas.git", "canonical-id"],
  ])("normalizes %s", (input, kind) => {
    expect(parseRepoRef(input)).toMatchObject({
      kind,
      repoId: "github.com/moxellabs/atlas",
    });
  });

  test("distinguishes shorthand and local paths", () => {
    expect(parseRepoRef("MoxelLabs/Atlas.git")).toEqual({
      kind: "shorthand",
      input: "MoxelLabs/Atlas.git",
      owner: "moxellabs",
      name: "atlas",
    });
    expect(parseRepoRef("../atlas")).toEqual({
      kind: "local-path",
      input: "../atlas",
      path: "../atlas",
    });
    expect(() => parseRepoRef("atlas")).toThrow("Unsupported repo input");
  });
});

describe("resolveRepoIdentity configure intent", () => {
  test("prefers the default enterprise host for shorthand and keeps github.com as fallback", async () => {
    const resolved = await resolveRepoIdentity(context, {
      intent: "configure",
      config: configWithEnterpriseDefault(),
      input: "moxellabs/atlas",
      nonInteractive: true,
    });

    expect(resolved.repoId).toBe("github.enterprise.test/moxellabs/atlas");
    expect(resolved.host.name).toBe("github.enterprise.test");
    expect(resolved.fallbacks?.map((fallback) => fallback.repoId)).toEqual([
      "github.com/moxellabs/atlas",
    ]);
  });

  test("keeps explicit enterprise host for canonical enterprise repo ids", async () => {
    const resolved = await resolveRepoIdentity(context, {
      intent: "configure",
      config: configWithEnterpriseDefault(),
      input: "github.enterprise.test/platform/docs",
      nonInteractive: true,
    });

    expect(resolved.repoId).toBe("github.enterprise.test/platform/docs");
    expect(resolved.host.name).toBe("github.enterprise.test");
  });

  test("honors --host for shorthand repos", async () => {
    const resolved = await resolveRepoIdentity(context, {
      intent: "configure",
      config: configWithEnterpriseDefault(),
      input: "platform/docs",
      host: "github.enterprise.test",
      nonInteractive: true,
    });

    expect(resolved.repoId).toBe("github.enterprise.test/platform/docs");
    expect(resolved.host.name).toBe("github.enterprise.test");
  });
});

describe("resolveRepoIdentity target intent", () => {
  test("resolves an explicit canonical repository", async () => {
    const resolved = await resolveRepoIdentity(context, {
      intent: "target",
      config: configWithRepos(),
      explicit: "github.com/MoxelLabs/Atlas.git",
      command: "build",
      nonInteractive: true,
    });

    expect(resolved).toMatchObject({
      repoId: "github.com/moxellabs/atlas",
      source: "explicit",
      hostStatus: "configured",
    });
  });

  test("resolves a unique bare repository name", async () => {
    const resolved = await resolveRepoIdentity(context, {
      intent: "target",
      config: configWithRepos(
        "github.com/moxellabs/atlas",
        "github.enterprise.test/platform/docs",
      ),
      positional: "docs",
      command: "build",
      nonInteractive: true,
    });

    expect(resolved).toMatchObject({
      repoId: "github.enterprise.test/platform/docs",
      source: "bare-name",
    });
  });

  test("rejects ambiguous bare repository names deterministically", async () => {
    await expect(
      resolveRepoIdentity(context, {
        intent: "target",
        config: configWithRepos(
          "github.com/moxellabs/docs",
          "github.enterprise.test/platform/docs",
        ),
        positional: "docs",
        command: "build",
        nonInteractive: true,
      }),
    ).rejects.toMatchObject({
      code: "CLI_REPO_TARGET_AMBIGUOUS",
      details: {
        candidates: [
          "github.com/moxellabs/docs",
          "github.enterprise.test/platform/docs",
        ],
      },
    });
  });
});

function configWithRepos(...repoIds: string[]): AtlasConfig {
  return {
    ...configWithEnterpriseDefault(),
    repos: repoIds.map((repoId) => ({ repoId, mode: "local-git" })),
  } as AtlasConfig;
}
