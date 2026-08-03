import { relative, resolve } from "node:path";
import {
  type AtlasConfig,
  type AtlasHostConfig,
  canonicalizeRepoId,
  defaultGithubHostConfig,
  defaultHost,
  sortHostsByPriority,
} from "@atlas/config";
import { canPrompt, createPrompts } from "../io/prompts";
import { readStringOption } from "../runtime/args";
import type { CliCommandContext } from "../runtime/types";
import { CliError, EXIT_INPUT_ERROR } from "../utils/errors";
import { readRepoLocalArtifactMetadata } from "./artifact-root";
import { readGitOrigin, readGitRoot, repoIdFromGitRemote } from "./git";

export type ParsedRepoRef =
  | {
      kind: "canonical-id";
      input: string;
      host: string;
      owner: string;
      name: string;
      repoId: string;
    }
  | { kind: "shorthand"; input: string; owner: string; name: string }
  | {
      kind: "ssh-url" | "https-url";
      input: string;
      host: string;
      owner: string;
      name: string;
      repoId: string;
      remote: string;
    }
  | { kind: "local-path"; input: string; path: string };

function parsedRemote(
  input: string,
  kind: "ssh-url" | "https-url",
): Extract<ParsedRepoRef, { kind: "ssh-url" | "https-url" }> {
  const repoId = repoIdFromGitRemote(input);
  if (repoId === undefined) {
    throw new Error(
      kind === "ssh-url"
        ? "SSH URL must be host/owner/name"
        : "HTTPS URL must be host/owner/name",
    );
  }
  const [host, owner, name] = repoId.split("/") as [string, string, string];
  return { kind, input, host, owner, name, repoId, remote: input };
}

function candidate(host: string, owner: string, name: string) {
  const repoId = canonicalizeRepoId(
    `${host}/${owner}/${name.replace(/\.git$/i, "")}`,
  );
  const [normalizedHost, normalizedOwner, normalizedName] = repoId.split(
    "/",
  ) as [string, string, string];
  return {
    host: normalizedHost,
    owner: normalizedOwner,
    name: normalizedName,
    repoId,
  };
}

export function parseRepoRef(input: string): ParsedRepoRef {
  const raw = input.trim();
  if (!raw) throw new Error("repo input required");
  if (
    raw === "." ||
    raw.startsWith("./") ||
    raw.startsWith("../") ||
    raw.startsWith("/") ||
    raw.startsWith("file://")
  ) {
    return {
      kind: "local-path",
      input: raw,
      path: raw.startsWith("file://") ? new URL(raw).pathname : raw,
    };
  }
  if (raw.startsWith("git@") || raw.startsWith("ssh://")) {
    return parsedRemote(raw, "ssh-url");
  }
  if (raw.startsWith("https://") || raw.startsWith("http://")) {
    return parsedRemote(raw, "https-url");
  }
  const segments = raw.split("/");
  if (segments.length === 3) {
    return {
      kind: "canonical-id",
      input: raw,
      ...candidate(segments[0]!, segments[1]!, segments[2]!),
    };
  }
  if (segments.length === 2) {
    return {
      kind: "shorthand",
      input: raw,
      owner: segments[0]!.toLowerCase(),
      name: segments[1]!.replace(/\.git$/i, "").toLowerCase(),
    };
  }
  throw new Error("Unsupported repo input");
}

function configuredHosts(config: AtlasConfig): AtlasHostConfig[] {
  return sortHostsByPriority(config.hosts);
}

function unknownHost(host: string, config: AtlasConfig): never {
  throw new CliError(
    `Unknown host ${host}. Run atlas hosts add ${host}. Configured hosts: ${
      configuredHosts(config)
        .map((h) => h.name)
        .join(", ") || "none"
    }.`,
    { code: "CLI_REPO_HOST_UNKNOWN", exitCode: EXIT_INPUT_ERROR },
  );
}

async function readLocalArtifactMetadata(
  context: CliCommandContext,
  localPath: string,
): Promise<{ repoId: string } | undefined> {
  const metadata = await readRepoLocalArtifactMetadata(context, localPath);
  if (metadata === undefined) return undefined;
  const parts = metadata.repoId.split("/");
  return parts.length === 3 && parts.every((part) => part.length > 0)
    ? { repoId: metadata.repoId }
    : undefined;
}

export interface ResolvedConfigureRepoIdentity {
  repoId: string;
  host: AtlasHostConfig;
  owner: string;
  name: string;
  remote?: string | undefined;
  localPath?: string | undefined;
  kind: ParsedRepoRef["kind"];
  fallbacks?: ResolvedConfigureRepoIdentity[] | undefined;
}

