import { mkdir } from "node:fs/promises";
import {
  type AtlasConfig,
  type AtlasRepoConfig,
  buildDefaultConfig,
  buildDefaultCorpusDbPath,
  canonicalizeRepoId,
  DEFAULT_MOXEL_ATLAS_REPOS_RELATIVE_PATH,
} from "@atlas/config";
import { canPrompt, createPrompts, type CliPrompts } from "../io/prompts";
import { mutateAtlasConfig, repoCheckoutDir } from "../runtime/dependencies";
import type { CliCommandContext } from "../runtime/types";
import { CliError, EXIT_INPUT_ERROR } from "../utils/errors";
import { parentDir, resolveCliPath } from "../utils/paths";
import {
  type TopologyTemplate,
  topologyTemplate,
} from "../utils/topology-templates";
import { detectLocalGitDefaults, type LocalGitDefaults } from "./git";
import {
  createRepoMetadata,
  repoMetadataPath,
  writeRepoMetadata,
} from "./repo-metadata";
/** Returns a default config object for `atlas init`. */
export function defaultCliConfig(cacheDir?: string): AtlasConfig {
  const config = buildDefaultConfig(cacheDir);
  return {
    ...config,
    corpusDbPath: buildDefaultCorpusDbPath(config.cacheDir),
  };
}

type RepoConfigMode = "local-git" | "ghes-api";
type RepoConfigPrompts = CliPrompts | undefined;

interface RepoConfigInput {
  repoId?: string | undefined;
  mode?: RepoConfigMode | undefined;
  remote?: string | undefined;
  localPath?: string | undefined;
  ref?: string | undefined;
  refMode?: "remote" | "current-checkout" | undefined;
  baseUrl?: string | undefined;
  owner?: string | undefined;
  name?: string | undefined;
  tokenEnvVar?: string | undefined;
  packageGlobs: string[];
  packageManifestFiles: string[];
  template?: TopologyTemplate | undefined;
  cacheDir: string;
  nonInteractive: boolean;
}

interface RepoConfigResolutionContext {
  cwd: string;
  interactive: boolean;
  prompts: RepoConfigPrompts;
}

/** Test-only prompt seam for repository configuration resolution. */
export interface RepoConfigResolutionOptions {
  prompts?: CliPrompts | undefined;
}

interface RepoWorkspaceInput {
  packageGlobs: string[];
  packageManifestFiles: string[];
  template: TopologyTemplate;
}

/** Creates a local-git repo entry from parsed flags or interactive defaults. */
export async function resolveRepoConfigInput(
  context: CliCommandContext,
  input: RepoConfigInput,
  options: RepoConfigResolutionOptions = {},
): Promise<AtlasRepoConfig> {
  const resolution = createRepoConfigResolutionContext(context, input, options);
  const mode = await resolveRepoConfigMode(input, resolution);
  const gitDefaults =
    mode === "local-git"
      ? await detectLocalGitDefaults(context.cwd)
      : undefined;
  const rawRepoId = await resolveRepoConfigRepoId(
    input,
    resolution,
    resolution.interactive && mode === "local-git"
      ? gitDefaults?.repoId
      : undefined,
  );
  const repoId = canonicalizeRepoIdIfValid(rawRepoId);
  const workspace = resolveRepoWorkspaceInput(input);
  return mode === "local-git"
    ? await resolveLocalGitRepoConfig(
        context,
        input,
        resolution,
        repoId,
        workspace,
        gitDefaults,
      )
    : await resolveGhesRepoConfig(input, resolution, repoId, workspace);
}

function createRepoConfigResolutionContext(
  context: CliCommandContext,
  input: RepoConfigInput,
  options: RepoConfigResolutionOptions,
): RepoConfigResolutionContext {
  const interactive = canPrompt(context, {
    nonInteractive: input.nonInteractive,
  });
  return {
    cwd: context.cwd,
    interactive,
    prompts: interactive ? (options.prompts ?? createPrompts()) : undefined,
  };
}

