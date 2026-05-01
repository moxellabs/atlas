import { readFile } from "node:fs/promises";
import { resolve } from "node:path";

export async function runCliJson(command: string[], cwd: string): Promise<Record<string, unknown>> {
	const proc = Bun.spawn(command, {
		cwd,
		stdout: "pipe",
		stderr: "pipe",
	});
	const [stdout, stderr, exitCode] = await Promise.all([
		new Response(proc.stdout).text(),
		new Response(proc.stderr).text(),
		proc.exited,
	]);
	if (exitCode !== 0) {
		throw new Error(
			`Command failed (${exitCode}): ${command.join(" ")}\n${stderr}\n${stdout}`,
		);
	}
	try {
		return JSON.parse(stdout) as Record<string, unknown>;
	} catch (error) {
		throw new Error(
			`Command did not emit JSON: ${command.join(" ")}\n${stdout}\n${stderr}\n${String(error)}`,
		);
	}
}

export function asArray(value: unknown): Record<string, unknown>[] {
	return Array.isArray(value) ? (value as Record<string, unknown>[]) : [];
}

export function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === "object" && value !== null && !Array.isArray(value);
}

export function getPath(item: Record<string, unknown>): string | undefined {
	const provenance = item.provenance;
	if (isRecord(provenance) && typeof provenance.path === "string") {
		return provenance.path;
	}
	return typeof item.path === "string" ? item.path : undefined;
}

export function uniqueStrings(values: string[]): string[] {
	return [...new Set(values)];
}

export async function buildTextHaystack(input: {
	rankedHits: Record<string, unknown>[];
	selected: Record<string, unknown>[];
	contextPacket: Record<string, unknown>;
	topPaths: string[];
	cwd: string;
}): Promise<string> {
	const localContents = await Promise.all(
		input.topPaths.map(async (path) => {
			const resolved = resolve(input.cwd, path);
			if (!(await Bun.file(resolved).exists())) {
				return "";
			}
			try {
				return await readFile(resolved, "utf8");
			} catch {
				return "";
			}
		}),
	);
	return JSON.stringify({
		rankedHits: input.rankedHits,
		selected: input.selected,
		contextPacket: input.contextPacket,
		localContents,
	}).toLowerCase();
}

