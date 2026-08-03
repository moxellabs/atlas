import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { Database } from "bun:sqlite";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { loadConfig } from "@atlas/config";
import { validateArtifactChecksums } from "@atlas/indexer";
import {
  artifactFixtureFetch,
  createCliArtifactFixture,
  createConsumerUxWorkspace,
  missingArtifactConfig,
  writeConsumerUxArtifact,
} from "./cli.artifact-test-helpers";
import {
  createCliTestWorkspace,
  createOriginRepo,
  exists,
  expectNoGitMutationCommands,
  git,
  gitOutput,
  removeCliTestWorkspace,
  runWithCapture,
  type CliTestWorkspace,
} from "./cli.test-helpers";

describe("atlas CLI artifacts", () => {
  let workspace: CliTestWorkspace;

  beforeEach(async () => {
    workspace = await createCliTestWorkspace();
  });

  afterEach(async () => {
    await removeCliTestWorkspace(workspace);
  });

  test("interactive missing artifact never falls back to legacy numbered prompt", async () => {
    const cfg = join(workspace.rootDir, "missing-interactive.config.yaml");
    await writeFile(
      cfg,
      missingArtifactConfig("https://github.mycorp.com/api/v3"),
    );
    const originalFetch = globalThis.fetch;
    globalThis.fetch = (async () =>
      new Response("not found", { status: 404 })) as unknown as typeof fetch;
    try {
      const result = await runWithCapture([
        "add-repo",
        "moxellabs/atlas",
        "--cwd",
        workspace.rootDir,
        "--config",
        cfg,
        "--cache-dir",
        workspace.cacheDir,
        "--host",
        "github.mycorp.com",
        "--template",
        "mixed-monorepo",
        "-i",
      ]);

      expect(result.exitCode).toBe(2);
      expect(`${result.stdout}\n${result.stderr}`).not.toContain(
        "Select [1-4]:",
      );
      expect(`${result.stdout}\n${result.stderr}`).not.toContain(
        "1. Build a local index",
      );
      expect(result.stderr).toContain(
        "Missing artifact requires an explicit action",
      );
    } finally {
      globalThis.fetch = originalFetch;
    }
  });

  test("missing artifact JSON default returns skip without repo metadata", async () => {
    const cfg = join(workspace.rootDir, "missing.config.yaml");
    await writeFile(
      cfg,
      missingArtifactConfig("https://github.mycorp.com/api/v3"),
    );
    const originalFetch = globalThis.fetch;
    globalThis.fetch = (async () =>
      new Response("not found", { status: 404 })) as unknown as typeof fetch;
    try {
      const result = await runWithCapture([
        "add-repo",
        "moxellabs/atlas",
        "--cwd",
        workspace.rootDir,
        "--config",
        cfg,
        "--config",
        workspace.configPath,
        "--cache-dir",
        workspace.cacheDir,
        "--host",
        "github.mycorp.com",
        "--template",
        "mixed-monorepo",
        "--non-interactive",
        "--json",
      ]);
      expect(result.exitCode).toBe(0);
      const parsed = JSON.parse(result.stdout);
      expect(parsed.data).toMatchObject({
        missingArtifact: true,
        selectedAction: "skip",
        repoId: "github.mycorp.com/moxellabs/atlas",
      });
      expect(parsed.data.nextActions).toContain("clone-and-index-local-only");
      expect(
        await exists(
          join(
            workspace.cacheDir,
            "repos",
            "github.mycorp.com",
            "moxellabs",
            "atlas",
            "repo.json",
          ),
        ),
      ).toBe(false);
    } finally {
      globalThis.fetch = originalFetch;
    }
  });

  test("repo add skip leaves repo untracked and later manual index imports it", async () => {
    await writeFile(
      join(workspace.originPath, "docs", "deep-dive.md"),
      `# Deep Dive\n\n${"Manual local-only indexing imports cloned documentation. ".repeat(80)}`,
    );
    await git(workspace.originPath, ["add", "docs/deep-dive.md"]);
    await git(workspace.originPath, ["commit", "-m", "add deep docs"]);

    const cfg = join(workspace.rootDir, "manual-index.config.yaml");
    await writeFile(
      cfg,
      `
version: 1
cacheDir: ${workspace.cacheDir}
corpusDbPath: ${join(workspace.cacheDir, "corpus.db")}
logLevel: info
server:
  transport: stdio
hosts:
  - name: github.com
    webUrl: https://github.com
    apiUrl: https://api.github.com
    protocol: https
    default: true
    priority: 100
repos: []
`,
    );
    const gitRewriteEnv = {
      GIT_CONFIG_COUNT: "1",
      GIT_CONFIG_KEY_0: "url.file://" + workspace.originPath + ".insteadOf",
      GIT_CONFIG_VALUE_0: "https://github.com/moxellabs/atlas.git",
    };
    const originalGitConfigCount = process.env.GIT_CONFIG_COUNT;
    const originalGitConfigKey0 = process.env.GIT_CONFIG_KEY_0;
    const originalGitConfigValue0 = process.env.GIT_CONFIG_VALUE_0;
    process.env.GIT_CONFIG_COUNT = gitRewriteEnv.GIT_CONFIG_COUNT;
    process.env.GIT_CONFIG_KEY_0 = gitRewriteEnv.GIT_CONFIG_KEY_0;
    process.env.GIT_CONFIG_VALUE_0 = gitRewriteEnv.GIT_CONFIG_VALUE_0;
    const originalFetch = globalThis.fetch;
    globalThis.fetch = (async () =>
      new Response("not found", { status: 404 })) as unknown as typeof fetch;
    try {
      const add = await runWithCapture(
        [
          "repo",
          "add",
          "moxellabs/atlas",
          "--cwd",
          workspace.rootDir,
          "--config",
          cfg,
          "--skip-missing-artifact",
          "--non-interactive",
          "--json",
        ],
        gitRewriteEnv,
      );
      expect(add.exitCode).toBe(0);
      expect(JSON.parse(add.stdout).data).toMatchObject({
        missingArtifact: true,
        selectedAction: "skip",
        repoId: "github.com/moxellabs/atlas",
      });
      expect(
        (await loadConfig({ cwd: workspace.rootDir, configPath: cfg })).config
          .repos,
      ).toEqual([]);

      const indexed = await runWithCapture(
        [
          "index",
          "moxellabs/atlas",
          "--cwd",
          workspace.rootDir,
          "--config",
          cfg,
          "--ref",
          "main",
          "--non-interactive",
          "--json",
        ],
        gitRewriteEnv,
      );
      expect(indexed.exitCode).toBe(0);
      const indexedJson = JSON.parse(indexed.stdout);
      expect(indexedJson.data).toMatchObject({
        repoId: "github.com/moxellabs/atlas",
        imported: true,
      });
      expect(indexedJson.data.counts.docs).toBeGreaterThan(0);

      const globalDb = new Database(join(workspace.cacheDir, "corpus.db"), {
        readonly: true,
      });
      try {
        expect(
          globalDb
            .query(
              "SELECT COUNT(*) AS count FROM documents WHERE repo_id = ? AND path = ?",
            )
            .get("github.com/moxellabs/atlas", "docs/deep-dive.md") as {
            count: number;
          },
        ).toMatchObject({ count: 1 });
      } finally {
        globalDb.close();
      }
    } finally {
      globalThis.fetch = originalFetch;
      if (originalGitConfigCount === undefined)
        delete process.env.GIT_CONFIG_COUNT;
      else process.env.GIT_CONFIG_COUNT = originalGitConfigCount;
      if (originalGitConfigKey0 === undefined)
        delete process.env.GIT_CONFIG_KEY_0;
      else process.env.GIT_CONFIG_KEY_0 = originalGitConfigKey0;
      if (originalGitConfigValue0 === undefined)
        delete process.env.GIT_CONFIG_VALUE_0;
      else process.env.GIT_CONFIG_VALUE_0 = originalGitConfigValue0;
    }
  });

  test("missing artifact local-only and maintainer instructions render safe handoffs", async () => {
    const cfg = join(workspace.rootDir, "missing-local.config.yaml");
    await writeFile(
      cfg,
      missingArtifactConfig("https://github.mycorp.com/api/v3"),
    );
    const originalFetch = globalThis.fetch;
    globalThis.fetch = (async () =>
      new Response("not found", { status: 404 })) as unknown as typeof fetch;
    try {
      const localOnly = await runWithCapture([
        "add-repo",
        "moxellabs/atlas",
        "--cwd",
        workspace.rootDir,
        "--config",
        cfg,
        "--cache-dir",
        workspace.cacheDir,
        "--host",
        "github.mycorp.com",
        "--template",
        "mixed-monorepo",
        "--local-only",
      ]);
      expect(localOnly.stdout).toContain(
        "This repo doesn't publish an Atlas knowledge bundle yet.",
      );
      expect(localOnly.stdout).toContain("atlas index");
      const maintainer = await runWithCapture([
        "add-repo",
        "moxellabs/atlas",
        "--cwd",
        workspace.rootDir,
        "--config",
        cfg,
        "--cache-dir",
        workspace.cacheDir,
        "--host",
        "github.mycorp.com",
        "--template",
        "mixed-monorepo",
        "--maintainer-instructions",
      ]);
      expect(maintainer.stdout).toContain("## Optional maintainer steps");
      expect(maintainer.stdout).toContain("git add .moxel/atlas");
      expect(maintainer.stdout).toContain(
        "This is a request from a user of this repository, not an automated Atlas action.",
      );
      expect(maintainer.stdout).toContain(
        "Atlas does not branch, commit, push, create issues, or create PRs.",
      );
    } finally {
      globalThis.fetch = originalFetch;
    }
  });

  test("missing artifact adoption template JSON includes issue and PR text", async () => {
    const cfg = join(workspace.rootDir, "missing-json-template.config.yaml");
    await writeFile(
      cfg,
      missingArtifactConfig("https://github.mycorp.com/api/v3"),
    );
    const originalFetch = globalThis.fetch;
    globalThis.fetch = (async () =>
      new Response("not found", { status: 404 })) as unknown as typeof fetch;
    try {
      const result = await runWithCapture([
        "add-repo",
        "moxellabs/atlas",
        "--cwd",
        workspace.rootDir,
        "--config",
        cfg,
        "--cache-dir",
        workspace.cacheDir,
        "--host",
        "github.mycorp.com",
        "--template",
        "mixed-monorepo",
        "--issue-pr-instructions",
        "--json",
      ]);
      const parsed = JSON.parse(result.stdout);
      expect(parsed.data).toMatchObject({
        missingArtifact: true,
        selectedAction: "generate-issue-pr-instructions",
        repoId: "github.mycorp.com/moxellabs/atlas",
      });
      expect(parsed.data.adoptionTemplates.issueTemplate).toContain(
        "manifest.json",
      );
      expect(parsed.data.adoptionTemplates.prTemplate).toContain(
        "docs.index.json",
      );
      expect(parsed.data.adoptionTemplates.commands).toContain(
        "git add .moxel/atlas",
      );
      expect(
        await exists(
          join(
            workspace.cacheDir,
            "repos",
            "github.mycorp.com",
            "moxellabs",
            "atlas",
            "repo.json",
          ),
        ),
      ).toBe(false);
    } finally {
      globalThis.fetch = originalFetch;
    }
  });

  test("artifact verify artifact inspect artifact freshness support human JSON and freshness", async () => {
    const head = await gitOutput(workspace.originPath, ["rev-parse", "HEAD"]);
    await createCliArtifactFixture(workspace.originPath, head);
    const verify = await runWithCapture([
      "artifact",
      "verify",
      "--cwd",
      workspace.originPath,
    ]);
    expect(verify.exitCode).toBe(0);
    expect(verify.stdout).toContain("Bundle verified:");
    const inspect = await runWithCapture([
      "artifact",
      "inspect",
      "--cwd",
      workspace.originPath,
      "--json",
    ]);
    expect(inspect.exitCode).toBe(0);
    expect(inspect.stdout).toContain('"docsIndex"');
    const fresh = await runWithCapture([
      "artifact",
      "verify",
      "--cwd",
      workspace.originPath,
      "--fresh",
      "--ref",
      head,
    ]);
    expect(fresh.exitCode).toBe(0);
    expect(fresh.stdout).toContain("fresh: true");
    const stale = await runWithCapture([
      "artifact",
      "verify",
      "--cwd",
      workspace.originPath,
      "--fresh",
      "--ref",
      "def456",
    ]);
    expect(stale.exitCode).not.toBe(0);
    expect(stale.stderr).toContain(
      "Artifact is stale; run atlas build and commit .moxel/atlas.",
    );
    const staleJson = await runWithCapture([
      "artifact",
      "verify",
      "--cwd",
      workspace.originPath,
      "--fresh",
      "--ref",
      "def456",
      "--json",
    ]);
    const staleJsonOutput = `${staleJson.stdout}\n${staleJson.stderr}`;
    expect(staleJsonOutput).toContain('"code": "CLI_ARTIFACT_VERIFY_FAILED"');
    expect(staleJsonOutput).toContain('"fresh": false');
  });

  test("public docs are static-site ready", async () => {
    const activePublicDocs = [
      "README.md",
      "docs/index.md",
      "docs/configuration.md",
      "docs/ingestion-build-flow.md",
      "docs/retrieval-and-context.md",
      "docs/runtime-surfaces.md",
      "docs/security.md",
      "docs/self-indexing.md",
      "apps/cli/docs/index.md",
      "apps/server/docs/index.md",
      "packages/compiler/docs/index.md",
      "packages/config/docs/index.md",
      "packages/core/docs/index.md",
      "packages/indexer/docs/index.md",
      "packages/mcp/docs/index.md",
      "packages/retrieval/docs/index.md",
      "packages/source-ghes/docs/index.md",
      "packages/source-git/docs/index.md",
      "packages/store/docs/index.md",
      "packages/testkit/docs/index.md",
      "packages/tokenizer/docs/index.md",
      "packages/topology/docs/index.md",
      "skills/document-codebase/SKILL.md",
      "skills/skill-creator/SKILL.md",
      "skills/atlas-contributor/SKILL.md",
    ];

    const docs = await Promise.all(
      activePublicDocs.map(async (path) => ({
        path,
        content: await readFile(path, "utf8"),
      })),
    );

    for (const { path, content } of docs) {
      expect(content.startsWith("---\n")).toBe(true);
      const frontmatter = content.slice(0, content.indexOf("\n---\n", 4));
      for (const required of [
        "title:",
        "description:",
        "audience:",
        "purpose:",
        "visibility: public",
      ])
        expect(frontmatter).toContain(required);
      if (!path.startsWith("skills/")) expect(frontmatter).toContain("order:");
    }

    const combined = docs.map(({ content }) => content).join("\n");
    for (const current of [
      "identity root",
      ".moxel/atlas",
      "~/.moxel/atlas",
      "public artifact",
      "profile",
      "audience",
      "purpose",
      "visibility",
    ])
      expect(combined).toContain(current);
    for (const stale of [
      "ATLAS_ARTIFACT_ROOT",
      "--artifact-root",
      "--moxellabs-atlas-artifact-root",
      "whiteLabel.artifactRoot",
      ".atlas/artifact",
      "artifact/.moxel/atlas",
    ])
      expect(combined).not.toContain(stale);
  });

  test("self-index public artifact includes active docs and excludes planning/archive", async () => {
    const selfRoot = join(workspace.rootDir, "self-index-atlas");
    await mkdir(join(selfRoot, "docs", "archive"), { recursive: true });
    await mkdir(join(selfRoot, ".planning"), { recursive: true });
    await mkdir(join(selfRoot, "skills", "document-codebase"), {
      recursive: true,
    });
    await mkdir(join(selfRoot, "apps", "cli", "docs"), { recursive: true });
    await mkdir(join(selfRoot, "packages", "indexer", "docs"), {
      recursive: true,
    });
    await writeFile(
      join(selfRoot, "package.json"),
      JSON.stringify({ name: "atlas", workspaces: ["apps/*", "packages/*"] }),
    );
    await writeFile(
      join(selfRoot, "README.md"),
      `---
title: Atlas
description: Public artifact overview.
audience: [consumer, contributor, maintainer]
purpose: [guide]
visibility: public
order: 1
---

# Atlas

Public artifact overview.
`,
    );
    await writeFile(
      join(selfRoot, "docs", "self-indexing.md"),
      `---
title: Self Indexing
description: Atlas self-indexing public artifact docs.
audience: [consumer, contributor, maintainer]
purpose: [workflow]
visibility: public
order: 70
---

# Self Indexing

Atlas self-indexing public artifact docs.
`,
    );
    await writeFile(join(selfRoot, "docs", "archive", "old.md"), "# Old\n");
    await writeFile(
      join(selfRoot, "docs", "architecture.md"),
      "# Architecture\n\nDefault consumer docs metadata.\n",
    );
    await writeFile(join(selfRoot, ".planning", "ROADMAP.md"), "# Roadmap\n");
    await writeFile(
      join(selfRoot, "skills", "document-codebase", "SKILL.md"),
      `---
name: document-codebase
description: Document codebases.
title: Document Codebase
visibility: public
audience: [contributor, maintainer]
purpose: [workflow]
order: 100
---

# Document Codebase

Use this skill to document codebases.
`,
    );
    await writeFile(
      join(selfRoot, "apps", "cli", "package.json"),
      JSON.stringify({ name: "@atlas/cli" }),
    );
    await writeFile(
      join(selfRoot, "apps", "cli", "README.md"),
      `---
title: CLI README
description: Contributor-facing app README.
audience: [contributor, maintainer]
purpose: [implementation]
visibility: public
---

# CLI README

Contributor-facing app README.
`,
    );
    await writeFile(
      join(selfRoot, "apps", "cli", "docs", "index.md"),
      `---
title: CLI Docs
description: App docs.
audience: [contributor, maintainer]
purpose: [implementation, reference]
visibility: public
order: 100
---

# CLI Docs

App docs.
`,
    );
    await writeFile(
      join(selfRoot, "packages", "indexer", "package.json"),
      JSON.stringify({ name: "@atlas/indexer" }),
    );
    await writeFile(
      join(selfRoot, "packages", "indexer", "docs", "index.md"),
      `---
title: Indexer Docs
description: Package docs.
audience: [contributor, maintainer]
purpose: [implementation, reference]
visibility: public
order: 230
---

# Indexer Docs

Package docs.
`,
    );
    await writeFile(
      join(selfRoot, "packages", "indexer", "docs", "internal.md"),
      `---
title: Internal Indexer Notes
description: Internal package docs must not ship in public artifacts.
audience: [internal]
purpose: [implementation]
visibility: internal
order: 231
---

# Internal Indexer Notes

Internal package docs.
`,
    );
    await git(selfRoot, ["init", "-b", "main"]);
    await git(selfRoot, ["config", "user.email", "atlas@example.test"]);
    await git(selfRoot, ["config", "user.name", "ATLAS Test"]);
    await git(selfRoot, ["add", "."]);
    await git(selfRoot, ["commit", "-m", "seed atlas docs"]);

    const init = await runWithCapture([
      "init",
      "--cwd",
      selfRoot,
      "--repo-id",
      "github.com/moxellabs/atlas",
      "--ref",
      "main",
      "--force",
    ]);
    expect(init.exitCode).toBe(0);
    const build = await runWithCapture([
      "build",
      "--cwd",
      selfRoot,
      "--profile",
      "public",
      "--json",
    ]);
    expect(build.exitCode).toBe(0);

    const artifactDir = join(selfRoot, ".moxel", "atlas");
    const docsIndex = JSON.parse(
      await readFile(join(artifactDir, "docs.index.json"), "utf8"),
    ) as {
      counts: {
        documents: number;
        skills: number;
        packages: number;
        modules: number;
      };
      documents: Array<{ path: string }>;
    };
    const paths = docsIndex.documents.map((doc) => doc.path);
    expect(docsIndex.counts).toEqual({
      documents: paths.length,
      skills: 0,
      packages: 0,
      modules: 0,
    });
    expect(paths).toContain("README.md");
    expect(paths).toContain("docs/self-indexing.md");
    expect(paths).toContain("docs/architecture.md");
    expect(paths).not.toContain("skills/document-codebase/SKILL.md");
    expect(paths).not.toContain("apps/cli/docs/index.md");
    expect(paths).not.toContain("packages/indexer/docs/index.md");
    expect(paths).not.toContain("apps/cli/README.md");
    expect(paths).not.toContain("packages/indexer/docs/internal.md");
    expect(paths).not.toContain(".planning/ROADMAP.md");
    expect(paths).not.toContain("docs/archive/old.md");
    const manifest = JSON.parse(
      await readFile(join(artifactDir, "manifest.json"), "utf8"),
    );
    expect(manifest.profiles).toMatchObject({
      default: "public",
      applied: "public",
      available: ["public"],
    });
    expect((await validateArtifactChecksums(artifactDir)).valid).toBe(true);

    const artifactDb = new Database(join(artifactDir, "corpus.db"), {
      readonly: true,
    });
    try {
      expect(
        artifactDb
          .query("SELECT COUNT(*) AS count FROM documents WHERE path = ?")
          .get(".planning/ROADMAP.md") as { count: number },
      ).toMatchObject({ count: 0 });
      expect(
        artifactDb
          .query("SELECT COUNT(*) AS count FROM documents WHERE path = ?")
          .get("docs/archive/old.md") as { count: number },
      ).toMatchObject({ count: 0 });
      expect(
        artifactDb
          .query("SELECT COUNT(*) AS count FROM documents WHERE path = ?")
          .get("skills/document-codebase/SKILL.md") as { count: number },
      ).toMatchObject({ count: 0 });
      expect(
        artifactDb
          .query("SELECT COUNT(*) AS count FROM documents WHERE path = ?")
          .get("apps/cli/docs/index.md") as { count: number },
      ).toMatchObject({ count: 0 });
      expect(
        artifactDb
          .query("SELECT COUNT(*) AS count FROM documents WHERE path = ?")
          .get("packages/indexer/docs/index.md") as { count: number },
      ).toMatchObject({ count: 0 });
      expect(
        artifactDb
          .query("SELECT COUNT(*) AS count FROM documents WHERE path = ?")
          .get("docs/architecture.md") as { count: number },
      ).toMatchObject({ count: 1 });
      expect(
        artifactDb
          .query("SELECT COUNT(*) AS count FROM documents WHERE path = ?")
          .get("apps/cli/README.md") as { count: number },
      ).toMatchObject({ count: 0 });
      expect(
        artifactDb
          .query("SELECT COUNT(*) AS count FROM documents WHERE path = ?")
          .get("packages/indexer/docs/internal.md") as { count: number },
      ).toMatchObject({ count: 0 });
      expect(
        artifactDb
          .query("SELECT COUNT(*) AS count FROM fts_entries WHERE path = ?")
          .get(".planning/ROADMAP.md") as { count: number },
      ).toMatchObject({ count: 0 });
    } finally {
      artifactDb.close();
    }

    const fresh = await runWithCapture([
      "artifact",
      "verify",
      "--cwd",
      selfRoot,
      "--fresh",
    ]);
    expect(fresh.exitCode).toBe(0);

    const contributorBuild = await runWithCapture([
      "build",
      "--cwd",
      selfRoot,
      "--profile",
      "contributor",
      "--json",
    ]);
    expect(contributorBuild.exitCode).toBe(0);
    const contributorDocsIndex = JSON.parse(
      await readFile(join(artifactDir, "docs.index.json"), "utf8"),
    ) as { documents: Array<{ path: string }> };
    const contributorPaths = contributorDocsIndex.documents.map(
      (doc) => doc.path,
    );
    expect(contributorPaths).toContain("README.md");
    expect(contributorPaths).toContain("docs/self-indexing.md");
    expect(contributorPaths).toContain("docs/architecture.md");
    expect(contributorPaths).toContain("skills/document-codebase/SKILL.md");
    expect(contributorPaths).toContain("apps/cli/docs/index.md");
    expect(contributorPaths).toContain("apps/cli/README.md");
    expect(contributorPaths).toContain("packages/indexer/docs/index.md");
    expect(contributorPaths).not.toContain("packages/indexer/docs/internal.md");
    const contributorManifest = JSON.parse(
      await readFile(join(artifactDir, "manifest.json"), "utf8"),
    );
    expect(contributorManifest.profiles).toMatchObject({
      default: "public",
      applied: "contributor",
      available: ["public", "contributor"],
    });
    const home = join(workspace.rootDir, "self-index-home");
    expect(
      (
        await runWithCapture(
          ["setup", "--cwd", workspace.rootDir, "--non-interactive"],
          {
            HOME: home,
          },
        )
      ).exitCode,
    ).toBe(0);
    expect(
      (
        await runWithCapture(
          [
            "add-repo",
            selfRoot,
            "--cwd",
            workspace.rootDir,
            "--non-interactive",
          ],
          { HOME: home },
        )
      ).exitCode,
    ).toBe(0);
    const search = await runWithCapture(
      ["search", "self-indexing", "--cwd", workspace.rootDir, "--json"],
      { HOME: home },
    );
    expect(search.exitCode).toBe(0);
    expect(search.stdout).toContain("docs/self-indexing.md");
    expect(search.stdout).not.toContain(".planning/");
    const searchJson = JSON.parse(search.stdout);
    expect(searchJson.data.filters).toMatchObject({ profile: "public" });
    expect(searchJson.data.profileDefaulted).toBe(true);

    const filteredSearch = await runWithCapture(
      [
        "search",
        "self-indexing",
        "--cwd",
        workspace.rootDir,
        "--audience",
        "consumer",
      ],
      { HOME: home },
    );
    expect(filteredSearch.exitCode).toBe(0);
    expect(filteredSearch.stdout).toContain(
      "Filters: profile=public (default)",
    );

    const contributorSearch = await runWithCapture(
      [
        "search",
        "CLI README",
        "--cwd",
        workspace.rootDir,
        "--profile",
        "contributor",
        "--json",
      ],
      { HOME: home },
    );
    expect(contributorSearch.exitCode).toBe(0);
    const contributorSearchJson = JSON.parse(contributorSearch.stdout);
    expect(contributorSearchJson.data.filters).toMatchObject({
      profile: "contributor",
    });
    expect(contributorSearch.stdout).toContain("apps/cli/README.md");

    const anyProfileSearch = await runWithCapture(
      [
        "search",
        "self-indexing",
        "--cwd",
        workspace.rootDir,
        "--profile",
        "any",
        "--json",
      ],
      { HOME: home },
    );
    expect(anyProfileSearch.exitCode).toBe(0);
    const anyProfileJson = JSON.parse(anyProfileSearch.stdout);
    expect(anyProfileJson.data.filters.profile).toBeUndefined();
    expect(anyProfileJson.data.allProfiles).toBe(true);
  }, 30_000);

  test("identity root init build verify inspect migration and validation", async () => {
    const init = await runWithCapture([
      "init",
      "--cwd",
      workspace.originPath,
      "--atlas-identity-root",
      ".acme/knowledge",
      "--repo-id",
      "github.com/acme/docs",
    ]);
    expect(init.exitCode).toBe(0);
    expect(init.stdout).toContain("Knowledge bundle: .acme/knowledge");
    expect(
      await exists(
        join(workspace.originPath, ".acme", "knowledge", "atlas.repo.json"),
      ),
    ).toBe(true);
    expect(await exists(join(workspace.originPath, ".moxel", "atlas"))).toBe(
      false,
    );

    const initJson = await runWithCapture([
      "init",
      "--cwd",
      workspace.originPath,
      "--atlas-identity-root",
      ".alias/knowledge",
      "--repo-id",
      "github.com/acme/docs",
      "--force",
      "--json",
    ]);
    expect(JSON.parse(initJson.stdout).data.artifactRoot).toBe(
      ".alias/knowledge",
    );

    const build = await runWithCapture([
      "build",
      "--cwd",
      workspace.originPath,
      "--atlas-identity-root",
      ".acme/knowledge",
      "--force",
    ]);
    expect(build.exitCode).toBe(0);
    for (const file of [
      "manifest.json",
      "corpus.db",
      "checksums.json",
      "docs.index.json",
    ]) {
      expect(
        await exists(join(workspace.originPath, ".acme", "knowledge", file)),
      ).toBe(true);
    }

    const head = await gitOutput(workspace.originPath, ["rev-parse", "HEAD"]);
    await createCliArtifactFixture(
      workspace.originPath,
      head,
      join(".acme", "knowledge"),
    );
    const verify = await runWithCapture([
      "artifact",
      "verify",
      "--cwd",
      workspace.originPath,
      "--atlas-identity-root",
      ".acme/knowledge",
    ]);
    expect(verify.exitCode).toBe(0);
    expect(verify.stdout).toContain("Knowledge bundle: .acme/knowledge");

    const inspect = await runWithCapture([
      "artifact",
      "inspect",
      "--cwd",
      workspace.originPath,
      "--atlas-identity-root",
      ".acme/knowledge",
      "--json",
    ]);
    expect(inspect.exitCode).toBe(0);
    expect(JSON.parse(inspect.stdout).data.artifactRoot).toBe(
      ".acme/knowledge",
    );

    const envRoot = await runWithCapture(
      [
        "init",
        "--cwd",
        workspace.originPath,
        "--repo-id",
        "github.com/acme/docs",
        "--force",
      ],
      { ATLAS_IDENTITY_ROOT: ".env/knowledge" },
    );
    expect(envRoot.stdout).toContain("Knowledge bundle: .env/knowledge");

    await writeFile(
      join(workspace.originPath, "atlas.config.yaml"),
      `version: 1\ncacheDir: .cache\nlogLevel: warn\nserver:\n  transport: stdio\nidentity:\n  root: .config/knowledge\nrepos: []\n`,
    );
    const configRoot = await runWithCapture([
      "init",
      "--cwd",
      workspace.originPath,
      "--repo-id",
      "github.com/acme/docs",
      "--force",
    ]);
    expect(configRoot.stdout).toContain("Knowledge bundle: .config/knowledge");

    const invalid = await runWithCapture([
      "init",
      "--cwd",
      workspace.originPath,
      "--atlas-identity-root",
      "../secret",
      "--repo-id",
      "github.com/acme/docs",
    ]);
    expect(invalid.exitCode).not.toBe(0);
    expect(invalid.stderr).toContain(
      "identity root must be relative and cannot contain traversal",
    );

    const migrationRoot = await mkdtemp(
      join(tmpdir(), "atlas-migration-root-"),
    );
    try {
      await createOriginRepo(migrationRoot);
      await mkdir(join(migrationRoot, ".moxel", "atlas"), { recursive: true });
      const missing = await runWithCapture([
        "artifact",
        "verify",
        "--cwd",
        migrationRoot,
        "--atlas-identity-root",
        ".acme/knowledge",
      ]);
      expect(missing.exitCode).not.toBe(0);
      expect(missing.stderr).toContain(".moxel/atlas exists");
      expect(missing.stderr).toContain("no migration");
      expect(missing.stderr).toContain("no fallback");
    } finally {
      await rm(migrationRoot, { recursive: true, force: true });
    }
  });

  test("add-repo mirrors artifacts directly under identity root in repo storage", async () => {
    const head = await gitOutput(workspace.originPath, ["rev-parse", "HEAD"]);
    await createCliArtifactFixture(workspace.originPath, head);
    await git(workspace.originPath, [
      "remote",
      "add",
      "origin",
      "https://github.com/moxellabs/atlas.git",
    ]);
    await runWithCapture([
      "setup",
      "--cwd",
      workspace.rootDir,
      "--cache-dir",
      workspace.cacheDir,
      "--non-interactive",
    ]);
    const originalFetch = globalThis.fetch;
    globalThis.fetch = artifactFixtureFetch(
      workspace.originPath,
      ".moxel/atlas",
    );
    try {
      const added = await runWithCapture([
        "add-repo",
        workspace.originPath,
        "--cwd",
        workspace.rootDir,
        "--cache-dir",
        workspace.cacheDir,
        "--non-interactive",
        "--json",
        "--repo-id",
        "github.com/moxellabs/atlas",
        "--mode",
        "local-git",
        "--remote",
        "https://github.com/moxellabs/atlas.git",
        "--host",
        "github.com",
        "--base-url",
        "https://github.com/api/v3",
        "--owner",
        "moxellabs",
        "--name",
        "atlas",
        "--ref",
        head,
        "--template",
        "mixed-monorepo",
      ]);
      expect([0, 2]).toContain(added.exitCode);
      const mirrorRoot = join(
        workspace.cacheDir,
        "repos",
        "github.com",
        "moxellabs",
        "atlas",
        ".moxel",
        "atlas",
      );
      expect(await exists(join(mirrorRoot, "manifest.json"))).toBe(true);
      expect(
        await exists(
          join(
            workspace.cacheDir,
            "repos",
            "github.com",
            "moxellabs",
            "atlas",
            ".atlas",
            "artifact",
            "manifest.json",
          ),
        ),
      ).toBe(false);
      expect(
        await exists(
          join(
            workspace.cacheDir,
            "repos",
            "github.com",
            "moxellabs",
            "atlas",
            "artifact",
            ".moxel",
            "atlas",
            "manifest.json",
          ),
        ),
      ).toBe(false);
    } finally {
      globalThis.fetch = originalFetch;
    }
  });

  test("add-repo custom identity mirrors artifact root without default fallback", async () => {
    const head = await gitOutput(workspace.originPath, ["rev-parse", "HEAD"]);
    await createCliArtifactFixture(
      workspace.originPath,
      head,
      join(".acme", "knowledge"),
    );
    await createCliArtifactFixture(workspace.originPath, head);
    await rm(join(workspace.originPath, ".moxel", "atlas"), {
      recursive: true,
      force: true,
    });
    await git(workspace.originPath, [
      "remote",
      "add",
      "origin",
      "https://github.com/moxellabs/atlas.git",
    ]);
    const customCacheDir = join(workspace.rootDir, ".acme", "knowledge");
    const customConfigPath = join(
      workspace.rootDir,
      "home",
      ".acme",
      "knowledge",
      "config.yaml",
    );
    await runWithCapture([
      "setup",
      "--cwd",
      workspace.rootDir,
      "--cache-dir",
      customCacheDir,
      "--atlas-identity-root",
      ".acme/knowledge",
      "--non-interactive",
    ]);
    const originalFetch = globalThis.fetch;
    globalThis.fetch = artifactFixtureFetch(
      workspace.originPath,
      ".acme/knowledge",
    );
    try {
      const added = await runWithCapture([
        "add-repo",
        workspace.originPath,
        "--cwd",
        workspace.rootDir,
        "--config",
        customConfigPath,
        "--cache-dir",
        customCacheDir,
        "--atlas-identity-root",
        ".acme/knowledge",
        "--non-interactive",
        "--json",
        "--repo-id",
        "github.com/moxellabs/atlas",
        "--mode",
        "local-git",
        "--remote",
        "https://github.com/moxellabs/atlas.git",
        "--host",
        "github.com",
        "--base-url",
        "https://github.com/api/v3",
        "--owner",
        "moxellabs",
        "--name",
        "atlas",
        "--ref",
        head,
        "--template",
        "mixed-monorepo",
      ]);
      expect([0, 2]).toContain(added.exitCode);
      const mirrorRoot = join(
        customCacheDir,
        "repos",
        "github.com",
        "moxellabs",
        "atlas",
        ".acme",
        "knowledge",
      );
      expect(await exists(join(mirrorRoot, "manifest.json"))).toBe(true);
      expect(
        await exists(
          join(
            customCacheDir,
            "repos",
            "github.com",
            "moxellabs",
            "atlas",
            ".atlas",
            "artifact",
            "manifest.json",
          ),
        ),
      ).toBe(false);
      expect(
        await exists(
          join(
            customCacheDir,
            "repos",
            "github.com",
            "moxellabs",
            "atlas",
            "artifact",
            ".acme",
            "knowledge",
            "manifest.json",
          ),
        ),
      ).toBe(false);
    } finally {
      globalThis.fetch = originalFetch;
    }
  });

  test("artifact verification documentation guards freshness and boundaries", async () => {
    const docs = await Promise.all(
      [
        "README.md",
        "docs/ingestion-build-flow.md",
        "docs/security.md",
        "docs/runtime-surfaces.md",
        "apps/cli/docs/index.md",
      ].map((path) => readFile(path, "utf8")),
    );
    const combined = docs.join("\n");
    for (const required of [
      "atlas artifact verify --fresh",
      "atlas artifact inspect",
      "Artifact is stale; run atlas build and commit .moxel/atlas.",
      "Maintainers control branch names, commit messages, hooks, PR templates, and permissions.",
      "Atlas does not branch, commit, push, create issues, or create PRs.",
    ])
      expect(combined).toContain(required);
    for (const forbidden of [
      "git push --force",
      "--no-verify",
      "disable branch protection",
      "skip required reviews",
      "automatically create pull request",
      "automatically create issue",
    ])
      expect(combined).not.toContain(forbidden);
  });

  test("consumer UX help docs mention clean-break workflows", async () => {
    const help = await runWithCapture(["--help"]);
    expect(help.exitCode).toBe(0);
    for (const required of [
      "~/.moxel/atlas",
      ".moxel/atlas",
      "hosts",
      "repo add",
      "index",
      "search",
      "repo",
      "artifact",
      "mcp",
      "GitHub/GHES hosts",
      "local imported corpus",
    ])
      expect(help.stdout).toContain(required);

    const artifactHelp = await runWithCapture(["artifact"]);
    expect(artifactHelp.stdout).toContain(
      "Verify and inspect Atlas knowledge bundles",
    );

    const docs = await Promise.all(
      [
        "README.md",
        "docs/ingestion-build-flow.md",
        "docs/configuration.md",
        "apps/cli/docs/index.md",
      ].map((path) => readFile(path, "utf8")),
    );
    const combined = docs.join("\n");
    for (const required of [
      "Consumer repo consumption workflow",
      "Maintainer artifact publishing workflow",
      "Enterprise host setup and troubleshooting",
      "Artifact is stale; importing anyway.",
      "Use --host <host> or a full SSH/HTTPS URL",
      "do not fetch remote source at query time",
    ])
      expect(combined).toContain(required);
  });

  test("consumer UX local artifact fixture helper creates artifact files", async () => {
    const consumerWorkspace = await createConsumerUxWorkspace(
      workspace.rootDir,
    );
    await writeConsumerUxArtifact(
      consumerWorkspace.repoPath,
      "consumer-revision",
    );
    for (const file of [
      "manifest.json",
      "corpus.db",
      "checksums.json",
      "docs.index.json",
    ])
      expect(
        await exists(join(consumerWorkspace.repoPath, ".moxel", "atlas", file)),
      ).toBe(true);
    expectNoGitMutationCommands([
      "atlas setup",
      "atlas add-repo platform/docs",
      "atlas search deployment",
    ]);
  });
});