async function resolveRepoConfigMode(
  input: RepoConfigInput,
  context: RepoConfigResolutionContext,
): Promise<RepoConfigMode> {
  if (input.mode !== undefined) {
    return input.mode;
  }
  if (!context.interactive) {
    return "local-git";
  }
  return (await context.prompts?.select("Choose repository mode", [
    { label: "Local Git", value: "local-git" },
    { label: "GitHub Enterprise API", value: "ghes-api" },
  ])) as RepoConfigMode;
}

async function resolveRepoConfigRepoId(
  input: RepoConfigInput,
  context: RepoConfigResolutionContext,
  defaultRepoId?: string,
): Promise<string> {
  const repoId =
    input.repoId ??
    (await promptIfInteractive(
      context,
      defaultRepoId === undefined
        ? "Repository ID (host/owner/name, e.g. github.com/owner/repo)"
        : "Repository ID",
      defaultRepoId,
    ));
  if (repoId === undefined || repoId.length === 0) {
    throw new CliError("Missing repository ID.", {
      code: "CLI_REPO_ID_REQUIRED",
      exitCode: EXIT_INPUT_ERROR,
    });
  }
  return repoId;
}

function canonicalizeRepoIdIfValid(repoId: string): string {
  try {
    return canonicalizeRepoId(repoId);
  } catch {
    return repoId;
  }
}

function requireCanonicalRepoId(repoId: string): string {
  try {
    return canonicalizeRepoId(repoId);
  } catch (error) {
    throw new CliError(
      error instanceof Error
        ? error.message
        : "Repository ID must be host/owner/name.",
      { code: "CLI_REPO_ID_REQUIRED", exitCode: EXIT_INPUT_ERROR },
    );
  }
}

function resolveRepoWorkspaceInput(input: RepoConfigInput): RepoWorkspaceInput {
  return {
    packageGlobs:
      input.packageGlobs.length > 0 ? input.packageGlobs : ["packages/*"],
    packageManifestFiles:
      input.packageManifestFiles.length > 0
        ? input.packageManifestFiles
        : ["package.json"],
    template: input.template ?? "mixed-monorepo",
  };
}

async function resolveLocalGitRepoConfig(
  cliContext: CliCommandContext,
  input: RepoConfigInput,
  context: RepoConfigResolutionContext,
  repoId: string,
  workspace: RepoWorkspaceInput,
  gitDefaults: LocalGitDefaults | undefined,
): Promise<AtlasRepoConfig> {
  const defaultRef = gitDefaults?.ref ?? "main";
  const defaultLocalPath = resolveCliPath(
    repoCheckoutDir(input.cacheDir, repoId),
    cliContext.cwd,
  );
  const ref =
    input.ref ??
    (await promptIfInteractive(context, "Git ref", defaultRef)) ??
    defaultRef;
  const localPath =
    input.localPath ??
    (await promptIfInteractive(
      context,
      "Local checkout path",
      defaultLocalPath,
    )) ??
    defaultLocalPath;
  const remote =
    input.remote ??
    (await promptIfInteractive(
      context,
      "Git remote URL",
      gitDefaults?.remote,
    )) ??
    gitDefaults?.remote;
  const git = requireLocalGitFields(remote, localPath, ref);
  return {
    repoId: requireCanonicalRepoId(repoId),
    mode: "local-git",
    git: { ...git, refMode: input.refMode ?? "remote" },
    workspace: repoWorkspaceConfig(workspace),
    topology: topologyTemplate(workspace.template),
  };
}

async function resolveGhesRepoConfig(
  input: RepoConfigInput,
  context: RepoConfigResolutionContext,
  repoId: string,
  workspace: RepoWorkspaceInput,
): Promise<AtlasRepoConfig> {
  const ref =
    input.ref ??
    (await promptIfInteractive(context, "GitHub ref", "main")) ??
    "main";
  const baseUrl =
    input.baseUrl ?? (await promptIfInteractive(context, "GHES API base URL"));
  const owner =
    input.owner ?? (await promptIfInteractive(context, "GHES owner"));
  const name =
    input.name ?? (await promptIfInteractive(context, "GHES repository name"));
  const ghes = requireGhesFields(baseUrl, owner, name);
  return {
    repoId: requireCanonicalRepoId(repoId),
    mode: "ghes-api",
    github: {
      ...ghes,
      ref,
      ...(input.tokenEnvVar === undefined
        ? {}
        : { tokenEnvVar: input.tokenEnvVar }),
    },
    workspace: repoWorkspaceConfig(workspace),
    topology: topologyTemplate(workspace.template),
  };
}

