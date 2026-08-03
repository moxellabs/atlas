import { pathToFileURL } from "node:url";
import { canonicalizeRepoId } from "@atlas/config";
import { runProcess } from "../utils/node-runtime";
export interface LocalGitDefaults {
  rootPath: string;
  ref: string;
  remote: string;
  repoId?: string | undefined;
}

export async function detectLocalGitDefaults(
  cwd: string,
): Promise<LocalGitDefaults | undefined> {
  const rootPath = await gitOutput(cwd, ["rev-parse", "--show-toplevel"]);
  if (rootPath === undefined) {
    return undefined;
  }
  const currentBranch = await gitOutput(rootPath, ["branch", "--show-current"]);
  const configuredRemote = await gitOutput(rootPath, [
    "config",
    "--get",
    "remote.origin.url",
  ]);
  return {
    rootPath,
    ref: currentBranch ?? "HEAD",
    remote: configuredRemote ?? pathToFileURL(rootPath).href,
    repoId:
      configuredRemote === undefined
        ? undefined
        : repoIdFromGitRemote(configuredRemote),
  };
}

export async function gitOutput(
  cwd: string,
  args: readonly string[],
): Promise<string | undefined> {
  try {
    const { exitCode, stdout } = await runProcess(["git", ...args], { cwd });
    if (exitCode !== 0) {
      return undefined;
    }
    const output = stdout.trim();
    return output.length > 0 ? output : undefined;
  } catch {
    return undefined;
  }
}

export async function readGitRoot(cwd: string): Promise<string | undefined> {
  return gitOutput(cwd, ["rev-parse", "--show-toplevel"]);
}

export async function readGitOrigin(cwd: string): Promise<string | undefined> {
  return gitOutput(cwd, ["config", "--get", "remote.origin.url"]);
}

export function repoIdFromGitRemote(remote: string): string | undefined {
  const scp = remote.match(/^git@([^:/\s]+):([^/\s]+)\/([^/\s]+)$/i);
  if (scp) return normalizeRemoteRepoId(scp[1]!, scp[2]!, scp[3]!);

  try {
    const url = new URL(remote);
    if (!["ssh:", "http:", "https:"].includes(url.protocol)) {
      return undefined;
    }
    if (url.pathname.includes("//")) return undefined;
    const path = url.pathname.replace(/^\/+|\/+$/g, "");
    const parts = path.split("/");
    if (
      !url.hostname ||
      url.search ||
      url.hash ||
      parts.length !== 2 ||
      !parts[0] ||
      !parts[1]
    ) {
      return undefined;
    }
    return normalizeRemoteRepoId(url.hostname, parts[0], parts[1]);
  } catch {
    return undefined;
  }
}

function normalizeRemoteRepoId(
  host: string,
  owner: string,
  name: string,
): string | undefined {
  try {
    return canonicalizeRepoId(`${host}/${owner}/${name}`);
  } catch {
    return undefined;
  }
}
