import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  type ResolvedAtlasConfig,
  DEFAULT_REPOSITORY_REFRESH_INTERVAL_MS,
  resolveRuntimeRepoConfigs,
} from "@atlas/config";
import { createDocId, createModuleId, createPackageId } from "@atlas/core";
import { type AtlasStoreClient, openStore } from "@atlas/store";

export const repoId = "atlas";
export const packageId = createPackageId({ repoId, path: "packages/auth" });
export const moduleId = createModuleId({ repoId, path: "Auth" });
export const repoDocId = createDocId({ repoId, path: "docs/index.md" });
export const packageDocId = createDocId({
  repoId,
  path: "packages/auth/docs/api.md",
});
export const moduleDocId = createDocId({
  repoId,
  path: "Auth/docs/overview.md",
});
export const skillDocId = createDocId({
  repoId,
  path: "Auth/docs/auth-skill/skill.md",
});

export interface IndexerTestFixture {
  fixtureDir: string;
  originPath: string;
  localPath: string;
  store: AtlasStoreClient;
}

export async function createIndexerTestFixture(): Promise<IndexerTestFixture> {
  const fixtureDir = await mkdtemp(join(tmpdir(), "atlas-indexer-test-"));
  const originPath = join(fixtureDir, "origin");
  const localPath = join(fixtureDir, "cache", repoId);
  const dbPath = join(fixtureDir, "atlas.db");

  await mkdir(join(fixtureDir, "cache"), { recursive: true });
  await createOriginRepo(originPath);
  return {
    fixtureDir,
    originPath,
    localPath,
    store: openStore({ path: dbPath, migrate: true }),
  };
}

export async function disposeIndexerTestFixture(
  fixture: IndexerTestFixture,
): Promise<void> {
  fixture.store.close();
  await rm(fixture.fixtureDir, { recursive: true, force: true });
}

async function createOriginRepo(originPath: string): Promise<void> {
  await mkdir(join(originPath, "docs"), { recursive: true });
  await mkdir(join(originPath, "packages", "auth", "docs"), {
    recursive: true,
  });
  await mkdir(join(originPath, "Auth", "docs", "auth-skill"), {
    recursive: true,
  });
  await git(originPath, ["init", "-b", "main"]);
  await git(originPath, ["config", "user.email", "atlas@example.test"]);
  await git(originPath, ["config", "user.name", "ATLAS Test"]);
  await writeFile(
    join(originPath, "docs", "index.md"),
    "# Index\n\nRepository docs.\n",
  );
  await writeFile(
    join(originPath, "packages", "auth", "package.json"),
    JSON.stringify({ name: "@atlas/auth" }, null, 2),
  );
  await writeFile(
    join(originPath, "packages", "auth", "docs", "api.md"),
    "# API\n\nPackage documentation.\n",
  );
  await writeFile(
    join(originPath, "Auth", "docs", "overview.md"),
    "# Overview\n\nModule documentation.\n",
  );
  await writeFile(
    join(originPath, "Auth", "docs", "auth-skill", "skill.md"),
    "---\ntopics: auth, login\naliases:\n  - auth helper\n  - login helper\n---\n# Auth Skill\n\nUse this skill to answer authentication questions.\n",
  );
  await mkdir(join(originPath, "Auth", "docs", "auth-skill", "scripts"), {
    recursive: true,
  });
  await mkdir(join(originPath, "Auth", "docs", "auth-skill", "references"), {
    recursive: true,
  });
  await mkdir(join(originPath, "Auth", "docs", "auth-skill", "agents"), {
    recursive: true,
  });
  await writeFile(
    join(originPath, "Auth", "docs", "auth-skill", "scripts", "check.py"),
    "print('auth')\n",
  );
  await writeFile(
    join(originPath, "Auth", "docs", "auth-skill", "references", "auth.txt"),
    "Auth reference\n",
  );
  await writeFile(
    join(originPath, "Auth", "docs", "auth-skill", "agents", "openai.yaml"),
    "interface:\n  display_name: Auth\n",
  );
  await git(originPath, ["add", "."]);
  await git(originPath, ["commit", "-m", "initial"]);
}

export async function git(cwd: string, args: string[]): Promise<void> {
  const result = Bun.spawn(["git", ...args], {
    cwd,
    stdout: "pipe",
    stderr: "pipe",
  });
  const exitCode = await result.exited;
  if (exitCode !== 0) {
    const stderr = await readStream(result.stderr);
    throw new Error(
      `git ${args.join(" ")} failed with code ${exitCode}: ${stderr}`,
    );
  }
}

