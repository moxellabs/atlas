import type { AtlasConfig, AtlasRepoConfig } from "../atlas-config.schema";

export type GhesCredentialSource = "env" | "gh-cli";

export interface ResolvedGhesToken {
  kind: "token";
  token: string;
  source: GhesCredentialSource;
  sourceName: string;
}

export type GhesCommandRunner = (command: readonly string[]) => Promise<{
  exitCode: number;
  stdout: string;
  stderr: string;
}>;

export interface ResolveGhesTokenOptions {
  env?: NodeJS.ProcessEnv | undefined;
  runCommand?: GhesCommandRunner | undefined;
}

export async function resolveGhesAuth(
  config: AtlasConfig,
  options: ResolveGhesTokenOptions = {}
): Promise<Record<string, ResolvedGhesToken> | undefined> {
  const entries: Array<[string, ResolvedGhesToken]> = [];
  for (const repo of config.repos) {
    if (repo.mode !== "ghes-api" || repo.github === undefined) {
      continue;
    }
    const token = await resolveGhesToken(repo, options);
    if (token !== undefined) {
      entries.push([repo.repoId, token]);
    }
  }
  return entries.length === 0 ? undefined : Object.fromEntries(entries);
}

export async function resolveGhesToken(
  repo: AtlasRepoConfig,
  options: ResolveGhesTokenOptions = {}
): Promise<ResolvedGhesToken | undefined> {
  if (repo.mode !== "ghes-api" || repo.github === undefined) {
    return undefined;
  }
  const env = options.env ?? process.env;
  const envNames = unique([repo.github.tokenEnvVar, "GHES_TOKEN", "GH_ENTERPRISE_TOKEN", "GH_TOKEN", "GITHUB_TOKEN"]);
  for (const name of envNames) {
    const token = env[name]?.trim();
    if (token) {
      return {
        kind: "token",
        token,
        source: "env",
        sourceName: name
      };
    }
  }

  const ghToken = await resolveGhCliToken(ghesHostname(repo.github.baseUrl), options.runCommand ?? runCommand);
  if (ghToken !== undefined) {
    return ghToken;
  }
  return undefined;
}

export function ghesHostname(baseUrl: string): string {
  return new URL(baseUrl).hostname;
}

async function resolveGhCliToken(hostname: string, run: GhesCommandRunner): Promise<ResolvedGhesToken | undefined> {
  const result = await run(["gh", "auth", "token", "--hostname", hostname]).catch(() => undefined);
  if (result === undefined || result.exitCode !== 0) {
    return undefined;
  }
  const token = result.stdout.trim();
  if (!token) {
    return undefined;
  }
  return {
    kind: "token",
    token,
    source: "gh-cli",
    sourceName: `gh:${hostname}`
  };
}

async function runCommand(command: readonly string[]): Promise<{ exitCode: number; stdout: string; stderr: string }> {
  const process = Bun.spawn([...command], {
    stdin: "ignore",
    stdout: "pipe",
    stderr: "pipe"
  });
  const [exitCode, stdout, stderr] = await Promise.all([
    process.exited,
    Bun.readableStreamToText(process.stdout),
    Bun.readableStreamToText(process.stderr)
  ]);
  return { exitCode, stdout, stderr };
}

function unique(values: readonly (string | undefined)[]): string[] {
  return [...new Set(values.filter((value): value is string => value !== undefined && value.length > 0))];
}
