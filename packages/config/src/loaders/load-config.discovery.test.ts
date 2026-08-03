import { describe, expect, test } from "bun:test";
import { writeFile } from "node:fs/promises";
import { join } from "node:path";
import {
  AtlasConfigNotFoundError,
  AtlasConfigParseError,
  loadConfig,
} from "./load-config";
import {
  createIsolatedEnv,
  useLoaderTestWorkspace,
  validYamlConfig,
} from "./load-config.test-helpers";

const workspace = useLoaderTestWorkspace();

describe("loadConfig discovery and parsing", () => {
  test("discovers and loads YAML config files", async () => {
    const configPath = join(workspace.fixtureDir, "atlas.config.yaml");
    await writeFile(configPath, validYamlConfig);

    const resolved = await loadConfig({
      cwd: workspace.fixtureDir,
      env: createIsolatedEnv(),
    });

    expect(resolved.source).toEqual({
      configPath,
      loadedFrom: "discovered",
    });
    expect(resolved.config.version).toBe(1);
    expect(resolved.config.repos[0]?.repoId).toBe(
      "github.mycorp.com/platform/docs",
    );
    expect(resolved.config.docs.metadata.profiles.public?.visibility).toEqual([
      "public",
    ]);
    expect(resolved.runtimeRepos[0]).toMatchObject({
      repoId: "github.mycorp.com/platform/docs",
      workspace: { rootPath: join(workspace.fixtureDir, "repos", "identity") },
      docs: {
        metadata: {
          profiles: {
            public: { visibility: ["public"] },
          },
        },
      },
    });
  });

  test("uses ATLAS_CONFIG before discovery", async () => {
    const discoveredPath = join(workspace.fixtureDir, "atlas.config.yaml");
    const explicitPath = join(workspace.fixtureDir, "custom.yaml");
    await writeFile(
      discoveredPath,
      validYamlConfig.replace(
        "repoId: github.mycorp.com/platform/docs",
        "repoId: ignored",
      ),
    );
    await writeFile(explicitPath, validYamlConfig);

    const resolved = await loadConfig({
      cwd: workspace.fixtureDir,
      env: createIsolatedEnv({ ATLAS_CONFIG: explicitPath }),
    });

    expect(resolved.source.loadedFrom).toBe("env");
    expect(resolved.source.configPath).toBe(explicitPath);
    expect(resolved.config.repos[0]?.repoId).toBe(
      "github.mycorp.com/platform/docs",
    );
  });

  test("normalizes resolved env path values when loading config", async () => {
    const configPath = join(workspace.fixtureDir, "atlas.config.yaml");
    await writeFile(configPath, validYamlConfig);

    const resolved = await loadConfig({
      cwd: workspace.fixtureDir,
      env: createIsolatedEnv({
        ATLAS_CONFIG: "atlas.config.yaml",
        ATLAS_CACHE_DIR: "runtime-cache",
        ATLAS_CA_CERT_PATH: "certs/company.pem",
      }),
    });

    expect(resolved.env.ATLAS_CONFIG).toBe(configPath);
    expect(resolved.env.ATLAS_CACHE_DIR).toBe(
      join(workspace.fixtureDir, "runtime-cache"),
    );
    expect(resolved.env.ATLAS_CA_CERT_PATH).toBe(
      join(workspace.fixtureDir, "certs", "company.pem"),
    );
  });

  test("wraps YAML parse failures in structured errors", async () => {
    const configPath = join(workspace.fixtureDir, "atlas.config.yaml");
    await writeFile(configPath, "version: 1\nrepos:\n  - repoId: [");

    await expect(
      loadConfig({ cwd: workspace.fixtureDir, env: createIsolatedEnv() }),
    ).rejects.toMatchObject({
      code: "ATLAS_CONFIG_PARSE_FAILED",
      filePath: configPath,
    });
    await expect(
      loadConfig({ cwd: workspace.fixtureDir, env: createIsolatedEnv() }),
    ).rejects.toThrow(AtlasConfigParseError);
  });

  test("loads JSON config files", async () => {
    const configPath = join(workspace.fixtureDir, "atlas.config.json");
    await writeFile(
      configPath,
      JSON.stringify({
        version: 1,
        cacheDir: ".cache",
        logLevel: "warn",
        repos: [
          {
            repoId: "github.mycorp.com/platform/docs",
            mode: "ghes-api",
            github: {
              baseUrl: "https://ghe.example.com",
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
      }),
    );

    const resolved = await loadConfig({
      cwd: workspace.fixtureDir,
      env: createIsolatedEnv({ GHES_TOKEN: "token" }),
    });

    expect(resolved.config.repos[0]?.mode).toBe("ghes-api");
    expect(resolved.config.repos[0]?.github?.tokenEnvVar).toBeUndefined();
  });

  test("wraps JSON parse failures in structured errors", async () => {
    const configPath = join(workspace.fixtureDir, "atlas.config.json");
    await writeFile(configPath, "{");

    await expect(
      loadConfig({ cwd: workspace.fixtureDir, env: createIsolatedEnv() }),
    ).rejects.toMatchObject({
      code: "ATLAS_CONFIG_PARSE_FAILED",
      filePath: configPath,
    });
    await expect(
      loadConfig({ cwd: workspace.fixtureDir, env: createIsolatedEnv() }),
    ).rejects.toThrow(AtlasConfigParseError);
  });

  test("throws a structured not found error when discovery fails", async () => {
    await expect(
      loadConfig({ cwd: workspace.fixtureDir, env: createIsolatedEnv() }),
    ).rejects.toMatchObject({
      code: "ATLAS_CONFIG_NOT_FOUND",
    });
    await expect(
      loadConfig({ cwd: workspace.fixtureDir, env: createIsolatedEnv() }),
    ).rejects.toThrow(AtlasConfigNotFoundError);
  });

  test("throws a structured not found error when ATLAS_CONFIG points to a missing file", async () => {
    await expect(
      loadConfig({
        cwd: workspace.fixtureDir,
        env: createIsolatedEnv({ ATLAS_CONFIG: "missing.yaml" }),
      }),
    ).rejects.toThrow(AtlasConfigNotFoundError);
  });
});
