import { expect } from "bun:test";
import { mkdir, mkdtemp, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { PassThrough } from "node:stream";
import { runCli } from "./index";
import type { CliCommandContext, CliCommandOptions } from "./runtime/types";

export interface CliTestWorkspace {
  rootDir: string;
  originPath: string;
  configPath: string;
  cacheDir: string;
  localPath: string;
}

export async function runWithCapture(
  argv: readonly string[],
  env: NodeJS.ProcessEnv = {},
) {
  const stdout = new PassThrough();
  const stderr = new PassThrough();
  let stdoutText = "";
  let stderrText = "";
  stdout.on("data", (chunk) => {
    stdoutText += chunk.toString("utf8");
  });
  stderr.on("data", (chunk) => {
    stderrText += chunk.toString("utf8");
  });

  const cwdFlagIndex = argv.indexOf("--cwd");
  const cwd = cwdFlagIndex >= 0 ? argv[cwdFlagIndex + 1] : undefined;
  const defaultHome = cwd === undefined ? undefined : join(cwd, "home");
  const exitCode = await runCli(argv, {
    stdout: stdout as unknown as NodeJS.WriteStream,
    stderr: stderr as unknown as NodeJS.WriteStream,
    stdin: process.stdin,
    env: {
      ...(defaultHome === undefined ? {} : { HOME: defaultHome }),
      ...env,
    },
  });

  return {
    exitCode,
    stdout: stdoutText,
    stderr: stderrText,
  };
}

export function createCommandContext(
  argv: readonly string[],
  options: CliCommandOptions = {},
): CliCommandContext {
  return {
    positionals: argv,
    options,
    cwd: process.cwd(),
    output: { json: true, verbose: false, quiet: false },
    stdin: process.stdin,
    stdout: new PassThrough() as unknown as NodeJS.WriteStream,
    stderr: new PassThrough() as unknown as NodeJS.WriteStream,
    env: {},
  };
}

export async function exists(path: string): Promise<boolean> {
  return stat(path).then(
    () => true,
    () => false,
  );
}

export function expectNoGitMutationCommands(commands: readonly string[]): void {
  for (const command of commands) {
    expect(command).not.toMatch(
      /\bgit (add|commit|push|checkout -b|switch -c)\b/,
    );
  }
}

export async function git(cwd: string, args: string[]): Promise<void> {
  const process = Bun.spawn(["git", ...args], {
    cwd,
    stdout: "pipe",
    stderr: "pipe",
  });
  const exitCode = await process.exited;
  if (exitCode !== 0) {
    throw new Error(await new Response(process.stderr).text());
  }
}

export async function gitOutput(cwd: string, args: string[]): Promise<string> {
  const process = Bun.spawn(["git", ...args], {
    cwd,
    stdout: "pipe",
    stderr: "pipe",
  });
  const [exitCode, stdout, stderr] = await Promise.all([
    process.exited,
    new Response(process.stdout).text(),
    new Response(process.stderr).text(),
  ]);
  if (exitCode !== 0) throw new Error(stderr);
  return stdout.trim();
}

export async function createOriginRepo(originPath: string): Promise<void> {
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
    "# Auth Skill\n\nUse this skill to answer questions.\n",
  );
  await git(originPath, ["add", "."]);
  await git(originPath, ["commit", "-m", "initial"]);
}

export async function createCliTestWorkspace(): Promise<CliTestWorkspace> {
  const rootDir = await mkdtemp(join(tmpdir(), "atlas-cli-test-"));
  const cacheDir = join(rootDir, ".moxel", "atlas");
  const workspace = {
    rootDir,
    originPath: join(rootDir, "origin"),
    configPath: join(rootDir, "home", ".moxel", "atlas", "config.yaml"),
    cacheDir,
    localPath: join(cacheDir, "checkouts", "github.mycorp.com/platform/docs"),
  };
  try {
    await createOriginRepo(workspace.originPath);
    return workspace;
  } catch (error) {
    await rm(rootDir, { recursive: true, force: true });
    throw error;
  }
}

export async function removeCliTestWorkspace(
  workspace: CliTestWorkspace,
): Promise<void> {
  await rm(workspace.rootDir, { recursive: true, force: true });
}
