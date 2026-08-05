import { constants } from "node:fs";
import { access, readdir } from "node:fs/promises";
import { homedir } from "node:os";
import { delimiter, join, sep } from "node:path";

import { hermeticCodexEnvironment } from "./codex-command-policy";

export interface CodexProcessResult {
  readonly stdout: string;
  readonly stderr: string;
  readonly exitCode: number;
  readonly timedOut: boolean;
}
export interface ResolvedCodexExecutable {
  readonly executable: string;
  readonly version: string;
}

/**
 * Resolves and probes a concrete Codex launcher before the evaluator replaces
 * HOME. Version-manager shims can otherwise resolve against the isolated home
 * and intermittently select an incomplete global npm installation.
 */
export async function resolveCodexExecutable(
  cwd: string,
  env: Record<string, string>,
): Promise<ResolvedCodexExecutable> {
  const configured = Bun.env.ATLAS_CODEX_EXECUTABLE?.trim();
  const candidates =
    configured === undefined || configured.length === 0
      ? await discoverCodexExecutables()
      : [configured];
  const failures: string[] = [];
  for (const executable of candidates) {
    const result = await runCodexCommand(
      [executable, "--version"],
      cwd,
      15_000,
      env,
    );
    if (!result.timedOut && result.exitCode === 0) {
      return { executable, version: result.stdout.trim() };
    }
    failures.push(
      `${executable}: ${result.timedOut ? "timed out" : (result.stderr || result.stdout || `exit ${result.exitCode}`).trim()}`,
    );
  }
  throw new Error(
    `No working Codex executable was available in the hermetic evaluator environment.${failures.length === 0 ? "" : ` Tried ${failures.join("; ")}`}`,
  );
}

export async function runCodexCommand(
  command: string[],
  cwd: string,
  timeoutMs: number,
  env: Record<string, string> = hermeticCodexEnvironment(),
): Promise<CodexProcessResult> {
  const process = Bun.spawn(command, {
    cwd,
    env,
    stdout: "pipe",
    stderr: "pipe",
  });
  let timedOut = false;
  const timeout = setTimeout(() => {
    timedOut = true;
    process.kill();
  }, timeoutMs);
  const [stdout, stderr, exitCode] = await Promise.all([
    new Response(process.stdout).text(),
    new Response(process.stderr).text(),
    process.exited,
  ]);
  clearTimeout(timeout);
  return { stdout, stderr, exitCode, timedOut };
}

async function discoverCodexExecutables(): Promise<string[]> {
  const candidates: string[] = [];
  for (const directory of (Bun.env.PATH ?? "").split(delimiter)) {
    if (directory.length === 0) continue;
    const candidate = join(directory, "codex");
    if (!(await isExecutable(candidate)) || isVersionManagerShim(candidate)) {
      continue;
    }
    candidates.push(candidate);
  }

  candidates.push(...(await findMiseCodexExecutables()));
  const pathExecutable = Bun.which("codex");
  if (pathExecutable !== null) candidates.push(pathExecutable);
  return [...new Set(candidates)];
}

async function findMiseCodexExecutables(): Promise<string[]> {
  const dataDir =
    Bun.env.MISE_DATA_DIR ?? join(homedir(), ".local", "share", "mise");
  const installsDir = join(dataDir, "installs");
  const tools = await directoryNames(installsDir);
  const candidates: string[] = [];
  for (const tool of tools) {
    const toolDir = join(installsDir, tool);
    const versions = (await directoryNames(toolDir)).sort((left, right) =>
      right.localeCompare(left, undefined, { numeric: true }),
    );
    for (const version of versions) {
      const versionDir = join(toolDir, version);
      for (const candidate of [
        join(versionDir, "bin", "codex"),
        join(versionDir, "codex"),
      ]) {
        if (await isExecutable(candidate)) candidates.push(candidate);
      }
    }
  }
  return candidates;
}

async function directoryNames(path: string): Promise<string[]> {
  try {
    return (await readdir(path, { withFileTypes: true }))
      .filter((entry) => entry.isDirectory())
      .map((entry) => entry.name);
  } catch {
    return [];
  }
}

async function isExecutable(path: string): Promise<boolean> {
  try {
    await access(path, constants.X_OK);
    return true;
  } catch {
    return false;
  }
}

function isVersionManagerShim(path: string): boolean {
  return path.split(sep).includes("shims");
}
