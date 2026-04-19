import { execFile } from "node:child_process";

import { GitCommandFailedError, GitCommandTimeoutError, GitExecutableNotFoundError } from "./git-errors";

/** Structured output captured from a Git subprocess invocation. */
export interface GitCommandResult {
  /** Full command vector including the `git` executable. */
  command: string[];
  /** Working directory used for the subprocess. */
  cwd: string;
  /** Process exit code. */
  exitCode: number;
  /** UTF-8 decoded stdout. */
  stdout: string;
  /** UTF-8 decoded stderr. */
  stderr: string;
}

/** Options accepted by the low-level Git subprocess wrapper. */
export interface SpawnGitOptions {
  /** Directory in which Git should run. */
  cwd: string;
  /** Git arguments excluding the `git` executable. */
  args: readonly string[];
  /** Optional timeout after which the process is killed and reported as failed. */
  timeoutMs?: number | undefined;
}

/**
 * Runs Git with Node subprocess APIs and returns captured text output without
 * interpreting Git-specific business semantics.
 */
export async function spawnGit(options: SpawnGitOptions): Promise<GitCommandResult> {
  const command = ["git", ...options.args];

  try {
    const { stdout, stderr } = await execFileText("git", options.args, {
      cwd: options.cwd,
      timeoutMs: options.timeoutMs
    });
    return { command, cwd: options.cwd, exitCode: 0, stdout, stderr };
  } catch (cause) {
    if (cause instanceof GitCommandTimeoutError) throw cause;
    if (isExecutableMissingError(cause)) {
      throw new GitExecutableNotFoundError({ command, localPath: options.cwd, cause });
    }
    if (isExecFileError(cause)) {
      return {
        command,
        cwd: options.cwd,
        exitCode: typeof cause.code === "number" ? cause.code : 1,
        stdout: String(cause.stdout ?? ""),
        stderr: String(cause.stderr ?? "")
      };
    }
    throw new GitCommandFailedError({ command, localPath: options.cwd, cause });
  }
}

function execFileText(
  file: string,
  args: readonly string[],
  options: { cwd: string; timeoutMs?: number | undefined }
): Promise<{ stdout: string; stderr: string }> {
  return new Promise((resolve, reject) => {
    const child = execFile(
      file,
      [...args],
      { cwd: options.cwd, encoding: "utf8", timeout: options.timeoutMs },
      (error, stdout, stderr) => {
        if (error) {
          if ((error as NodeJS.ErrnoException).code === "ETIMEDOUT") {
            reject(
              new GitCommandTimeoutError({
                command: [file, ...args],
                localPath: options.cwd,
                timeoutMs: options.timeoutMs
              })
            );
            return;
          }
          Object.assign(error, { stdout, stderr });
          reject(error);
          return;
        }
        resolve({ stdout, stderr });
      }
    );
    child.stdin?.end();
  });
}

function isExecFileError(cause: unknown): cause is Error & { code?: unknown; stdout?: unknown; stderr?: unknown } {
  return typeof cause === "object" && cause !== null && ("stdout" in cause || "stderr" in cause || "code" in cause);
}

/**
 * Runs Git and raises a generic command error on non-zero exit. Higher-level
 * modules wrap that error in operation-specific classes.
 */
export async function spawnGitOrThrow(options: SpawnGitOptions): Promise<GitCommandResult> {
  const result = await spawnGit(options);
  if (result.exitCode !== 0) {
    throw new GitCommandFailedError({
      command: result.command,
      exitCode: result.exitCode,
      localPath: result.cwd,
      stderr: result.stderr,
      stdout: result.stdout
    });
  }
  return result;
}

function isExecutableMissingError(cause: unknown): boolean {
  return (
    typeof cause === "object" &&
    cause !== null &&
    "code" in cause &&
    (cause as { code?: unknown }).code === "ENOENT"
  );
}
