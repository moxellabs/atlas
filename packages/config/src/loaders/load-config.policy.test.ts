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
  validYamlConfig,
} from "./load-config.test-helpers";

const workspace = useLoaderTestWorkspace();

const localGitRepo = (overrides: Record<string, unknown> = {}) => ({
  repoId: "github.mycorp.com/platform/docs",
  mode: "local-git",
  git: {
    remote: "ssh://git@ghe.example.com/platform/identity.git",
    localPath: "repos/identity",
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
  ...overrides,
});

describe("loadConfig policy validation", () => {
  test("rejects configs without an explicit version", () => {
    expect(() =>
      resolveAtlasConfig(
        {
          cacheDir: ".cache",
          logLevel: "warn",
          repos: [],
        },
        join(workspace.fixtureDir, "atlas.config.yaml"),
        emptyEnv,
      ),
    ).toThrow(AtlasConfigValidationError);
  });

  test("applies HTTP server defaults only for HTTP transport", () => {
    const config = resolveAtlasConfig(
      {
        version: 1,
        cacheDir: ".cache",
        logLevel: "warn",
        server: {
          transport: "http",
        },
        repos: [],
      },
      join(workspace.fixtureDir, "atlas.config.yaml"),
      emptyEnv,
    );

    expect(config.server).toEqual({
      transport: "http",
      host: "127.0.0.1",
      port: 3711,
    });
  });

  test("rejects host and port for stdio transport", () => {
    expect(() =>
      resolveAtlasConfig(
        {
          version: 1,
          cacheDir: ".cache",
          logLevel: "warn",
          server: {
            transport: "stdio",
            host: "127.0.0.1",
            port: 3711,
          },
          repos: [],
        },
        join(workspace.fixtureDir, "atlas.config.yaml"),
        emptyEnv,
      ),
    ).toThrow(AtlasConfigValidationError);
  });

  test("rejects duplicate repo ids", async () => {
    const configPath = join(workspace.fixtureDir, "atlas.config.yaml");
    await writeFile(
      configPath,
      `${validYamlConfig}\n${validYamlConfig.split("repos:")[1] ?? ""}`,
    );

    await expect(
      loadConfig({ cwd: workspace.fixtureDir, env: createIsolatedEnv() }),
    ).rejects.toThrow(AtlasConfigValidationError);
  });

  test("rejects incompatible repo mode fields", () => {
    expect(() =>
      resolveAtlasConfig(
        {
          version: 1,
          cacheDir: ".cache",
          logLevel: "warn",
          repos: [
            localGitRepo({
              github: {
                baseUrl: "https://ghe.example.com",
                owner: "platform",
                name: "identity",
                ref: "main",
              },
            }),
          ],
        },
        join(workspace.fixtureDir, "atlas.config.yaml"),
        emptyEnv,
      ),
    ).toThrow(AtlasConfigValidationError);
  });

  test("rejects invalid topology rules", () => {
    expect(() =>
      resolveAtlasConfig(
        {
          version: 1,
          cacheDir: ".cache",
          logLevel: "warn",
          repos: [
            localGitRepo({
              topology: [
                {
                  id: "repo-docs",
                  kind: "repo-doc",
                  match: { include: [] },
                  ownership: { attachTo: "repo" },
                  authority: "canonical",
                  priority: 10,
                },
              ],
            }),
          ],
        },
        join(workspace.fixtureDir, "atlas.config.yaml"),
        emptyEnv,
      ),
    ).toThrow(AtlasConfigValidationError);
  });

  test("rejects duplicate workspace glob and manifest values", () => {
    expect(() =>
      resolveAtlasConfig(
        {
          version: 1,
          cacheDir: ".cache",
          logLevel: "warn",
          repos: [
            localGitRepo({
              workspace: {
                packageGlobs: ["packages/*", "packages/*"],
                packageManifestFiles: ["package.json", "package.json"],
              },
            }),
          ],
        },
        join(workspace.fixtureDir, "atlas.config.yaml"),
        emptyEnv,
      ),
    ).toThrow(AtlasConfigValidationError);
  });

  test("rejects duplicate topology rule ids", () => {
    expect(() =>
      resolveAtlasConfig(
        {
          version: 1,
          cacheDir: ".cache",
          logLevel: "warn",
          repos: [
            localGitRepo({
              topology: [
                {
                  id: "repo-docs",
                  kind: "repo-doc",
                  match: { include: ["docs/**/*.md"] },
                  ownership: { attachTo: "repo" },
                  authority: "canonical",
                  priority: 10,
                },
                {
                  id: "repo-docs",
                  kind: "guide-doc",
                  match: { include: ["guides/**/*.md"] },
                  ownership: { attachTo: "repo" },
                  authority: "supplemental",
                  priority: 20,
                },
              ],
            }),
          ],
        },
        join(workspace.fixtureDir, "atlas.config.yaml"),
        emptyEnv,
      ),
    ).toThrow(AtlasConfigValidationError);
  });
});
