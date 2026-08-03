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

describe("atlas CLI sync, build, and index", () => {
  let workspace: CliTestWorkspace;

  beforeEach(async () => {
    workspace = await createCliTestWorkspace();
  });

  afterEach(async () => {
    await removeCliTestWorkspace(workspace);
  });

  test("sync, build, list, inspect, doctor, clean, and prune work end to end in JSON mode", async () => {
    await runWithCapture([
      "init",
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

    const sync = await runWithCapture([
      "sync",
      "--cwd",
      workspace.rootDir,
      "--config",
      workspace.configPath,
      "--json",
    ]);
    expect(sync.exitCode).toBe(0);
    expect(JSON.parse(sync.stdout)).toMatchObject({
      ok: true,
      command: "sync",
      data: {
        reports: expect.any(Array),
      },
    });

    const build = await runWithCapture([
      "build",
      "--cwd",
      workspace.rootDir,
      "--config",
      workspace.configPath,
      "--json",
    ]);
    expect(build.exitCode, build.stderr).toBe(0);
    expect(JSON.parse(build.stdout)).toMatchObject({
      ok: true,
      command: "build",
      data: {
        reports: expect.any(Array),
        successCount: 1,
      },
    });

    const list = await runWithCapture([
      "list",
      "repos",
      "--cwd",
      workspace.rootDir,
      "--config",
      workspace.configPath,
      "--json",
    ]);
    expect(JSON.parse(list.stdout)).toMatchObject({
      ok: true,
      command: "list",
      data: [
        expect.objectContaining({ repoId: "github.mycorp.com/platform/docs" }),
      ],
    });

    const packages = JSON.parse(
      (
        await runWithCapture([
          "list",
          "packages",
          "--cwd",
          workspace.rootDir,
          "--config",
          workspace.configPath,
          "--repo",
          "GitHub.MyCorp.com/Platform/Docs",
          "--json",
        ])
      ).stdout,
    );
    const modules = JSON.parse(
      (
        await runWithCapture([
          "list",
          "modules",
          "--cwd",
          workspace.rootDir,
          "--config",
          workspace.configPath,
          "--repo",
          "github.mycorp.com/platform/docs",
          "--json",
        ])
      ).stdout,
    );
    const packageId = packages.data[0]?.packageId as string;
    const moduleId = modules.data[0]?.moduleId as string;

    const scopedSkills = await runWithCapture([
      "list",
      "skills",
      "--cwd",
      workspace.rootDir,
      "--config",
      workspace.configPath,
      "--module",
      moduleId,
      "--json",
    ]);
    expect(JSON.parse(scopedSkills.stdout)).toMatchObject({
      ok: true,
      command: "list",
      data: [expect.objectContaining({ moduleId })],
    });

    const packageScopedSkills = await runWithCapture([
      "list",
      "skills",
      "--cwd",
      workspace.rootDir,
      "--config",
      workspace.configPath,
      "--package",
      packageId,
      "--json",
    ]);
    expect(JSON.parse(packageScopedSkills.stdout)).toMatchObject({
      ok: true,
      command: "list",
    });
    const skillsPayload = JSON.parse(scopedSkills.stdout);
    const skillId = (skillsPayload.data as Array<{ skillId: string }>)[0]
      ?.skillId as string;
    expect(skillId).toBeDefined();

    const workspaceInstall = await runWithCapture([
      "install-skill",
      skillId,
      "--cwd",
      workspace.rootDir,
      "--config",
      workspace.configPath,
      "--target",
      "claude-code",
      "--scope",
      "workspace",
      "--workspace",
      workspace.rootDir,
      "--json",
    ]);
    expect(workspaceInstall.exitCode).toBe(0);
    const workspaceInstallPayload = JSON.parse(workspaceInstall.stdout);
    expect(workspaceInstallPayload).toMatchObject({
      ok: true,
      command: "install-skill",
      data: {
        target: "claude-code",
        scope: "workspace",
        dryRun: false,
        skills: [expect.objectContaining({ skillId })],
        writtenFiles: [
          expect.stringContaining(".claude/skills/auth-skill/SKILL.md"),
        ],
      },
    });
    expect(
      await readFile(
        join(workspace.rootDir, ".claude", "skills", "auth-skill", "SKILL.md"),
        "utf8",
      ),
    ).toContain(`ATLAS skill ID: ${skillId}`);

    const overwriteRefused = await runWithCapture([
      "install-skill",
      skillId,
      "--cwd",
      workspace.rootDir,
      "--config",
      workspace.configPath,
      "--target",
      "claude-code",
      "--scope",
      "workspace",
      "--workspace",
      workspace.rootDir,
      "--json",
    ]);
    expect(JSON.parse(overwriteRefused.stdout)).toMatchObject({
      ok: true,
      command: "install-skill",
      data: {
        writtenFiles: [],
        skippedFiles: [
          expect.stringContaining(".claude/skills/auth-skill/SKILL.md"),
        ],
      },
    });

    const userDryRun = await runWithCapture(
      [
        "install-skill",
        "--repo",
        "github.mycorp.com/platform/docs",
        "--cwd",
        workspace.rootDir,
        "--config",
        workspace.configPath,
        "--target",
        "cursor",
        "--scope",
        "user",
        "--dry-run",
        "--json",
      ],
      { HOME: join(workspace.rootDir, "home") },
    );
    expect(JSON.parse(userDryRun.stdout)).toMatchObject({
      ok: true,
      command: "install-skill",
      data: {
        target: "cursor",
        scope: "user",
        dryRun: true,
        writtenFiles: [],
        wouldWriteFiles: [
          expect.stringContaining(".cursor/rules/auth-skill.mdc"),
        ],
      },
    });
    expect(
      await exists(
        join(workspace.rootDir, "home", ".cursor", "rules", "auth-skill.mdc"),
      ),
    ).toBe(false);

    const docs = await runWithCapture([
      "list",
      "docs",
      "--cwd",
      workspace.rootDir,
      "--config",
      workspace.configPath,
      "--repo",
      "github.mycorp.com/platform/docs",
      "--json",
    ]);
    const docsPayload = JSON.parse(docs.stdout);
    const docRows = docsPayload.data as Array<{ docId?: string }>;
    const docId = docRows.find((doc) => typeof doc.docId === "string")
      ?.docId as string;
    expect(docId).toBeDefined();
    expect(docsPayload).toMatchObject({
      ok: true,
      command: "list",
      data: expect.arrayContaining([
        expect.objectContaining({ path: expect.stringContaining(".md") }),
      ]),
    });

    const sections = await runWithCapture([
      "list",
      "sections",
      "--cwd",
      workspace.rootDir,
      "--config",
      workspace.configPath,
      "--doc",
      docId,
      "--json",
    ]);
    const sectionsPayload = JSON.parse(sections.stdout);
    const sectionRows = sectionsPayload.data as Array<{ sectionId?: string }>;
    const sectionId = sectionRows.find(
      (section) => typeof section.sectionId === "string",
    )?.sectionId as string;
    expect(sectionId).toBeDefined();
    expect(sectionsPayload).toMatchObject({
      ok: true,
      command: "list",
      data: [
        expect.objectContaining({
          sectionId: expect.any(String),
          heading: expect.any(String),
        }),
      ],
    });

    const freshness = await runWithCapture([
      "list",
      "freshness",
      "--cwd",
      workspace.rootDir,
      "--config",
      workspace.configPath,
      "--repo",
      "github.mycorp.com/platform/docs",
      "--json",
    ]);
    expect(JSON.parse(freshness.stdout)).toMatchObject({
      ok: true,
      command: "list",
      data: [
        expect.objectContaining({
          repoId: "github.mycorp.com/platform/docs",
          fresh: true,
        }),
      ],
    });

    const inspect = await runWithCapture([
      "inspect",
      "manifest",
      "--cwd",
      workspace.rootDir,
      "--config",
      workspace.configPath,
      "--json",
    ]);
    expect(JSON.parse(inspect.stdout)).toMatchObject({
      ok: true,
      command: "inspect",
      data: [
        expect.objectContaining({ repoId: "github.mycorp.com/platform/docs" }),
      ],
    });

    const inspectFreshness = await runWithCapture([
      "inspect",
      "freshness",
      "github.mycorp.com/platform/docs",
      "--cwd",
      workspace.rootDir,
      "--config",
      workspace.configPath,
      "--json",
    ]);
    expect(JSON.parse(inspectFreshness.stdout)).toMatchObject({
      ok: true,
      command: "inspect",
      data: [
        expect.objectContaining({
          repoId: "github.mycorp.com/platform/docs",
          fresh: true,
          manifest: expect.any(Object),
        }),
      ],
    });

    const inspectSection = await runWithCapture([
      "inspect",
      "section",
      sectionId,
      "--cwd",
      workspace.rootDir,
      "--config",
      workspace.configPath,
      "--json",
    ]);
    expect(JSON.parse(inspectSection.stdout)).toMatchObject({
      ok: true,
      command: "inspect",
      data: {
        section: expect.objectContaining({ sectionId }),
        document: expect.objectContaining({ docId }),
      },
    });

    const datasetPath = join(workspace.rootDir, "eval.dataset.json");
    await writeFile(
      datasetPath,
      JSON.stringify({
        name: "cli-eval",
        cases: [
          {
            id: "session-docs",
            query: "session package documentation",
            expected: { authorities: ["preferred"] },
          },
        ],
      }),
    );
    const evalResult = await runWithCapture([
      "eval",
      "--cwd",
      workspace.rootDir,
      "--config",
      workspace.configPath,
      "--dataset",
      datasetPath,
      "--json",
    ]);
    expect(JSON.parse(evalResult.stdout)).toMatchObject({
      ok: true,
      command: "eval",
      data: {
        dataset: "cli-eval",
        totalCases: 1,
        passedCases: 1,
        metrics: expect.objectContaining({
          provenanceHitRate: 1,
          tokenBudgetPassRate: 1,
        }),
      },
    });

    const doctor = await runWithCapture([
      "doctor",
      "--cwd",
      workspace.rootDir,
      "--config",
      workspace.configPath,
      "--json",
    ]);
    expect(JSON.parse(doctor.stdout)).toMatchObject({
      ok: true,
      command: "doctor",
      data: expect.arrayContaining([
        expect.objectContaining({ name: "config", status: "pass" }),
      ]),
    });

    const resolved = await loadConfig({
      cwd: workspace.rootDir,
      configPath: workspace.configPath,
    });
    const corpusDbPath = resolved.config.corpusDbPath;
    await writeFile(`${corpusDbPath}-wal`, "wal");
    await writeFile(`${corpusDbPath}-shm`, "shm");
    await writeFile(`${corpusDbPath}-journal`, "journal");

    const cleanDryRun = await runWithCapture([
      "clean",
      "--cwd",
      workspace.rootDir,
      "--config",
      workspace.configPath,
      "--json",
      "--dry-run",
    ]);
    expect(JSON.parse(cleanDryRun.stdout)).toMatchObject({
      ok: true,
      command: "clean",
      data: {
        corpusDbPath,
        dryRun: true,
        removed: expect.arrayContaining([
          expect.objectContaining({ path: corpusDbPath }),
          expect.objectContaining({ path: `${corpusDbPath}-wal` }),
          expect.objectContaining({ path: `${corpusDbPath}-shm` }),
          expect.objectContaining({ path: `${corpusDbPath}-journal` }),
        ]),
        totalBytes: expect.any(Number),
      },
    });
    expect(await exists(corpusDbPath)).toBe(true);
    expect(await exists(workspace.localPath)).toBe(true);

    const clean = await runWithCapture([
      "clean",
      "--cwd",
      workspace.rootDir,
      "--config",
      workspace.configPath,
      "--json",
    ]);
    expect(JSON.parse(clean.stdout)).toMatchObject({
      ok: true,
      command: "clean",
      data: {
        corpusDbPath,
        dryRun: false,
        removed: expect.arrayContaining([
          expect.objectContaining({ path: corpusDbPath }),
          expect.objectContaining({ path: `${corpusDbPath}-wal` }),
          expect.objectContaining({ path: `${corpusDbPath}-shm` }),
          expect.objectContaining({ path: `${corpusDbPath}-journal` }),
        ]),
      },
    });
    expect(await exists(corpusDbPath)).toBe(false);
    expect(await exists(`${corpusDbPath}-wal`)).toBe(false);
    expect(await exists(`${corpusDbPath}-shm`)).toBe(false);
    expect(await exists(`${corpusDbPath}-journal`)).toBe(false);
    expect(await exists(workspace.localPath)).toBe(true);

    const cleanEmpty = await runWithCapture([
      "clean",
      "--cwd",
      workspace.rootDir,
      "--config",
      workspace.configPath,
      "--json",
    ]);
    expect(JSON.parse(cleanEmpty.stdout)).toMatchObject({
      ok: true,
      command: "clean",
      data: {
        corpusDbPath,
        dryRun: false,
        removed: [],
      },
    });

    await mkdir(join(workspace.cacheDir, "checkouts", "orphan"), {
      recursive: true,
    });
    await writeFile(
      join(workspace.cacheDir, "checkouts", "orphan", "stale.txt"),
      "stale",
    );
    const prune = await runWithCapture([
      "prune",
      "--cwd",
      workspace.rootDir,
      "--config",
      workspace.configPath,
      "--json",
      "--dry-run",
    ]);
    expect(JSON.parse(prune.stdout)).toMatchObject({
      ok: true,
      command: "prune",
      data: {
        dryRun: true,
        removed: expect.arrayContaining([
          expect.objectContaining({
            path: join(workspace.cacheDir, "checkouts", "orphan"),
          }),
        ]),
      },
    });
  });

  test("inspect topology --live succeeds while build reports post-discovery compile failure", async () => {
    await writeFile(
      join(workspace.originPath, "docs", "broken.md"),
      "---\ntitle: Broken\n# Missing closing frontmatter\n",
    );
    await git(workspace.originPath, ["add", "."]);
    await git(workspace.originPath, ["commit", "-m", "add broken doc"]);

    const topology = await runWithCapture([
      "inspect",
      "topology",
      "--cwd",
      workspace.originPath,
      "--live",
      "--json",
    ]);
    expect(topology.exitCode).toBe(0);
    expect(JSON.parse(topology.stdout)).toMatchObject({
      ok: true,
      data: { source: "live" },
    });

    await runWithCapture([
      "init",
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

    const build = await runWithCapture([
      "build",
      "--cwd",
      workspace.rootDir,
      "--config",
      workspace.configPath,
      "--repo",
      "github.mycorp.com/platform/docs",
      "--json",
      "--verbose",
    ]);
    expect(build.exitCode).toBe(1);
    const payload = JSON.parse(build.stdout);
    expect(payload).toMatchObject({
      ok: false,
      command: "build",
      error: {
        code: "CLI_BUILD_FAILED",
        details: {
          repoId: "github.mycorp.com/platform/docs",
          docsConsidered: 5,
          diagnostics: expect.arrayContaining([
            expect.objectContaining({
              stage: "compile",
              path: "docs/broken.md",
              cause: expect.objectContaining({
                cause: expect.objectContaining({
                  message: expect.stringContaining(
                    "Frontmatter opening marker",
                  ),
                }),
              }),
            }),
          ]),
        },
      },
    });
  });

  test("build ignores generated and vendored docs that live topology also skips", async () => {
    await mkdir(join(workspace.originPath, "node_modules", "bad-package"), {
      recursive: true,
    });
    await mkdir(join(workspace.originPath, ".moxel", "atlas"), {
      recursive: true,
    });
    await writeFile(
      join(workspace.originPath, "node_modules", "bad-package", "SKILL.md"),
      "---\ndescription: broken\n# Missing closing frontmatter\n",
    );
    await writeFile(
      join(workspace.originPath, ".moxel", "atlas", "SKILL.md"),
      "---\ndescription: generated broken\n# Missing closing frontmatter\n",
    );
    await git(workspace.originPath, ["add", "."]);
    await git(workspace.originPath, [
      "commit",
      "-m",
      "add ignored generated docs",
    ]);

    const topology = await runWithCapture([
      "inspect",
      "topology",
      "--cwd",
      workspace.originPath,
      "--live",
      "--json",
    ]);
    expect(topology.exitCode).toBe(0);
    const topologyPayload = JSON.parse(topology.stdout);
    const livePaths = (
      topologyPayload.data.docs as Array<{ path: string }>
    ).map((doc) => doc.path);
    expect(livePaths).not.toEqual(
      expect.arrayContaining([
        "node_modules/bad-package/SKILL.md",
        ".moxel/atlas/SKILL.md",
      ]),
    );

    await runWithCapture([
      "init",
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
    const build = await runWithCapture([
      "build",
      "--cwd",
      workspace.rootDir,
      "--config",
      workspace.configPath,
      "--repo",
      "github.mycorp.com/platform/docs",
      "--json",
    ]);
    expect(build.exitCode, build.stderr).toBe(0);
    expect(JSON.parse(build.stdout)).toMatchObject({
      ok: true,
      command: "build",
      data: {
        docsConsidered: 4,
        docsRebuilt: 4,
      },
    });
  });

  test("build rejects conflicting targeted selectors", async () => {
    const result = await runWithCapture([
      "build",
      "--json",
      "--repo",
      "github.mycorp.com/platform/docs",
      "--doc-id",
      "doc_1",
      "--package-id",
      "pkg_1",
    ]);

    expect(result.exitCode).toBe(2);
    expect(JSON.parse(result.stdout)).toMatchObject({
      ok: false,
      command: "build",
      error: {
        code: "CLI_INVALID_BUILD_SELECTOR",
      },
    });
  });

  test("sync --check distinguishes code-only changes from corpus-affecting changes", async () => {
    await runWithCapture([
      "init",
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
    await runWithCapture([
      "build",
      "--cwd",
      workspace.rootDir,
      "--config",
      workspace.configPath,
    ]);

    await mkdir(join(workspace.originPath, "packages", "auth", "src"), {
      recursive: true,
    });
    await writeFile(
      join(workspace.originPath, "packages", "auth", "src", "index.ts"),
      "export const value = 1;\n",
    );
    await git(workspace.originPath, ["add", "."]);
    await git(workspace.originPath, ["commit", "-m", "code only"]);

    const codeOnly = await runWithCapture([
      "sync",
      "--repo",
      "github.mycorp.com/platform/docs",
      "--check",
      "--cwd",
      workspace.rootDir,
      "--config",
      workspace.configPath,
      "--json",
    ]);
    expect(codeOnly.exitCode).toBe(0);
    expect(JSON.parse(codeOnly.stdout)).toMatchObject({
      ok: true,
      command: "sync",
      data: expect.objectContaining({
        sourceChanged: true,
        corpusAffected: false,
        corpusImpact: "none",
      }),
    });

    await writeFile(
      join(workspace.originPath, "packages", "auth", "docs", "api.md"),
      "# API\n\nCheck mode doc update.\n",
    );
    await git(workspace.originPath, ["add", "."]);
    await git(workspace.originPath, ["commit", "-m", "doc update"]);

    const docsChanged = await runWithCapture([
      "sync",
      "--repo",
      "github.mycorp.com/platform/docs",
      "--check",
      "--cwd",
      workspace.rootDir,
      "--config",
      workspace.configPath,
      "--json",
    ]);
    expect(docsChanged.exitCode).toBe(1);
    expect(JSON.parse(docsChanged.stdout)).toMatchObject({
      ok: true,
      command: "sync",
      data: expect.objectContaining({
        sourceChanged: true,
        corpusAffected: true,
        corpusImpact: "docs",
      }),
    });

    const docsStillChanged = await runWithCapture([
      "sync",
      "--repo",
      "github.mycorp.com/platform/docs",
      "--check",
      "--cwd",
      workspace.rootDir,
      "--config",
      workspace.configPath,
      "--json",
    ]);
    expect(docsStillChanged.exitCode).toBe(1);
    expect(JSON.parse(docsStillChanged.stdout)).toMatchObject({
      ok: true,
      command: "sync",
      data: expect.objectContaining({
        sourceChanged: false,
        corpusAffected: true,
        corpusImpact: "docs",
      }),
    });
  });
});
