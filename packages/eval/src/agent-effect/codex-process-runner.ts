import { hermeticCodexEnvironment } from "./codex-command-policy";

export interface CodexProcessResult {
  readonly stdout: string;
  readonly stderr: string;
  readonly exitCode: number;
  readonly timedOut: boolean;
}

export async function runCodexText(
  command: string[],
  cwd: string,
  timeoutMs: number,
): Promise<string> {
  const result = await runCodexCommand(command, cwd, timeoutMs);
  if (result.exitCode !== 0 || result.timedOut) {
    throw new Error(result.stderr || result.stdout || "Command failed.");
  }
  return result.stdout;
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