function resolvedShorthand(
  host: AtlasHostConfig,
  parsed: Extract<ParsedRepoRef, { kind: "shorthand" }>,
): ResolvedConfigureRepoIdentity {
  return {
    repoId: `${host.name}/${parsed.owner}/${parsed.name}`,
    host,
    owner: parsed.owner,
    name: parsed.name,
    kind: parsed.kind,
  };
}

export interface ResolveConfigureRepoIdentityOptions {
  intent: "configure";
  config: AtlasConfig;
  input: string;
  host?: string | undefined;
  nonInteractive: boolean;
}

type ConfigureInputOptions = Omit<
  ResolveConfigureRepoIdentityOptions,
  "intent" | "config"
>;

async function resolveConfigureRepoIdentity(
  context: CliCommandContext,
  config: AtlasConfig,
  options: ConfigureInputOptions,
): Promise<ResolvedConfigureRepoIdentity> {
  const parsed = parseRepoRef(options.input);
  if (parsed.kind === "local-path") {
    const localPath = resolve(context.cwd, parsed.path);
    const remote = await readGitOrigin(localPath);
    if (!remote) {
      const metadata = await readLocalArtifactMetadata(context, localPath);
      if (metadata !== undefined) {
        const [hostName, owner, name] = metadata.repoId.split("/") as [
          string,
          string,
          string,
        ];
        const host = configuredHosts(config).find((h) => h.name === hostName);
        if (!host) unknownHost(hostName, config);
        return {
          repoId: metadata.repoId,
          host,
          owner,
          name,
          remote: `file://${localPath}`,
          localPath,
          kind: "local-path",
        };
      }
      throw new CliError(
        "Local path has no parseable origin remote. Use --repo-id with --remote, or --host with --owner and --name.",
        { code: "CLI_REPO_ID_REQUIRED", exitCode: EXIT_INPUT_ERROR },
      );
    }
    const resolved = await resolveConfigureRepoIdentity(context, config, {
      input: remote,
      ...(options.host === undefined ? {} : { host: options.host }),
      nonInteractive: options.nonInteractive,
    });
    return { ...resolved, localPath, remote, kind: "local-path" };
  }
  if (
    parsed.kind === "canonical-id" ||
    parsed.kind === "ssh-url" ||
    parsed.kind === "https-url"
  ) {
    const host = configuredHosts(config).find((h) => h.name === parsed.host);
    if (!host) unknownHost(parsed.host, config);
    return {
      repoId: parsed.repoId,
      host,
      owner: parsed.owner,
      name: parsed.name,
      remote: "remote" in parsed ? parsed.remote : undefined,
      kind: parsed.kind,
    };
  }
  const hosts = configuredHosts(config);
  if (parsed.kind !== "shorthand") {
    throw new Error(
      "Expected shorthand repo input after explicit inputs resolved.",
    );
  }
  if (options.host) {
    const host = hosts.find((h) => h.name === options.host?.toLowerCase());
    if (!host) unknownHost(options.host.toLowerCase(), config);
    return resolvedShorthand(host, parsed);
  }
  if (hosts.length === 0)
    throw new CliError("No configured hosts. Configured hosts: none.", {
      code: "CLI_REPO_HOST_REQUIRED",
      exitCode: EXIT_INPUT_ERROR,
    });
  const host = defaultHost(hosts) ?? hosts[0]!;
  const publicGithub = hosts.find(
    (candidate) => candidate.name === "github.com",
  );
  const fallbacks =
    publicGithub === undefined || publicGithub.name === host.name
      ? []
      : [resolvedShorthand(publicGithub, parsed)];
  return {
    ...resolvedShorthand(host, parsed),
    ...(fallbacks.length === 0 ? {} : { fallbacks }),
  };
}
export type RepoTargetSource =
  | "explicit"
  | "positional"
  | "bare-name"
  | "repo-metadata"
  | "cwd-config"
  | "git-origin"
  | "single-config";

export interface ResolvedRepoTarget {
  repoId: string;
  source: RepoTargetSource;
  reason: string;
  hostStatus?: "configured" | "builtin-github" | "unknown" | undefined;
  candidates?: string[] | undefined;
}

export interface ResolveTargetRepoIdentityOptions {
  intent: "target";
  config: AtlasConfig;
  explicit?: string | undefined;
  positional?: string | undefined;
  command: string;
  nonInteractive?: boolean | undefined;
  allowSingleConfigured?: boolean | undefined;
}

