import { describe, expect, test } from "bun:test";
import { writeFile } from "node:fs/promises";
import { join } from "node:path";
import {
  AtlasConfigValidationError,
  loadConfig,
  resolveAtlasConfig,
} from "./load-config";
import {
  createIsolatedEnv,
  emptyEnv,
  useLoaderTestWorkspace,
} from "./load-config.test-helpers";

const workspace = useLoaderTestWorkspace();

function ghesConfig() {
  return {
    version: 1,
    cacheDir: ".cache",
    logLevel: "warn",
    repos: [
      {
        repoId: "github.mycorp.com/platform/docs",
        mode: "ghes-api",
        github: {
          baseUrl: "https://ghe.example.com/api/v3",
          owner: "platform",
          name: "platform",
          ref: "main",
        },
        workspace: {
          packageGlobs: ["packages/*"],
          packageManifestFiles: ["package.json"],
        },
        topology: [
          {
            id: "repo-docs",
            kind: "repo-doc",
            match: { include: ["docs/**/*.md"] },
            ownership: { attachTo: "repo" },
            authority: "canonical",
            priority: 10,
          },
        ],
      },
    ],
  };
}

describe("loadConfig GHES authentication", () => {
  test("rejects invalid GHES base URLs with field-specific validation", () => {
    expect(() =>
      resolveAtlasConfig(
        {
          version: 1,
          cacheDir: ".cache",
          logLevel: "warn",
          repos: [
            {
              repoId: "github.mycorp.com/platform/docs",
              mode: "ghes-api",
              github: {
                baseUrl: "not-a-url",
                owner: "platform",
                name: "platform",
                ref: "main",
              },
              workspace: {
                packageGlobs: ["packages/*"],
                packageManifestFiles: ["package.json"],
              },
              topology: [
                {
                  id: "repo-docs",
                  kind: "repo-doc",
                  match: { include: ["docs/**/*.md"] },
                  ownership: { attachTo: "repo" },
                  authority: "canonical",
                  priority: 10,
                },
              ],
            },
          ],
        },
        join(workspace.fixtureDir, "atlas.config.yaml"),
        emptyEnv,
      ),
    ).toThrow(AtlasConfigValidationError);
  });

  test("requires a resolvable token for GHES repos", async () => {
    const configPath = join(workspace.fixtureDir, "atlas.config.json");
    await writeFile(
      configPath,
      JSON.stringify({
        ...ghesConfig(),
        repos: [
          {
            ...ghesConfig().repos[0]!,
            github: {
              ...ghesConfig().repos[0]!.github,
              tokenEnvVar: "CUSTOM_GHES_TOKEN",
            },
          },
        ],
      }),
    );

    await expect(
      loadConfig({
        cwd: workspace.fixtureDir,
        env: createIsolatedEnv(),
        runCommand: async () => ({
          exitCode: 1,
          stdout: "",
          stderr: "missing auth",
        }),
      }),
    ).rejects.toThrow(AtlasConfigValidationError);
  });

  test("can load GHES config without auth for diagnostics", async () => {
    const configPath = join(workspace.fixtureDir, "atlas.config.yaml");
    await writeFile(
      configPath,
      `
version: 1
cacheDir: .atlas-cache
logLevel: info
server:
  transport: http
repos:
  - repoId: github.mycorp.com/platform/docs
    mode: ghes-api
    github:
      baseUrl: https://ghe.example.com/api/v3
      owner: platform
      name: identity
      ref: main
      tokenEnvVar: CUSTOM_GHES_TOKEN
    workspace:
      packageGlobs: ["packages/*"]
      packageManifestFiles: ["package.json"]
    topology:
      - id: repo-docs
        kind: repo-doc
        match:
          include: ["docs/**/*.md"]
        ownership:
          attachTo: repo
        authority: canonical
        priority: 10
`,
    );

    const resolved = await loadConfig({
      cwd: workspace.fixtureDir,
      env: createIsolatedEnv(),
      requireGhesAuth: false,
    });

    expect(resolved.config.repos[0]).toMatchObject({
      repoId: "github.mycorp.com/platform/docs",
      mode: "ghes-api",
      github: expect.objectContaining({ tokenEnvVar: "CUSTOM_GHES_TOKEN" }),
    });
    expect(resolved.ghesAuth).toBeUndefined();
  });

  test("accepts custom token env vars for GHES repos", async () => {
    const configPath = join(workspace.fixtureDir, "atlas.config.json");
    await writeFile(
      configPath,
      JSON.stringify({
        ...ghesConfig(),
        repos: [
          {
            ...ghesConfig().repos[0]!,
            github: {
              ...ghesConfig().repos[0]!.github,
              tokenEnvVar: "CUSTOM_GHES_TOKEN",
            },
          },
        ],
      }),
    );

    const resolved = await loadConfig({
      cwd: workspace.fixtureDir,
      env: createIsolatedEnv({ CUSTOM_GHES_TOKEN: "token" }),
    });

    expect(resolved.config.repos[0]?.github?.tokenEnvVar).toBe(
      "CUSTOM_GHES_TOKEN",
    );
    expect(resolved.ghesAuth).toEqual({
      "github.mycorp.com/platform/docs": {
        kind: "token",
        source: "env",
        sourceName: "CUSTOM_GHES_TOKEN",
        token: "token",
      },
    });
    expect(resolved.env).toEqual({});
  });

  test("resolves GHES auth from standard env vars without repo-specific token config", async () => {
    const configPath = join(workspace.fixtureDir, "atlas.config.json");
    await writeFile(configPath, JSON.stringify(ghesConfig()));

    const resolved = await loadConfig({
      cwd: workspace.fixtureDir,
      env: createIsolatedEnv({ GH_ENTERPRISE_TOKEN: "enterprise-token" }),
    });

    expect(resolved.config.repos[0]?.github?.tokenEnvVar).toBeUndefined();
    expect(resolved.ghesAuth?.["github.mycorp.com/platform/docs"]).toEqual({
      kind: "token",
      source: "env",
      sourceName: "GH_ENTERPRISE_TOKEN",
      token: "enterprise-token",
    });
  });

  test("resolves GHES auth from gh CLI credentials", async () => {
    const configPath = join(workspace.fixtureDir, "atlas.config.json");
    await writeFile(configPath, JSON.stringify(ghesConfig()));

    const resolved = await loadConfig({
      cwd: workspace.fixtureDir,
      env: createIsolatedEnv(),
      runCommand: async (command) => {
        expect(command).toEqual([
          "gh",
          "auth",
          "token",
          "--hostname",
          "ghe.example.com",
        ]);
        return { exitCode: 0, stdout: "gh-token\n", stderr: "" };
      },
    });

    expect(resolved.ghesAuth?.["github.mycorp.com/platform/docs"]).toEqual({
      kind: "token",
      source: "gh-cli",
      sourceName: "gh:ghe.example.com",
      token: "gh-token",
    });
  });
});
