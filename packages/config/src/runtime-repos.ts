import { dirname } from "node:path";

import type {
  AtlasDocMetadataProfile,
  DocMetadataRule,
  RepoConfig,
  TopologyRule,
} from "@atlas/core";

import type { AtlasConfig, AtlasRepoConfig } from "./atlas-config.schema";

/** Builds the source-adapter repository contracts owned by resolved config. */
export function resolveRuntimeRepoConfigs(
  config: AtlasConfig,
  configPath: string,
): RepoConfig[] {
  const configDir = dirname(configPath);
  return config.repos.map((repo) =>
    resolveRuntimeRepoConfig(repo, config, configDir),
  );
}

function resolveRuntimeRepoConfig(
  repo: AtlasRepoConfig,
  config: AtlasConfig,
  configDir: string,
): RepoConfig {
  return {
    repoId: repo.repoId,
    mode: repo.mode,
    ...(repo.priority === undefined ? {} : { priority: repo.priority }),
    ...(repo.git === undefined
      ? {}
      : {
          git: {
            remote: repo.git.remote,
            localPath: repo.git.localPath,
            ref: repo.git.ref,
            refMode: repo.git.refMode,
          },
        }),
    ...(repo.github === undefined
      ? {}
      : {
          github: {
            baseUrl: repo.github.baseUrl,
            owner: repo.github.owner,
            name: repo.github.name,
            ref: repo.github.ref,
          },
        }),
    workspace: {
      rootPath:
        repo.mode === "local-git"
          ? (repo.git?.localPath ?? configDir)
          : configDir,
      packageGlobs: [...repo.workspace.packageGlobs],
      packageManifestFiles: [...repo.workspace.packageManifestFiles],
    },
    topology: repo.topology.map(copyTopologyRule),
    docs: {
      metadata: {
        rules: config.docs.metadata.rules.map(copyMetadataRule),
        profiles: Object.fromEntries(
          Object.entries(config.docs.metadata.profiles).map(
            ([name, profile]) => [name, copyMetadataProfile(profile)],
          ),
        ),
      },
    },
  };
}

function copyTopologyRule(
  rule: AtlasRepoConfig["topology"][number],
): TopologyRule {
  return {
    id: rule.id,
    kind: rule.kind,
    match: {
      include: [...rule.match.include],
      ...(rule.match.exclude === undefined
        ? {}
        : { exclude: [...rule.match.exclude] }),
    },
    ownership: {
      attachTo: rule.ownership.attachTo,
      ...(rule.ownership.deriveFromPath === undefined
        ? {}
        : { deriveFromPath: rule.ownership.deriveFromPath }),
      ...(rule.ownership.packageRootPattern === undefined
        ? {}
        : { packageRootPattern: rule.ownership.packageRootPattern }),
      ...(rule.ownership.moduleRootPattern === undefined
        ? {}
        : { moduleRootPattern: rule.ownership.moduleRootPattern }),
      ...(rule.ownership.skillPattern === undefined
        ? {}
        : { skillPattern: rule.ownership.skillPattern }),
    },
    authority: rule.authority,
    priority: rule.priority,
  };
}

function copyMetadataRule(
  rule: AtlasConfig["docs"]["metadata"]["rules"][number],
): DocMetadataRule {
  return {
    id: rule.id,
    match: {
      include: [...rule.match.include],
      ...(rule.match.exclude === undefined
        ? {}
        : { exclude: [...rule.match.exclude] }),
    },
    metadata: {
      ...rule.metadata,
      ...(rule.metadata.audience === undefined
        ? {}
        : { audience: [...rule.metadata.audience] }),
      ...(rule.metadata.purpose === undefined
        ? {}
        : { purpose: [...rule.metadata.purpose] }),
    },
    priority: rule.priority,
  };
}

function copyMetadataProfile(
  profile: AtlasConfig["docs"]["metadata"]["profiles"][string],
): AtlasDocMetadataProfile {
  return {
    ...profile,
    ...(profile.visibility === undefined
      ? {}
      : { visibility: [...profile.visibility] }),
    ...(profile.audience === undefined
      ? {}
      : { audience: [...profile.audience] }),
    ...(profile.purpose === undefined ? {} : { purpose: [...profile.purpose] }),
    ...(profile.include === undefined ? {} : { include: [...profile.include] }),
    ...(profile.exclude === undefined ? {} : { exclude: [...profile.exclude] }),
  };
}