export function resolveRepoIdentity(
  context: CliCommandContext,
  options: ResolveConfigureRepoIdentityOptions,
): Promise<ResolvedConfigureRepoIdentity>;
export function resolveRepoIdentity(
  context: CliCommandContext,
  options: ResolveTargetRepoIdentityOptions,
): Promise<ResolvedRepoTarget>;
export function resolveRepoIdentity(
  context: CliCommandContext,
  options:
    | ResolveConfigureRepoIdentityOptions
    | ResolveTargetRepoIdentityOptions,
): Promise<ResolvedConfigureRepoIdentity | ResolvedRepoTarget> {
  return options.intent === "configure"
    ? resolveConfigureRepoIdentity(context, options.config, options)
    : resolveTargetRepoIdentity(context, options);
}

interface Candidate {
  repoId: string;
  source: RepoTargetSource;
  reason: string;
  hostStatus?: ResolvedRepoTarget["hostStatus"];
}

export function readRepoTargetArg(
  context: CliCommandContext,
  position = 0,
): { explicit?: string | undefined; positional?: string | undefined } {
  const explicit =
    readStringOption(context, "repo") ?? readStringOption(context, "repoId");
  const positional = context.positionals[position];
  return { explicit, positional };
}

async function resolveTargetRepoIdentity(
  context: CliCommandContext,
  options: ResolveTargetRepoIdentityOptions,
): Promise<ResolvedRepoTarget> {
  const checked = [
    "flags",
    "positional argument",
    "repo metadata",
    "cwd",
    "git origin",
    "config",
  ];
  if (options.explicit !== undefined) {
    return canonicalOrThrow(
      options.explicit,
      "explicit",
      "explicit --repo/--repo-id",
      options.config,
    );
  }
  if (options.positional !== undefined) {
    return resolveInputTarget(context, options, options.positional);
  }

  const metadata = await readRepoArtifactMetadataFromCwd(context);
  if (metadata !== undefined) {
    return canonicalOrThrow(
      metadata.repoId,
      "repo-metadata",
      metadata.path,
      options.config,
    );
  }

  const cwdMatches = await configuredCwdMatches(context.cwd, options.config);
  if (cwdMatches.length === 1) return cwdMatches[0]!;
  if (cwdMatches.length > 1) {
    return chooseOrThrow(context, options, cwdMatches, "cwd");
  }

  const origin = await repoIdFromGitOrigin(context.cwd, options.config);
  if (origin !== undefined) return origin;

  if (
    options.allowSingleConfigured !== false &&
    options.config.repos.length === 1
  ) {
    const repoId = options.config.repos[0]!.repoId;
    return canonicalOrThrow(
      repoId,
      "single-config",
      "only configured repository",
      options.config,
    );
  }

  throw new CliError(
    `${options.command} requires a repo target. Atlas checked ${checked.join(", ")} and could not infer one. Run from a configured checkout, pass a bare repo name when unique (for example: atlas ${options.command} my-repo), or use --repo host/owner/name.`,
    {
      code: "CLI_REPO_TARGET_REQUIRED",
      exitCode: EXIT_INPUT_ERROR,
      details: { checked },
    },
  );
}

async function resolveInputTarget(
  context: CliCommandContext,
  options: ResolveTargetRepoIdentityOptions,
  input: string,
): Promise<ResolvedRepoTarget> {
  if (input.includes("/")) {
    return canonicalOrThrow(
      input,
      "positional",
      "canonical repo id",
      options.config,
    );
  }
  const matches = options.config.repos
    .filter((repo) => repo.repoId.split("/").at(-1) === input)
    .map((repo) => ({
      repoId: repo.repoId,
      source: "bare-name" as const,
      reason: `bare repo name matched ${input}`,
      hostStatus: "configured" as const,
    }));
  if (matches.length === 1) return matches[0]!;
  if (matches.length > 1)
    return chooseOrThrow(context, options, matches, input);
  throw new CliError(
    `No configured repository matched bare name ${input}. Use a full repo id such as host/owner/${input}.`,
    {
      code: "CLI_REPO_TARGET_NOT_FOUND",
      exitCode: EXIT_INPUT_ERROR,
      details: { input, candidates: [] },
    },
  );
}

