import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { loadConfig } from "@atlas/config";
import {
  createCliTestWorkspace,
  exists,
  git,
  removeCliTestWorkspace,
  runWithCapture,
  type CliTestWorkspace,
} from "./cli.test-helpers";

describe("atlas CLI setup and configuration", () => {
  let workspace: CliTestWorkspace;

  beforeEach(async () => {
    workspace = await createCliTestWorkspace();
  });

  afterEach(async () => {
    await removeCliTestWorkspace(workspace);
  });

  test("setup bootstraps identity-derived runtime config", async () => {
    const home = join(workspace.rootDir, "home-identity");
    const setup = await runWithCapture(
      [
        "setup",
        "--cwd",
        workspace.rootDir,
        "--atlas-identity-root",
        ".acme/knowledge",
        "--non-interactive",
      ],
      { HOME: home },
    );
    expect(setup.exitCode).toBe(0);
    const identityConfigPath = join(home, ".acme", "knowledge", "config.yaml");
    expect(await Bun.file(identityConfigPath).exists()).toBe(true);
    const configText = await readFile(identityConfigPath, "utf8");
    expect(configText).toContain("root: .acme/knowledge");
    const resolved = await loadConfig({
      cwd: workspace.rootDir,
      configPath: identityConfigPath,
      env: { HOME: home },
    });
    expect(resolved.config.cacheDir).toBe(join(home, ".acme", "knowledge"));
    expect(resolved.config.corpusDbPath).toBe(
      join(home, ".acme", "knowledge", "corpus.db"),
    );
    expect(
      await Bun.file(join(home, ".moxel", "atlas", "config.yaml")).exists(),
    ).toBe(false);
  });

  test("setup config is discovered by later commands without --config", async () => {
    const home = join(workspace.rootDir, "home-config-discovery");
    const setup = await runWithCapture(
      [
        "setup",
        "--cwd",
        workspace.rootDir,
        "--cache-dir",
        workspace.cacheDir,
        "--non-interactive",
      ],
      { HOME: home },
    );
    expect(setup.exitCode).toBe(0);
    expect(setup.stdout).toContain("\nAtlas setup complete\n");
    expect(setup.stdout).toContain("Next: atlas repo add <repo>");

    const next = await runWithCapture(
      ["next", "--cwd", workspace.rootDir, "--json"],
      {
        HOME: home,
      },
    );
    expect(next.exitCode).toBe(0);
    expect(JSON.parse(next.stdout).data.state).toMatchObject({
      configFound: true,
      configPath: join(home, ".moxel", "atlas", "config.yaml"),
      repoCount: 0,
    });
  });

  test("setup is idempotent when config already exists and only overrides with force", async () => {
    const home = join(workspace.rootDir, "home-setup-idempotent");
    const firstCache = join(workspace.rootDir, "first-cache");
    const secondCache = join(workspace.rootDir, "second-cache");
    const config = join(home, ".moxel", "atlas", "config.yaml");
    const first = await runWithCapture(
      [
        "setup",
        "--cwd",
        workspace.rootDir,
        "--cache-dir",
        firstCache,
        "--non-interactive",
      ],
      { HOME: home },
    );
    expect(first.exitCode).toBe(0);

    const second = await runWithCapture(
      [
        "setup",
        "--cwd",
        workspace.rootDir,
        "--cache-dir",
        secondCache,
        "--host",
        "github.enterprise.test",
        "--protocol",
        "https",
        "--non-interactive",
        "--json",
      ],
      { HOME: home },
    );
    expect(second.exitCode).toBe(0);
    expect(JSON.parse(second.stdout).data).toMatchObject({
      configPath: config,
      cacheDir: firstCache,
      existingConfig: true,
      overwritten: false,
    });
    let loaded = await loadConfig({
      cwd: workspace.rootDir,
      configPath: config,
      env: { HOME: home },
    });
    expect(loaded.config.cacheDir).toBe(firstCache);
    expect(loaded.config.hosts[0]?.name).toBe("github.com");

    const forced = await runWithCapture(
      [
        "setup",
        "--cwd",
        workspace.rootDir,
        "--cache-dir",
        secondCache,
        "--host",
        "github.enterprise.test",
        "--protocol",
        "https",
        "--force",
        "--non-interactive",
        "--json",
      ],
      { HOME: home },
    );
    expect(forced.exitCode).toBe(0);
    expect(JSON.parse(forced.stdout).data).toMatchObject({
      configPath: config,
      cacheDir: secondCache,
      existingConfig: true,
      overwritten: true,
    });
    loaded = await loadConfig({
      cwd: workspace.rootDir,
      configPath: config,
      env: { HOME: home },
    });
    expect(loaded.config.cacheDir).toBe(secondCache);
    expect(loaded.config.hosts).toEqual([
      expect.objectContaining({
        name: "github.enterprise.test",
        protocol: "https",
        default: true,
      }),
    ]);
  });

  test("next recommends setup, repo add, and build from detected state", async () => {
    const noSetup = await runWithCapture(
      ["next", "--cwd", workspace.rootDir, "--json"],
      {
        HOME: join(workspace.rootDir, "home-next-empty"),
      },
    );
    expect(noSetup.exitCode).toBe(0);
    expect(JSON.parse(noSetup.stdout).data).toMatchObject({
      recommendedCommand: "atlas setup",
      state: { configFound: false },
    });

    const home = join(workspace.rootDir, "home-next");
    const setup = await runWithCapture(
      [
        "setup",
        "--cwd",
        workspace.rootDir,
        "--cache-dir",
        workspace.cacheDir,
        "--non-interactive",
      ],
      { HOME: home },
    );
    expect(setup.exitCode).toBe(0);
    const nextConfig = join(home, ".moxel", "atlas", "config.yaml");
    const emptyCorpusPath = (
      await loadConfig({
        cwd: workspace.rootDir,
        configPath: nextConfig,
        env: { HOME: home },
      })
    ).config.corpusDbPath;
    expect(await exists(emptyCorpusPath)).toBe(false);
    const emptySetup = await runWithCapture(
      ["next", "--cwd", workspace.rootDir, "--config", nextConfig, "--json"],
      { HOME: home },
    );
    const emptySetupData = JSON.parse(emptySetup.stdout).data;
    expect(emptySetupData).toMatchObject({
      recommendedCommand: "atlas repo add <repo>",
      state: { configFound: true, repoCount: 0 },
    });
    expect(emptySetupData.candidates).toContainEqual(
      expect.objectContaining({ command: "atlas repo add <repo>" }),
    );
    expect(await exists(emptyCorpusPath)).toBe(false);
    const humanNext = await runWithCapture(
      ["next", "--cwd", workspace.rootDir, "--config", nextConfig],
      { HOME: home },
    );
    expect(humanNext.stdout).toContain("Next: atlas repo add <repo>");
    expect(humanNext.stdout).toContain("Why:");
    expect(humanNext.stdout).not.toContain("Alternatives:");

    await writeFile(
      nextConfig,
      (await readFile(nextConfig, "utf8")).replace(
        "repos: []",
        `repos:
  - repoId: github.com/moxellabs/atlas
    mode: local-git
    git:
      remote: https://github.com/moxellabs/atlas.git
      localPath: ${join(workspace.rootDir, "next-cache", "atlas")}
      ref: main
      refMode: remote
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
        priority: 10`,
      ),
    );
    const configuredRepo = await runWithCapture(
      ["next", "--cwd", workspace.rootDir, "--config", nextConfig, "--json"],
      { HOME: home },
    );
    expect(JSON.parse(configuredRepo.stdout).data).toMatchObject({
      recommendedCommand: "atlas build --repo github.com/moxellabs/atlas",
      state: { configFound: true, repoCount: 1, documentCount: 0 },
    });

    const checkout = join(workspace.rootDir, "next-checkout");
    await mkdir(checkout, { recursive: true });
    await git(checkout, ["init", "-b", "main"]);
    await git(checkout, ["config", "user.email", "atlas@example.test"]);
    await git(checkout, ["config", "user.name", "ATLAS Test"]);
    await git(checkout, [
      "remote",
      "add",
      "origin",
      "git@github.com:moxellabs/atlas.git",
    ]);
    await writeFile(join(checkout, "README.md"), "# Atlas\n");
    await git(checkout, ["add", "."]);
    await git(checkout, ["commit", "-m", "initial"]);
    await runWithCapture(
      ["init", "--cwd", checkout, "--config", nextConfig, "--non-interactive"],
      { HOME: home },
    );
    const buildNext = await runWithCapture(
      ["next", "--cwd", checkout, "--config", nextConfig, "--json"],
      { HOME: home },
    );
    expect(JSON.parse(buildNext.stdout).data).toMatchObject({
      recommendedCommand: "atlas build",
      state: { repoMetadataFound: true, artifactFound: false },
    });
  });

  test("setup bootstraps a YAML config and add-repo preserves it", async () => {
    const init = await runWithCapture([
      "setup",
      "--cwd",
      workspace.rootDir,
      "--non-interactive",
      "--cache-dir",
      workspace.cacheDir,
    ]);
    expect(init.exitCode).toBe(0);
    expect(await Bun.file(workspace.configPath).exists()).toBe(true);
    expect(await readFile(workspace.configPath, "utf8")).toContain(
      "version: 1",
    );

    const added = await runWithCapture([
      "add-repo",
      "--cwd",
      workspace.rootDir,
      "--config",
      workspace.configPath,
      "--cache-dir",
      workspace.cacheDir,
      "--non-interactive",
      "--repo-id",
      "github.mycorp.com/platform/docs",
      "--mode",
      "local-git",
      "--remote",
      `file://${workspace.originPath}`,
      "--local-path",
      workspace.localPath,
      "--ref",
      "main",
      "--template",
      "mixed-monorepo",
    ]);
    expect(added.exitCode).toBe(0);

    const resolved = await loadConfig({
      cwd: workspace.rootDir,
      configPath: workspace.configPath,
    });
    expect(resolved.config.repos).toHaveLength(1);
    expect(resolved.config.repos[0]).toMatchObject({
      repoId: "github.mycorp.com/platform/docs",
      mode: "local-git",
      git: {
        remote: `file://${workspace.originPath}`,
        localPath: workspace.localPath,
      },
    });
    expect(await readFile(workspace.configPath, "utf8")).toContain(
      "repoId: github.mycorp.com/platform/docs",
    );
  });
});