async function promptIfInteractive(
  context: RepoConfigResolutionContext,
  message: string,
  defaultValue?: string | undefined,
): Promise<string | undefined> {
  return context.interactive
    ? await context.prompts?.input(message, defaultValue)
    : undefined;
}

function requireLocalGitFields(
  remote: string | undefined,
  localPath: string | undefined,
  ref: string | undefined,
): { remote: string; localPath: string; ref: string } {
  if (
    remote === undefined ||
    remote.length === 0 ||
    localPath === undefined ||
    localPath.length === 0 ||
    ref === undefined ||
    ref.length === 0
  ) {
    throw new CliError(
      "Missing local-git remote. Use --remote, or run add-repo from inside a Git checkout so Atlas can infer one.",
      { code: "CLI_REMOTE_REQUIRED", exitCode: EXIT_INPUT_ERROR },
    );
  }
  return { remote, localPath, ref };
}

function requireGhesFields(
  baseUrl: string | undefined,
  owner: string | undefined,
  name: string | undefined,
): { baseUrl: string; owner: string; name: string } {
  if (
    baseUrl === undefined ||
    baseUrl.length === 0 ||
    owner === undefined ||
    owner.length === 0 ||
    name === undefined ||
    name.length === 0
  ) {
    throw new CliError(
      "Missing GHES repository fields. Use --base-url, --owner, and --name in non-interactive mode.",
      { code: "CLI_GHES_FIELDS_REQUIRED", exitCode: EXIT_INPUT_ERROR },
    );
  }
  return { baseUrl, owner, name };
}

function repoWorkspaceConfig(
  input: RepoWorkspaceInput,
): AtlasRepoConfig["workspace"] {
  return {
    packageGlobs: input.packageGlobs,
    packageManifestFiles: input.packageManifestFiles,
  };
}

/** Adds one repo safely to the ATLAS config. */
export async function appendRepoConfig(
  context: CliCommandContext,
  repo: AtlasRepoConfig,
  options: {
    configPath?: string | undefined;
    cacheDir?: string | undefined;
  } = {},
) {
  const result = await mutateAtlasConfig(
    {
      cwd: context.cwd,
      env: context.env,
      ...(options.configPath === undefined
        ? {}
        : { configPath: options.configPath }),
      ...(options.cacheDir !== undefined
        ? { createDefault: defaultCliConfig(options.cacheDir) }
        : {}),
    },
    (config) => {
      if (config.repos.some((entry) => entry.repoId === repo.repoId)) {
        throw new CliError(
          `Repository ${repo.repoId} already exists in config.`,
          {
            code: "CLI_DUPLICATE_REPO",
            exitCode: EXIT_INPUT_ERROR,
          },
        );
      }
      return {
        ...config,
        repos: [...config.repos, repo],
      };
    },
  );
  const atlasHome = resolveCliPath(
    options.cacheDir ?? result.config.cacheDir,
    context.cwd,
  );
  await mkdir(atlasHome, {
    recursive: true,
  });
  await mkdir(
    resolveCliPath(
      `${atlasHome}/${DEFAULT_MOXEL_ATLAS_REPOS_RELATIVE_PATH}`,
      context.cwd,
    ),
    { recursive: true },
  );
  await mkdir(
    parentDir(resolveCliPath(result.config.corpusDbPath, context.cwd)),
    { recursive: true },
  );
  await writeRepoMetadata(
    repoMetadataPath(atlasHome, repo.repoId),
    createRepoMetadata(repo),
  );
  return result;
}