async function chooseOrThrow(
  context: CliCommandContext,
  options: ResolveTargetRepoIdentityOptions,
  matches: Candidate[],
  input: string,
): Promise<ResolvedRepoTarget> {
  const candidates = matches.map((match) => match.repoId).sort();
  if (canPrompt(context, { nonInteractive: options.nonInteractive === true })) {
    const prompts = createPrompts();
    const repoId = await prompts.select(
      `Multiple repositories match ${input}. Choose one`,
      candidates.map((candidate) => ({ label: candidate, value: candidate })),
    );
    const match = matches.find((candidate) => candidate.repoId === repoId)!;
    return { ...match, candidates };
  }
  throw new CliError(
    `Multiple repositories match ${input}: ${candidates.join(", ")}. Re-run with --repo host/owner/name to disambiguate.`,
    {
      code: "CLI_REPO_TARGET_AMBIGUOUS",
      exitCode: EXIT_INPUT_ERROR,
      details: { input, candidates },
    },
  );
}

function canonicalOrThrow(
  input: string,
  source: RepoTargetSource,
  reason: string,
  config: AtlasConfig,
): ResolvedRepoTarget {
  try {
    const parsed = parseRepoRef(input);
    if (parsed.kind !== "canonical-id")
      throw new Error("canonical id required");
    const hostStatus = hostStatusFor(parsed.host, config);
    return {
      repoId: parsed.repoId,
      source,
      reason,
      hostStatus,
    };
  } catch (error) {
    if (error instanceof CliError) throw error;
    throw new CliError(
      "Repository target must be host/owner/name or a unique bare repo name.",
      {
        code: "CLI_REPO_TARGET_INVALID",
        exitCode: EXIT_INPUT_ERROR,
        details: { input },
      },
    );
  }
}

function hostStatusFor(
  host: string,
  config: AtlasConfig,
): ResolvedRepoTarget["hostStatus"] {
  if (config.hosts.some((entry) => entry.name === host)) return "configured";
  if (host === defaultGithubHostConfig().name) return "builtin-github";
  return "unknown";
}

async function readRepoArtifactMetadataFromCwd(
  context: CliCommandContext,
): Promise<{ repoId: string; path: string } | undefined> {
  const roots = new Set<string>([context.cwd]);
  const gitRoot = await readGitRoot(context.cwd);
  if (gitRoot !== undefined) roots.add(gitRoot);
  for (const root of roots) {
    const metadata = await readRepoLocalArtifactMetadata(context, root);
    if (metadata !== undefined) return metadata;
  }
  return undefined;
}

async function configuredCwdMatches(
  cwd: string,
  config: AtlasConfig,
): Promise<Candidate[]> {
  const roots = new Set<string>([resolve(cwd)]);
  const gitRoot = await readGitRoot(cwd);
  if (gitRoot !== undefined) roots.add(resolve(gitRoot));
  return config.repos
    .filter((repo) => repo.mode === "local-git" && repo.git?.localPath)
    .filter((repo) => {
      const localPath = resolve(cwd, repo.git!.localPath);
      return [...roots].some(
        (root) =>
          sameOrInside(root, localPath) ||
          sameOrInside(resolve(cwd), localPath),
      );
    })
    .map((repo) => ({
      repoId: repo.repoId,
      source: "cwd-config" as const,
      reason: `cwd matches configured localPath ${repo.git?.localPath}`,
      hostStatus: "configured" as const,
    }));
}

function sameOrInside(path: string, parent: string): boolean {
  const rel = relative(parent, path);
  return rel === "" || (!rel.startsWith("..") && !rel.startsWith("/"));
}

async function repoIdFromGitOrigin(
  cwd: string,
  config: AtlasConfig,
): Promise<Candidate | undefined> {
  const remote = await readGitOrigin(cwd);
  if (remote === undefined) return undefined;
  const repoId = repoIdFromGitRemote(remote);
  if (repoId === undefined) return undefined;
  const [host] = repoId.split("/");
  const status = hostStatusFor(host!, config);
  if (status === "unknown") {
    throw new CliError(
      `Git origin host ${host} is not configured. GitHub.com works by default; for GHES run atlas hosts add ${host} --web-url https://${host} --api-url https://${host}/api/v3 --protocol ssh.`,
      {
        code: "CLI_REPO_HOST_UNKNOWN",
        exitCode: EXIT_INPUT_ERROR,
        details: {
          host,
          repoId,
          checked: ["git origin"],
        },
      },
    );
  }
  return {
    repoId,
    source: "git-origin",
    reason: `parsed remote.origin.url ${remote}`,
    hostStatus: status,
  };
}
