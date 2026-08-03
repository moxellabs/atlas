import { readFile, stat } from "node:fs/promises";
import { join } from "node:path";
import {
  DEFAULT_ATLAS_ARTIFACT_ROOT,
  IDENTITY_ROOT_ERROR,
  loadConfig,
  resolveIdentityProfile,
} from "@atlas/config";
import { readStringOption } from "../runtime/args";
import type { CliCommandContext } from "../runtime/types";
import { CliError, EXIT_INPUT_ERROR } from "../utils/errors";
export interface CliArtifactRootResolution {
  artifactRoot: string;
  artifactDir: string;
  customRootUsed: boolean;
  source: "cli" | "env" | "config" | "default";
}

export async function resolveCliArtifactRoot(
  context: CliCommandContext,
  root: string = context.cwd,
): Promise<CliArtifactRootResolution> {
  let configIdentity: { root?: string | undefined } | undefined;
  try {
    const configPath = readStringOption(context, "config");
    const loaded = await loadConfig({
      cwd: context.cwd,
      env: context.env,
      ...(configPath === undefined ? {} : { configPath }),
      requireGhesAuth: false,
    });
    configIdentity = loaded.config.identity;
  } catch {
    configIdentity = undefined;
  }
  try {
    const profile = resolveIdentityProfile({
      cliIdentityRoot: context.identityRoot,
      envIdentityRoot: context.env.ATLAS_IDENTITY_ROOT,
      configIdentity,
    });
    return {
      artifactRoot: profile.artifactRoot,
      artifactDir: join(root, profile.artifactRoot),
      customRootUsed: profile.customIdentityRoot,
      source: profile.identityRootSource,
    };
  } catch (error) {
    throw new CliError(
      error instanceof Error ? error.message : IDENTITY_ROOT_ERROR,
      { code: "CLI_INVALID_ARTIFACT_ROOT", exitCode: EXIT_INPUT_ERROR },
    );
  }
}

export async function readRepoLocalArtifactMetadata(
  context: CliCommandContext,
  root: string,
): Promise<{ repoId: string; path: string } | undefined> {
  const artifactRoot = await resolveCliArtifactRoot(context, root);
  const path = join(artifactRoot.artifactDir, "atlas.repo.json");
  try {
    const raw = JSON.parse(await readFile(path, "utf8")) as {
      repoId?: unknown;
    };
    if (typeof raw.repoId === "string") return { repoId: raw.repoId, path };
    return undefined;
  } catch {
    return undefined;
  }
}

export async function maybeRenderArtifactRootMigrationHint(input: {
  root: string;
  artifactRoot: string;
  customRootUsed: boolean;
}): Promise<string | undefined> {
  if (!input.customRootUsed) return undefined;
  if (await pathExists(join(input.root, input.artifactRoot))) return undefined;
  if (!(await pathExists(join(input.root, DEFAULT_ATLAS_ARTIFACT_ROOT))))
    return undefined;
  return `${DEFAULT_ATLAS_ARTIFACT_ROOT} exists, but ${input.artifactRoot} was selected; no migration was performed and no fallback will be used.`;
}

async function pathExists(path: string): Promise<boolean> {
  try {
    await stat(path);
    return true;
  } catch {
    return false;
  }
}
