import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { loadConfig } from "@atlas/config";
import { openStore, RepoRepository } from "@atlas/store";
import { repoIdFromGitRemote } from "./commands/git";
import { createCliArtifactFixture } from "./cli.artifact-test-helpers";
import { ghesConfig } from "./cli.repo-test-helpers";
import {
  createCliTestWorkspace,
  createOriginRepo,
  exists,
  git,
  removeCliTestWorkspace,
  runWithCapture,
  type CliTestWorkspace,
} from "./cli.test-helpers";

describe("atlas CLI repository acquisition", () => {
  let workspace: CliTestWorkspace;

  beforeEach(async () => {
    workspace = await createCliTestWorkspace();
  });

  afterEach(async () => {
    await removeCliTestWorkspace(workspace);
  });

  test("repo target inference canonicalizes supported git remotes", () => {
    const cases = [
      ["git@github.com:Owner/Repo.git", "github.com/owner/repo"],
      ["http://github.com/Owner/Repo.git", "github.com/owner/repo"],
      ["https://github.com/Owner/Repo.git", "github.com/owner/repo"],
      [
        "ssh://git@github.mycorp.com/Platform/Docs.git",
        "github.mycorp.com/platform/docs",
      ],
    ] as const;

    for (const [remote, repoId] of cases) {
      expect(repoIdFromGitRemote(remote)).toBe(repoId);
    }
  });

  test("repo target inference rejects unsafe and malformed git remotes", () => {
    const cases = [
      "file:///tmp/platform/docs.git",
      "github.com/owner/repo",
      "../owner/repo",
      "git@github.com:Owner/Repo.git?x=1",
      "git@github.com:owner/repo.git#fragment",
      "git@github.com:owner/repo%2Fextra.git",
      "git@github.com:owner/repo/extra.git",
      "git@github.com:owner",
      "https://github.com/Owner/Repo.git?x=1",
      "https://github.com/Owner/Repo.git#fragment",
      "https://github.com/Owner/Repo.git%2Fextra",
      "https://github.com/Owner",
      "https://github.com//Owner/Repo.git",
    ];

    for (const remote of cases) {
      expect(repoIdFromGitRemote(remote)).toBeUndefined();
    }
  });

  test("repo add alias preserves add-repo JSON result shape", async () => {
    const topLevelHome = join(
      workspace.rootDir,
      "home-repo-add-alias-top-level",
    );
    const nestedHome = join(workspace.rootDir, "home-repo-add-alias-nested");
    await runWithCapture(
      [
        "setup",
        "--cwd",
        workspace.rootDir,
        "--cache-dir",
        workspace.cacheDir,
        "--non-interactive",
      ],
      { HOME: topLevelHome },
    );
    await runWithCapture(
      [
        "setup",
        "--cwd",
        workspace.rootDir,
        "--cache-dir",
        workspace.cacheDir,
        "--non-interactive",
      ],
      { HOME: nestedHome },
    );
    const topLevelConfig = join(topLevelHome, ".moxel", "atlas", "config.yaml");
    const nestedConfig = join(nestedHome, ".moxel", "atlas", "config.yaml");
    const origin = join(workspace.rootDir, "repo-add-alias-origin");
    await createOriginRepo(origin);
    await createCliArtifactFixture(origin, "repo-add-alias-revision");
    await git(origin, ["add", ".moxel/atlas"]);
    await git(origin, ["commit", "-m", "publish atlas artifact"]);
    const topLevel = await runWithCapture(
      [
        "add-repo",
        "moxellabs/atlas",
        "--cwd",
        workspace.rootDir,
        "--config",
        topLevelConfig,
        "--cache-dir",
        join(workspace.rootDir, "alias-top"),
        "--remote",
        origin,
        "--non-interactive",
        "--json",
      ],
      { HOME: topLevelHome },
    );
    const nested = await runWithCapture(
      [
        "repo",
        "add",
        "moxellabs/atlas",
        "--cwd",
        workspace.rootDir,
        "--config",
        nestedConfig,
        "--cache-dir",
        join(workspace.rootDir, "alias-nested"),
        "--remote",
        origin,
        "--non-interactive",
        "--json",
      ],
      { HOME: nestedHome },
    );
    expect(topLevel.exitCode).toBe(0);
    expect(nested.exitCode).toBe(0);
    expect(Object.keys(JSON.parse(nested.stdout).data).sort()).toEqual(
      Object.keys(JSON.parse(topLevel.stdout).data).sort(),
    );
    expect(JSON.parse(nested.stdout).data.repo.repoId).toBe(
      "github.com/moxellabs/atlas",
    );
  }, 30_000);

  test("shorthand repo input uses configured default host before public GitHub", async () => {
    const home = join(workspace.rootDir, "home-default-host");
    await runWithCapture(
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
    const cfg = join(home, ".moxel", "atlas", "config.yaml");
    await runWithCapture([
      "hosts",
      "add",
      "github.mycorp.com",
      "--cwd",
      workspace.rootDir,
      "--config",
      cfg,
      "--web-url",
      "https://github.mycorp.com",
      "--api-url",
      "https://github.mycorp.com/api/v3",
      "--protocol",
      "ssh",
      "--priority",
      "10",
      "--default",
    ]);

    const originalFetch = globalThis.fetch;
    globalThis.fetch = (async (input: RequestInfo | URL) => {
      const url = new URL(String(input));
      if (url.pathname === "/api/v3/repos/platform/docs") {
        return new Response(
          JSON.stringify({ id: 1, full_name: "platform/docs" }),
        );
      }
      return new Response("not found", { status: 404 });
    }) as unknown as typeof fetch;
    try {
      const result = await runWithCapture(
        [
          "add-repo",
          "platform/docs",
          "--cwd",
          workspace.rootDir,
          "--config",
          cfg,
          "--cache-dir",
          workspace.cacheDir,
          "--non-interactive",
          "--json",
        ],
        { HOME: home },
      );
      expect(result.exitCode).toBe(0);
      expect(JSON.parse(result.stdout).data.repoId).toBe(
        "github.mycorp.com/platform/docs",
      );
    } finally {
      globalThis.fetch = originalFetch;
    }
  });

  test("add-repo falls back to github.com for shorthand when enterprise repo is absent", async () => {
    const home = join(workspace.rootDir, "home-add-repo-enterprise-fallback");
    await runWithCapture(
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
    const cfg = join(home, ".moxel", "atlas", "config.yaml");
    await runWithCapture([
      "hosts",
      "add",
      "github.mycorp.com",
      "--cwd",
      workspace.rootDir,
      "--config",
      cfg,
      "--web-url",
      "https://github.mycorp.com",
      "--api-url",
      "https://github.mycorp.com/api/v3",
      "--protocol",
      "https",
      "--priority",
      "10",
      "--default",
    ]);
    const publicArtifactRoot = join(
      workspace.rootDir,
      "public-fallback-artifact",
    );
    await createCliArtifactFixture(
      publicArtifactRoot,
      "public-fallback-revision",
    );

    const originalFetch = globalThis.fetch;
    globalThis.fetch = (async (input: RequestInfo | URL) => {
      const url = new URL(String(input));
      if (url.hostname === "github.mycorp.com") {
        return new Response(JSON.stringify({ message: "not found" }), {
          status: 404,
        });
      }
      if (url.hostname !== "api.github.com") {
        return new Response(JSON.stringify({ message: "not found" }), {
          status: 404,
        });
      }
      if (url.pathname === "/repos/moxellabs/atlas/branches/main") {
        return new Response(
          JSON.stringify({ commit: { sha: "public-fallback-revision" } }),
        );
      }
      const prefix = "/repos/moxellabs/atlas/contents/.moxel/atlas/";
      if (!url.pathname.startsWith(prefix)) {
        return new Response(JSON.stringify({ message: "not found" }), {
          status: 404,
        });
      }
      const file = url.pathname.slice(prefix.length);
      const artifactFile = Bun.file(
        join(publicArtifactRoot, ".moxel", "atlas", file),
      );
      if (!(await artifactFile.exists())) {
        return new Response(JSON.stringify({ message: "not found" }), {
          status: 404,
        });
      }
      return new Response(await artifactFile.arrayBuffer());
    }) as unknown as typeof fetch;
    try {
      const result = await runWithCapture(
        [
          "add-repo",
          "moxellabs/atlas",
          "--cwd",
          workspace.rootDir,
          "--config",
          cfg,
          "--cache-dir",
          workspace.cacheDir,
          "--mode",
          "ghes-api",
          "--non-interactive",
          "--json",
        ],
        { HOME: home },
      );
      expect(result.exitCode).toBe(0);
      const data = JSON.parse(result.stdout).data;
      expect(data.repo.repoId).toBe("github.com/moxellabs/atlas");
      expect(data.repo.github.baseUrl).toBe("https://api.github.com");
      expect(data.artifactFound).toBe(true);
    } finally {
      globalThis.fetch = originalFetch;
    }
  });

  test("add-repo imports published artifact through git before API auth", async () => {
    const home = join(workspace.rootDir, "home-add-repo-git-first");
    const cfg = join(workspace.rootDir, "git-first.config.yaml");
    await runWithCapture(
      [
        "setup",
        "--cwd",
        workspace.rootDir,
        "--config",
        cfg,
        "--cache-dir",
        workspace.cacheDir,
        "--non-interactive",
      ],
      { HOME: home },
    );
    const gitFirstRepo = join(workspace.rootDir, "git-first-origin");
    await createOriginRepo(gitFirstRepo);
    await createCliArtifactFixture(gitFirstRepo, "git-first-revision");
    await git(gitFirstRepo, ["add", ".moxel/atlas"]);
    await git(gitFirstRepo, ["commit", "-m", "publish atlas artifact"]);

    const originalFetch = globalThis.fetch;
    globalThis.fetch = (async () => {
      throw new Error("API should not be used when git can read the artifact");
    }) as unknown as typeof fetch;
    try {
      const result = await runWithCapture(
        [
          "add-repo",
          "moxellabs/atlas",
          "--cwd",
          workspace.rootDir,
          "--config",
          cfg,
          "--cache-dir",
          workspace.cacheDir,
          "--remote",
          gitFirstRepo,
          "--non-interactive",
          "--json",
        ],
        {
          HOME: home,
          GH_TOKEN: "",
          GITHUB_TOKEN: "",
          GHES_TOKEN: "",
          GH_ENTERPRISE_TOKEN: "",
        },
      );
      expect(result.exitCode).toBe(0);
      const data = JSON.parse(result.stdout).data;
      expect(data.artifactFound).toBe(true);
      expect(data.artifactSource).toBe("local-artifact");
      expect(data.repo.mode).toBe("local-git");
      expect(data.importStatus).toBe("imported");
    } finally {
      globalThis.fetch = originalFetch;
    }
  });

  test("init auto-configures detected enterprise host from git origin", async () => {
    const home = join(workspace.rootDir, "home-enterprise-init");
    const cfg = join(workspace.rootDir, "enterprise-init.config.yaml");
    const setup = await runWithCapture(
      [
        "setup",
        "--cwd",
        workspace.rootDir,
        "--config",
        cfg,
        "--cache-dir",
        workspace.cacheDir,
        "--non-interactive",
      ],
      { HOME: home },
    );
    expect(setup.exitCode).toBe(0);

    const enterpriseRepo = join(workspace.rootDir, "enterprise-origin");
    await mkdir(enterpriseRepo, { recursive: true });
    await git(enterpriseRepo, ["init", "-b", "main"]);
    await git(enterpriseRepo, ["config", "user.email", "atlas@example.test"]);
    await git(enterpriseRepo, ["config", "user.name", "ATLAS Test"]);
    await git(enterpriseRepo, [
      "remote",
      "add",
      "origin",
      "git@github.mycorp.com:platform/docs.git",
    ]);
    await writeFile(join(enterpriseRepo, "README.md"), "# Enterprise docs\n");
    await git(enterpriseRepo, ["add", "."]);
    await git(enterpriseRepo, ["commit", "-m", "initial"]);

    const initialized = await runWithCapture(
      [
        "init",
        "--cwd",
        enterpriseRepo,
        "--config",
        cfg,
        "--non-interactive",
        "--json",
      ],
      { HOME: home },
    );
    expect(initialized.exitCode).toBe(0);
    expect(JSON.parse(initialized.stdout).data).toMatchObject({
      repoId: "github.mycorp.com/platform/docs",
      targetResolution: {
        source: "git-origin",
        hostStatus: "configured",
      },
    });
    expect(await readFile(cfg, "utf8")).toContain("name: github.mycorp.com");
  });

  test("repo target inference supports cwd, git origin, bare names, and ambiguity", async () => {
    const initRepo = join(workspace.rootDir, "github-origin");
    await mkdir(initRepo, { recursive: true });
    await git(initRepo, ["init", "-b", "main"]);
    await git(initRepo, ["config", "user.email", "atlas@example.test"]);
    await git(initRepo, ["config", "user.name", "ATLAS Test"]);
    await git(initRepo, [
      "remote",
      "add",
      "origin",
      "git@github.com:moxellabs/atlas.git",
    ]);
    await writeFile(join(initRepo, "README.md"), "# Atlas\n");
    await git(initRepo, ["add", "."]);
    await git(initRepo, ["commit", "-m", "initial"]);

    const inferredInit = await runWithCapture([
      "init",
      "--cwd",
      initRepo,
      "--json",
    ]);
    expect(inferredInit.exitCode).toBe(0);
    expect(JSON.parse(inferredInit.stdout).data.targetResolution).toMatchObject(
      {
        repoId: "github.com/moxellabs/atlas",
        source: "git-origin",
      },
    );

    await runWithCapture([
      "setup",
      "--cwd",
      workspace.rootDir,
      "--non-interactive",
      "--cache-dir",
      workspace.cacheDir,
    ]);
    await runWithCapture([
      "add-repo",
      "--cwd",
      workspace.rootDir,
      "--config",
      workspace.configPath,
      "--cache-dir",
      workspace.cacheDir,
      "--non-interactive",
      "--repo-id",
      "github.com/platform/docs",
      "--mode",
      "local-git",
      "--remote",
      `file://${workspace.originPath}`,
      "--local-path",
      workspace.originPath,
      "--ref",
      "main",
      "--template",
      "mixed-monorepo",
    ]);

    const corpusDbPath = (
      await loadConfig({
        cwd: workspace.rootDir,
        configPath: workspace.configPath,
      })
    ).config.corpusDbPath;
    const seededDb = openStore({ path: corpusDbPath, migrate: true });
    try {
      new RepoRepository(seededDb).upsert({
        repoId: "github.com/platform/docs",
        mode: "local-git",
        revision: "dry-run-test",
      });
    } finally {
      seededDb.close();
    }

    const cwdDoctor = await runWithCapture([
      "repo",
      "doctor",
      "--cwd",
      workspace.originPath,
      "--config",
      workspace.configPath,
      "--json",
    ]);
    expect(cwdDoctor.exitCode).toBe(0);
    expect(JSON.parse(cwdDoctor.stdout).data.targetResolution.source).toBe(
      "cwd-config",
    );
    expect(JSON.parse(cwdDoctor.stdout).data.checks[0].layer).toBe("registry");

    const bareShow = await runWithCapture([
      "repo",
      "show",
      "docs",
      "--cwd",
      workspace.rootDir,
      "--config",
      workspace.configPath,
      "--json",
    ]);
    expect(bareShow.exitCode).toBe(0);
    expect(JSON.parse(bareShow.stdout).data.targetResolution).toMatchObject({
      repoId: "github.com/platform/docs",
      source: "bare-name",
    });

    const bareShowHuman = await runWithCapture([
      "repo",
      "show",
      "docs",
      "--cwd",
      workspace.rootDir,
      "--config",
      workspace.configPath,
    ]);
    expect(bareShowHuman.exitCode).toBe(0);
    expect(bareShowHuman.stdout).toContain("Repo: github.com/platform/docs");
    expect(bareShowHuman.stdout).toContain("Configured: yes");
    expect(bareShowHuman.stdout).toContain("Metadata found: yes");
    expect(bareShowHuman.stdout).toContain("Mode: local-git");
    expect(bareShowHuman.stdout).toContain(
      `Source: file://${workspace.originPath}`,
    );
    expect(bareShowHuman.stdout).toContain("Config entry: local-git");
    expect(bareShowHuman.stdout).toContain("Full details: rerun with --json.");
    expect(bareShowHuman.stdout).not.toContain('"targetResolution"');

    const bareRemoveDryRun = await runWithCapture([
      "repo",
      "remove",
      "docs",
      "--dry-run",
      "--cwd",
      workspace.rootDir,
      "--config",
      workspace.configPath,
      "--json",
    ]);
    expect(bareRemoveDryRun.exitCode).toBe(0);
    expect(
      JSON.parse(bareRemoveDryRun.stdout).data.targetResolution,
    ).toMatchObject({
      repoId: "github.com/platform/docs",
      source: "bare-name",
    });
    expect(JSON.parse(bareRemoveDryRun.stdout).data).toMatchObject({
      deletedCorpusCounts: {
        repos: 1,
        manifests: 0,
      },
      removedConfigEntry: false,
      removedFolder: false,
      removedStoreRows: false,
      dryRun: true,
    });
    const dryRunDb = openStore({ path: corpusDbPath });
    try {
      expect(dryRunDb.path).toBe(corpusDbPath);
      expect(
        new RepoRepository(dryRunDb).get("github.com/platform/docs"),
      ).toBeTruthy();
    } finally {
      dryRunDb.close();
    }

    const unknownRemove = await runWithCapture([
      "repo",
      "remove",
      "missing",
      "--dry-run",
      "--cwd",
      workspace.rootDir,
      "--config",
      workspace.configPath,
      "--json",
    ]);
    expect(unknownRemove.exitCode).toBe(2);
    expect(JSON.parse(unknownRemove.stdout).error.code).toBe(
      "CLI_REPO_TARGET_NOT_FOUND",
    );

    await runWithCapture([
      "add-repo",
      "--cwd",
      workspace.rootDir,
      "--config",
      workspace.configPath,
      "--cache-dir",
      workspace.cacheDir,
      "--non-interactive",
      "--repo-id",
      "github.com/other/docs",
      "--mode",
      "local-git",
      "--remote",
      `file://${workspace.originPath}`,
      "--local-path",
      workspace.originPath,
      "--ref",
      "main",
      "--template",
      "mixed-monorepo",
    ]);
    const ambiguous = await runWithCapture([
      "repo",
      "doctor",
      "docs",
      "--cwd",
      workspace.rootDir,
      "--config",
      workspace.configPath,
      "--json",
    ]);
    expect(ambiguous.exitCode).toBe(2);
    const ambiguity = JSON.parse(ambiguous.stdout);
    expect(ambiguity.error.code).toBe("CLI_REPO_TARGET_AMBIGUOUS");
    expect(ambiguity.error.details.candidates).toEqual([
      "github.com/other/docs",
      "github.com/platform/docs",
    ]);

    const ambiguousRemove = await runWithCapture([
      "repo",
      "remove",
      "docs",
      "--dry-run",
      "--cwd",
      workspace.rootDir,
      "--config",
      workspace.configPath,
      "--json",
    ]);
    expect(ambiguousRemove.exitCode).toBe(2);
    expect(JSON.parse(ambiguousRemove.stdout).error.code).toBe(
      "CLI_REPO_TARGET_AMBIGUOUS",
    );

    const canonicalRemove = await runWithCapture([
      "repo",
      "remove",
      "github.com/platform/docs",
      "--yes",
      "--cwd",
      workspace.rootDir,
      "--config",
      workspace.configPath,
      "--json",
    ]);
    expect(canonicalRemove.exitCode).toBe(0);
    expect(JSON.parse(canonicalRemove.stdout).data).toMatchObject({
      repoId: "github.com/platform/docs",
      removedConfigEntry: true,
    });
  });

  test("add-repo infers a file remote and current branch inside an unpublished local git checkout", async () => {
    await runWithCapture([
      "init",
      "--cwd",
      workspace.rootDir,
      "--non-interactive",
      "--cache-dir",
      workspace.cacheDir,
    ]);

    const result = await runWithCapture([
      "add-repo",
      "--cwd",
      workspace.originPath,
      "--config",
      workspace.configPath,
      "--cache-dir",
      workspace.cacheDir,
      "--non-interactive",
      "--repo-id",
      "github.mycorp.com/platform/local",
      "--json",
    ]);

    expect(result.exitCode).toBe(0);
    expect(JSON.parse(result.stdout)).toMatchObject({
      ok: true,
      command: "add-repo",
      data: {
        repo: {
          repoId: "github.mycorp.com/platform/local",
          git: {
            remote: pathToFileURL(workspace.originPath).href,
            localPath: join(
              workspace.cacheDir,
              "checkouts",
              "github.mycorp.com/platform/local",
            ),
            ref: "main",
          },
        },
      },
    });
  });

  test("add-repo prefers origin remote when one is configured", async () => {
    await git(workspace.originPath, [
      "remote",
      "add",
      "origin",
      "ssh://git@ghe.example.com/platform/atlas.git",
    ]);
    await runWithCapture([
      "init",
      "--cwd",
      workspace.rootDir,
      "--non-interactive",
      "--cache-dir",
      workspace.cacheDir,
    ]);

    const result = await runWithCapture([
      "add-repo",
      "--cwd",
      workspace.originPath,
      "--config",
      workspace.configPath,
      "--cache-dir",
      workspace.cacheDir,
      "--non-interactive",
      "--repo-id",
      "github.mycorp.com/platform/origin",
      "--template",
      "mixed-monorepo",
      "--json",
    ]);

    expect(result.exitCode).toBe(0);
    expect(JSON.parse(result.stdout)).toMatchObject({
      data: {
        repo: {
          git: {
            remote: "ssh://git@ghe.example.com/platform/atlas.git",
            ref: "main",
          },
        },
      },
    });
  });

  test("add-repo still requires a remote outside a git checkout", async () => {
    const nonGitRoot = join(workspace.rootDir, "not-git");
    await mkdir(nonGitRoot, { recursive: true });

    const result = await runWithCapture([
      "add-repo",
      "--cwd",
      nonGitRoot,
      "--non-interactive",
      "--repo-id",
      "missing-remote",
      "--template",
      "mixed-monorepo",
      "--json",
    ]);

    expect(result.exitCode).toBe(2);
    expect(JSON.parse(result.stdout)).toMatchObject({
      ok: false,
      command: "add-repo",
      error: {
        code: "CLI_REMOTE_REQUIRED",
        message: expect.stringContaining(
          "run add-repo from inside a Git checkout",
        ),
      },
    });
  });

  test("add-repo bootstraps runtime directories and list repos works before sync", async () => {
    const bootstrapConfigPath = join(
      workspace.rootDir,
      "bootstrap.config.yaml",
    );
    const bootstrapCacheDir = join(
      workspace.rootDir,
      ".bootstrap-cache",
      "github.mycorp.com/platform/docs",
    );
    const result = await runWithCapture([
      "add-repo",
      "--cwd",
      workspace.originPath,
      "--config",
      bootstrapConfigPath,
      "--cache-dir",
      bootstrapCacheDir,
      "--non-interactive",
      "--repo-id",
      "github.mycorp.com/platform/bootstrap",
      "--template",
      "mixed-monorepo",
      "--json",
    ]);
    expect(result.exitCode).toBe(0);
    const resolved = await loadConfig({
      cwd: workspace.rootDir,
      configPath: bootstrapConfigPath,
    });
    expect(await exists(resolved.config.cacheDir)).toBe(true);
    expect(await exists(join(resolved.config.cacheDir, "repos"))).toBe(true);
    expect(await exists(resolved.config.corpusDbPath)).toBe(false);

    const list = await runWithCapture([
      "list",
      "repos",
      "--cwd",
      workspace.rootDir,
      "--config",
      bootstrapConfigPath,
      "--json",
    ]);
    expect(list.exitCode).toBe(0);
    expect(JSON.parse(list.stdout)).toMatchObject({
      ok: true,
      command: "list",
      data: [
        expect.objectContaining({
          repoId: "github.mycorp.com/platform/bootstrap",
          mode: "local-git",
        }),
      ],
    });
    expect(await exists(resolved.config.corpusDbPath)).toBe(false);
  });

  test("doctor checks GHES token and ref access without leaking secrets", async () => {
    const ghesConfigPath = join(workspace.rootDir, "ghes.config.yaml");
    await mkdir(
      join(workspace.rootDir, ".cache", "github.mycorp.com/platform/docs"),
      {
        recursive: true,
      },
    );
    await writeFile(ghesConfigPath, ghesConfig("http://127.0.0.1:1/api/v3"));

    const missingToken = await runWithCapture([
      "doctor",
      "--cwd",
      workspace.rootDir,
      "--config",
      ghesConfigPath,
      "--repo",
      "github.mycorp.com/platform/ghes",
      "--json",
    ]);
    expect(JSON.parse(missingToken.stdout).data).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          name: "repo:github.mycorp.com/platform/ghes:ghes-auth",
          status: "fail",
          message: expect.stringContaining("No GHES token found."),
        }),
      ]),
    );

    const originalFetch = globalThis.fetch;
    globalThis.fetch = (async (input, init) => {
      const url = new URL(String(input));
      const headers = new Headers(init?.headers);
      if (
        url.pathname === "/api/v3/repos/moxellabs/atlas/commits/main" &&
        headers.get("authorization") === "Bearer secret-token"
      ) {
        return new Response(
          JSON.stringify({ sha: "3333333333333333333333333333333333333333" }),
          {
            headers: { "content-type": "application/json" },
          },
        );
      }
      return new Response(JSON.stringify({ message: "not found" }), {
        status: 404,
      });
    }) as typeof fetch;
    try {
      await writeFile(
        ghesConfigPath,
        ghesConfig("http://127.0.0.1:43191/api/v3"),
      );
      const reachable = await runWithCapture(
        [
          "doctor",
          "--cwd",
          workspace.rootDir,
          "--config",
          ghesConfigPath,
          "--repo",
          "github.mycorp.com/platform/ghes",
          "--json",
        ],
        {
          ATLAS_GHES_TOKEN: "secret-token",
        },
      );
      expect(JSON.parse(reachable.stdout).data).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            name: "repo:github.mycorp.com/platform/ghes:ghes-ref",
            status: "pass",
            message: expect.stringContaining(
              "3333333333333333333333333333333333333333",
            ),
          }),
        ]),
      );
      expect(reachable.stdout).not.toContain("secret-token");
    } finally {
      globalThis.fetch = originalFetch;
    }
  });

  test("phase 13 hosts and repo resolver smoke", async () => {
    const root = workspace.rootDir;
    const config = join(root, "home", ".moxel", "atlas", "config.yaml");
    expect(
      (
        await runWithCapture([
          "setup",
          "--cwd",
          root,
          "--non-interactive",
          "--json",
        ])
      ).exitCode,
    ).toBe(0);
    expect(
      (await runWithCapture(["hosts", "list", "--cwd", root, "--json"]))
        .exitCode,
    ).toBe(0);
    expect(
      (
        await runWithCapture([
          "hosts",
          "add",
          "github.mycorp.com",
          "--cwd",
          root,
          "--web-url",
          "https://github.mycorp.com",
          "--api-url",
          "https://github.mycorp.com/api/v3",
          "--protocol",
          "ssh",
          "--priority",
          "10",
          "--default",
          "--json",
        ])
      ).exitCode,
    ).toBe(0);
    const configText = await readFile(config, "utf8");
    expect(configText).toContain("github.mycorp.com");
    expect(configText).toContain("https://github.mycorp.com/api/v3");
    expect(
      (
        await runWithCapture([
          "add-repo",
          "platform/docs",
          "--cwd",
          root,
          "--host",
          "github.mycorp.com",
          "--template",
          "mixed-monorepo",
          "--non-interactive",
          "--template",
          "basic",
          "--json",
        ])
      ).exitCode,
    ).toBe(0);
  });
});
