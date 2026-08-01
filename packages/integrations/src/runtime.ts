import { constants } from "node:fs";
import { access } from "node:fs/promises";
import { delimiter, extname, join } from "node:path";
import spawn from "cross-spawn";

import type { CommandResult, IntegrationCommandRunner } from "./types";

export const runIntegrationCommand: IntegrationCommandRunner = async (
  command,
  options = {},
): Promise<CommandResult> => {
  const [file, ...args] = command;
  if (file === undefined)
    return { exitCode: 1, stdout: "", stderr: "Empty command." };
  const { promise, resolve } = Promise.withResolvers<CommandResult>();
  const child = spawn(file, args, {
    shell: false,
    ...(options.cwd === undefined ? {} : { cwd: options.cwd }),
    ...(options.env === undefined ? {} : { env: options.env }),
  });
  const maxOutputBytes = 1024 * 1024;
  let stdout = "";
  let stderr = "";
  let settled = false;
  let timeoutMessage: string | undefined;
  let hardKill: ReturnType<typeof setTimeout> | undefined;
  const append = (current: string, chunk: Buffer): string =>
    Buffer.concat([Buffer.from(current, "utf8"), chunk])
      .subarray(0, maxOutputBytes)
      .toString("utf8");
  const finish = (result: CommandResult) => {
    if (settled) return;
    settled = true;
    clearTimeout(timeout);
    clearTimeout(hardKill);
    resolve(result);
  };
  child.stdout?.on("data", (chunk: Buffer) => {
    stdout = append(stdout, chunk);
    if (Buffer.byteLength(stdout) >= maxOutputBytes) child.kill();
  });
  child.stderr?.on("data", (chunk: Buffer) => {
    stderr = append(stderr, chunk);
    if (Buffer.byteLength(stderr) >= maxOutputBytes) child.kill();
  });
  child.on("error", (error) => {
    if (timeoutMessage !== undefined) return;
    finish({ exitCode: 1, stdout, stderr: stderr || error.message });
  });
  child.on("close", (code, signal) => {
    const outputExceeded =
      Buffer.byteLength(stdout) >= maxOutputBytes ||
      Buffer.byteLength(stderr) >= maxOutputBytes;
    finish({
      exitCode: code ?? 1,
      stdout,
      stderr:
        timeoutMessage ??
        (outputExceeded
          ? "Integration command output exceeded 1 MiB."
          : signal === null
            ? stderr
            : stderr || `Integration command terminated by ${signal}.`),
    });
  });
  const timeout = setTimeout(() => {
    timeoutMessage = `Integration command timed out after ${options.timeoutMs ?? 120_000}ms.`;
    if (process.platform === "win32" && child.pid !== undefined) {
      const killer = spawn(
        process.env.ComSpec ?? "cmd.exe",
        ["/d", "/s", "/c", "taskkill", "/pid", String(child.pid), "/t", "/f"],
        { shell: false, stdio: "ignore" },
      );
      killer.on("error", () => child.kill("SIGKILL"));
    } else {
      child.kill("SIGTERM");
    }
    hardKill = setTimeout(() => child.kill("SIGKILL"), 2_000);
  }, options.timeoutMs ?? 120_000);
  return promise;
};

export async function resolveExecutable(
  executable: string,
  pathValue: string | undefined,
  options: {
    readonly platform?: NodeJS.Platform;
    readonly pathExt?: string | undefined;
  } = {},
): Promise<string | undefined> {
  const platform = options.platform ?? process.platform;
  const extensions =
    platform === "win32"
      ? (options.pathExt ?? process.env.PATHEXT ?? ".COM;.EXE;.BAT;.CMD")
          .split(";")
          .map((extension) => extension.trim())
          .filter((extension) => extension.length > 0)
      : [];
  const executableHasExtension =
    platform === "win32" &&
    extensions.some(
      (extension) =>
        extension.toLowerCase() === extname(executable).toLowerCase(),
    );
  const names = executableHasExtension
    ? [executable]
    : [
        executable,
        ...extensions.map((extension) => `${executable}${extension}`),
      ];
  for (const directory of (pathValue ?? "").split(delimiter)) {
    if (directory.length === 0) continue;
    for (const name of names) {
      const candidate = join(directory, name);
      try {
        await access(
          candidate,
          platform === "win32" ? constants.F_OK : constants.X_OK,
        );
        return candidate;
      } catch {
        // Continue through executable variants and PATH entries.
      }
    }
  }
  return undefined;
}

export function extractVersion(text: string): string | undefined {
  return text.match(/\bv?(\d+\.\d+\.\d+(?:[-+][0-9A-Za-z.-]+)?)/)?.[1];
}

export function versionAtLeast(actual: string, minimum: string): boolean {
  const left = parseVersion(actual);
  const right = parseVersion(minimum);
  if (left === undefined || right === undefined) return false;
  for (let index = 0; index < 3; index += 1) {
    const difference = (left.core[index] ?? 0) - (right.core[index] ?? 0);
    if (difference !== 0) return difference > 0;
  }
  return comparePrerelease(left.prerelease, right.prerelease) >= 0;
}

interface ParsedVersion {
  readonly core: readonly [number, number, number];
  readonly prerelease: readonly string[] | undefined;
}

function parseVersion(version: string): ParsedVersion | undefined {
  const match = version.match(
    /^(\d+)\.(\d+)\.(\d+)(?:-([0-9A-Za-z.-]+))?(?:\+[0-9A-Za-z.-]+)?$/u,
  );
  if (match === null) return undefined;
  return {
    core: [Number(match[1]), Number(match[2]), Number(match[3])],
    prerelease: match[4]?.split("."),
  };
}

function comparePrerelease(
  left: readonly string[] | undefined,
  right: readonly string[] | undefined,
): number {
  if (left === undefined) return right === undefined ? 0 : 1;
  if (right === undefined) return -1;
  const length = Math.max(left.length, right.length);
  for (let index = 0; index < length; index += 1) {
    const leftPart = left[index];
    const rightPart = right[index];
    if (leftPart === undefined) return -1;
    if (rightPart === undefined) return 1;
    if (leftPart === rightPart) continue;
    const leftNumeric = /^\d+$/u.test(leftPart);
    const rightNumeric = /^\d+$/u.test(rightPart);
    if (leftNumeric && rightNumeric)
      return Number(leftPart) > Number(rightPart) ? 1 : -1;
    if (leftNumeric !== rightNumeric) return leftNumeric ? -1 : 1;
    return leftPart.localeCompare(rightPart);
  }
  return 0;
}
