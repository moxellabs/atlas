import { execFile } from "node:child_process";
import { access } from "node:fs/promises";

export async function fileExists(path: string): Promise<boolean> {
	try {
		await access(path);
		return true;
	} catch {
		return false;
	}
}

export async function runProcess(
	command: readonly string[],
	options: {
		cwd?: string | undefined;
		env?: NodeJS.ProcessEnv | undefined;
	} = {},
): Promise<{ exitCode: number; stdout: string; stderr: string }> {
	return new Promise((resolve, reject) => {
		const [file, ...args] = command;
		if (file === undefined) {
			reject(new Error("Missing command."));
			return;
		}
		execFile(
			file,
			args,
			{ cwd: options.cwd, env: options.env, encoding: "utf8" },
			(error, stdout, stderr) => {
				resolve({
					exitCode:
						error && typeof (error as { code?: unknown }).code === "number"
							? (error as { code: number }).code
							: 0,
					stdout,
					stderr,
				});
			},
		);
	});
}
