import { describe, expect, test } from "bun:test";
import { readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { AtlasConfigValidationError } from "./load-config";
import {
  createIsolatedEnv,
  useLoaderTestWorkspace,
  validYamlConfig,
} from "./load-config.test-helpers";
import { mutateAtlasConfigFile } from "./mutate-config";

const workspace = useLoaderTestWorkspace();

describe("mutateAtlasConfigFile", () => {
  test("mutates through shared validation and path normalization", async () => {
    const configPath = join(workspace.fixtureDir, "atlas.config.yaml");
    await writeFile(configPath, validYamlConfig);

    const result = await mutateAtlasConfigFile(
      {
        cwd: workspace.fixtureDir,
        env: createIsolatedEnv({ ATLAS_CACHE_DIR: "runtime-cache" }),
        requireGhesAuth: false,
      },
      (config) => ({
        ...config,
        repos: config.repos.map((repo) => ({
          ...repo,
          git:
            repo.git === undefined
              ? undefined
              : { ...repo.git, localPath: "repos/changed" },
        })),
      }),
    );

    expect(await readFile(configPath, "utf8")).toContain(
      "localPath: repos/changed",
    );
    expect(result.config.cacheDir).toBe(
      join(workspace.fixtureDir, "runtime-cache"),
    );
    expect(result.config.repos[0]?.git?.localPath).toBe(
      join(workspace.fixtureDir, "repos", "changed"),
    );
    expect(result.config.docs.metadata.profiles.public).toBeDefined();
  });

  test("does not write a mutation that fails shared validation", async () => {
    const configPath = join(workspace.fixtureDir, "atlas.config.yaml");
    await writeFile(configPath, validYamlConfig);
    const before = await readFile(configPath, "utf8");

    await expect(
      mutateAtlasConfigFile(
        {
          cwd: workspace.fixtureDir,
          env: createIsolatedEnv(),
          requireGhesAuth: false,
        },
        (config) => ({
          ...config,
          repos: config.repos.map((repo) => ({ ...repo, git: undefined })),
        }),
      ),
    ).rejects.toBeInstanceOf(AtlasConfigValidationError);
    expect(await readFile(configPath, "utf8")).toBe(before);
  });
});
