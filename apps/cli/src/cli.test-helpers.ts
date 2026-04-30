import { expect } from "bun:test";
import { stat } from "node:fs/promises";
import { join } from "node:path";
import { PassThrough } from "node:stream";
import { runCli } from "./index";
import type { CliCommandContext } from "./runtime/types";

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
): CliCommandContext {
	return {
		argv,
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