export async function gitOutput(cwd: string, args: string[]): Promise<string> {
  const result = Bun.spawn(["git", ...args], {
    cwd,
    stdout: "pipe",
    stderr: "pipe",
  });
  const exitCode = await result.exited;
  if (exitCode !== 0) {
    const stderr = await readStream(result.stderr);
    throw new Error(
      `git ${args.join(" ")} failed with code ${exitCode}: ${stderr}`,
    );
  }
  return (await readStream(result.stdout)).trim();
}

async function readStream(
  stream: ReadableStream<Uint8Array> | null,
): Promise<string> {
  if (stream === null) {
    return "";
  }
  return await new Response(stream).text();
}

export function createTestResolvedConfig(
  fixture: Pick<IndexerTestFixture, "originPath" | "localPath">,
  options: { includeGhesRepo?: boolean | undefined } = {},
): ResolvedAtlasConfig {
  const configPath = join(fixture.localPath, "..", "atlas.config.json");
  const config: ResolvedAtlasConfig["config"] = {
    version: 1,
    cacheDir: join(fixture.localPath, ".."),
    corpusDbPath: join(fixture.localPath, "..", "atlas.db"),
    logLevel: "info",
    server: { transport: "http", host: "127.0.0.1", port: 3000 },
    lifecycle: {
      repositoryRefresh: {
        enabled: false,
        intervalMs: DEFAULT_REPOSITORY_REFRESH_INTERVAL_MS,
      },
    },
    hosts: [
      {
        name: "github.com",
        webUrl: "https://github.com",
        apiUrl: "https://api.github.com",
        protocol: "ssh",
        priority: 100,
        default: true,
      },
    ],
    docs: { metadata: { rules: [], profiles: {} } },
    repos: [
      {
        repoId,
        mode: "local-git",
        git: {
          remote: `file://${fixture.originPath}`,
          localPath: fixture.localPath,
          ref: "main",
          refMode: "remote",
        },
        workspace: {
          packageGlobs: ["packages/*"],
          packageManifestFiles: ["package.json"],
        },
        topology: defaultTopology(),
      },
      ...(options.includeGhesRepo
        ? [
            {
              repoId: "atlas-ghes",
              mode: "ghes-api" as const,
              github: {
                baseUrl: "https://ghes.example.test/api/v3",
                owner: "moxellabs",
                name: "atlas",
                ref: "main",
                tokenEnvVar: "ATLAS_GHES_TOKEN",
              },
              workspace: {
                packageGlobs: ["packages/*"],
                packageManifestFiles: ["package.json"],
              },
              topology: defaultTopology(),
            },
          ]
        : []),
    ],
  };
  return {
    config,
    runtimeRepos: resolveRuntimeRepoConfigs(config, configPath),
    source: {
      configPath,
      loadedFrom: "explicit",
    },
    env: {},
    ...(options.includeGhesRepo
      ? {
          ghesAuth: {
            "atlas-ghes": {
              kind: "token" as const,
              source: "env" as const,
              sourceName: "ATLAS_GHES_TOKEN",
              token: "test-token",
            },
          },
        }
      : {}),
  };
}

function defaultTopology() {
  return [
    {
      id: "repo-docs",
      kind: "repo-doc" as const,
      match: { include: ["docs/**/*.md"] },
      ownership: { attachTo: "repo" as const },
      authority: "canonical" as const,
      priority: 10,
    },
    {
      id: "package-docs",
      kind: "package-doc" as const,
      match: { include: ["packages/*/docs/**/*.md"] },
      ownership: { attachTo: "package" as const },
      authority: "preferred" as const,
      priority: 20,
    },
    {
      id: "module-docs",
      kind: "module-doc" as const,
      match: { include: ["*/docs/**/*.md"], exclude: ["*/docs/**/skill.md"] },
      ownership: {
        attachTo: "module" as const,
        moduleRootPattern: "*/docs/**/*.md",
      },
      authority: "preferred" as const,
      priority: 30,
    },
    {
      id: "skills",
      kind: "skill-doc" as const,
      match: { include: ["**/skill.md"] },
      ownership: { attachTo: "skill" as const, skillPattern: "**/skill.md" },
      authority: "canonical" as const,
      priority: 40,
    },
  ];
}
