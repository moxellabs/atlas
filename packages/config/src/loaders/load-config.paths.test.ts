import { describe, expect, test } from "bun:test";
import { writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import { join } from "node:path";
import { loadConfig, resolveAtlasConfig } from "./load-config";
import {
  createIsolatedEnv,
  emptyEnv,
  useLoaderTestWorkspace,
  validYamlConfig,
} from "./load-config.test-helpers";

const workspace = useLoaderTestWorkspace();

describe("loadConfig paths and environment", () => {
  test("resolves relative paths against the config directory", async () => {
    const configPath = join(workspace.fixtureDir, "atlas.config.yaml");
    await writeFile(configPath, validYamlConfig);

    const resolved = await loadConfig({
      cwd: workspace.fixtureDir,
      env: createIsolatedEnv(),
    });

    expect(resolved.config.cacheDir).toBe(
      join(workspace.fixtureDir, ".atlas-cache"),
    );
    expect(resolved.config.corpusDbPath).toBe(
      join(workspace.fixtureDir, ".atlas-cache", "corpus.db"),
    );
    expect(resolved.config.repos[0]?.git?.localPath).toBe(
      join(workspace.fixtureDir, "repos", "identity"),
    );
  });

  test("expands tilde paths explicitly", () => {
    const config = resolveAtlasConfig(
      {
        version: 1,
        cacheDir: "~/.moxel/atlas",
        logLevel: "warn",
        repos: [],
      },
      join(workspace.fixtureDir, "atlas.config.yaml"),
      emptyEnv,
    );

    expect(config.cacheDir).toBe(join(homedir(), ".moxel", "atlas"));
    expect(config.corpusDbPath).toBe(
      join(homedir(), ".moxel", "atlas", "corpus.db"),
    );
  });

  test("derives runtime paths from identity root", async () => {
    const configPath = join(workspace.fixtureDir, "atlas.config.yaml");
    await writeFile(
      configPath,
      "version: 1\nlogLevel: warn\nserver:\n  transport: stdio\nidentity:\n  root: .acme/knowledge\nrepos: []\n",
    );

    const resolved = await loadConfig({
      cwd: workspace.fixtureDir,
      env: createIsolatedEnv(),
    });

    expect(resolved.config.cacheDir).toBe(
      join(homedir(), ".acme", "knowledge"),
    );
    expect(resolved.config.corpusDbPath).toBe(
      join(homedir(), ".acme", "knowledge", "corpus.db"),
    );
  });

  test("explicit runtime paths override identity root", async () => {
    const configPath = join(workspace.fixtureDir, "atlas.config.yaml");
    await writeFile(
      configPath,
      "version: 1\ncacheDir: explicit-cache\ncorpusDbPath: explicit-db/corpus.sqlite\nlogLevel: warn\nserver:\n  transport: stdio\nidentity:\n  root: .acme/knowledge\nrepos: []\n",
    );

    const resolved = await loadConfig({
      cwd: workspace.fixtureDir,
      env: createIsolatedEnv(),
    });

    expect(resolved.config.cacheDir).toBe(
      join(workspace.fixtureDir, "explicit-cache"),
    );
    expect(resolved.config.corpusDbPath).toBe(
      join(workspace.fixtureDir, "explicit-db", "corpus.sqlite"),
    );
  });

  test("applies env overrides after file values", async () => {
    const configPath = join(workspace.fixtureDir, "atlas.config.yaml");
    await writeFile(configPath, validYamlConfig);

    const resolved = await loadConfig({
      cwd: workspace.fixtureDir,
      env: createIsolatedEnv({
        ATLAS_CACHE_DIR: "runtime-cache",
        ATLAS_LOG_LEVEL: "debug",
      }),
    });

    expect(resolved.config.cacheDir).toBe(
      join(workspace.fixtureDir, "runtime-cache"),
    );
    expect(resolved.config.corpusDbPath).toBe(
      join(workspace.fixtureDir, "runtime-cache", "corpus.db"),
    );
    expect(resolved.config.logLevel).toBe("debug");
  });

  test("preserves explicit corpusDbPath when ATLAS_CACHE_DIR overrides cacheDir", async () => {
    const configPath = join(workspace.fixtureDir, "atlas.config.yaml");
    await writeFile(
      configPath,
      validYamlConfig.replace(
        "cacheDir: .atlas-cache",
        "cacheDir: .atlas-cache\ncorpusDbPath: explicit/db.sqlite",
      ),
    );

    const resolved = await loadConfig({
      cwd: workspace.fixtureDir,
      env: createIsolatedEnv({ ATLAS_CACHE_DIR: "runtime-cache" }),
    });

    expect(resolved.config.cacheDir).toBe(
      join(workspace.fixtureDir, "runtime-cache"),
    );
    expect(resolved.config.corpusDbPath).toBe(
      join(workspace.fixtureDir, "explicit", "db.sqlite"),
    );
  });
});
