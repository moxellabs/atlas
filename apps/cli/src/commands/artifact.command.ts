import { join, resolve } from "node:path";
import {
	type ArtifactDiagnostic,
	inspectMoxelAtlasArtifact,
	verifyMoxelAtlasArtifact,
} from "@atlas/indexer";
import { readBooleanOption, readStringOption } from "../runtime/args";
import type { CliCommandContext, CliCommandResult } from "../runtime/types";
import { CliError, EXIT_INPUT_ERROR } from "../utils/errors";
import {
	maybeRenderArtifactRootMigrationHint,
	renderSuccess,
	resolveCliArtifactRoot,
} from "./shared";

export const CLI_ARTIFACT_VERIFY_FAILED = "CLI_ARTIFACT_VERIFY_FAILED";
export const CLI_ARTIFACT_FRESH_REF_UNAVAILABLE =
	"CLI_ARTIFACT_FRESH_REF_UNAVAILABLE";

export async function runArtifactCommand(
	context: CliCommandContext,
): Promise<CliCommandResult> {
	const [subcommand = "help"] = context.argv;
	const options = parseOptions(context.argv.slice(1));
	if (subcommand === "verify") return runVerify(context, options);
	if (subcommand === "inspect") return runInspect(context, options);
	return renderSuccess(context, "artifact", helpText(), helpText().split("\n"));
}

async function resolveArtifactCommandPath(
	context: CliCommandContext,
	options: Record<string, string | boolean | string[]>,
): Promise<{
	artifactDir: string;
	artifactLabel: string;
	artifactRoot?: string | undefined;
	migrationHint?: string | undefined;
}> {
	const explicitPath = readStringOption(options, "path");
	if (explicitPath !== undefined) {
		return {
			artifactDir: resolve(context.cwd, explicitPath),
			artifactLabel: explicitPath,
		};
	}
	const artifactRoot = await resolveCliArtifactRoot(context);
	const migrationHint = await maybeRenderArtifactRootMigrationHint({
		root: context.cwd,
		artifactRoot: artifactRoot.artifactRoot,
		customRootUsed: artifactRoot.customRootUsed,
	});
	return {
		artifactDir: artifactRoot.artifactDir,
		artifactLabel: artifactRoot.artifactRoot,
		artifactRoot: artifactRoot.artifactRoot,
		migrationHint,
	};
}

async function runVerify(
	context: CliCommandContext,
	options: Record<string, string | boolean | string[]>,
): Promise<CliCommandResult> {
	const resolved = await resolveArtifactCommandPath(context, options);
	const requireFresh = readBooleanOption(options, "fresh");
	const explicitRef = readStringOption(options, "ref");
	const freshRef = requireFresh
		? (explicitRef ??
			(await resolveCurrentHead(resolved.artifactDir, context.cwd)))
		: explicitRef;
	if (requireFresh && freshRef === undefined) {
		throw new CliError(
			"Unable to resolve current Git HEAD for artifact freshness check.",
			{ code: CLI_ARTIFACT_FRESH_REF_UNAVAILABLE, exitCode: EXIT_INPUT_ERROR },
		);
	}
	const result = await verifyMoxelAtlasArtifact({
		artifactDir: resolved.artifactDir,
		expectedRepoId: readStringOption(options, "repo-id"),
		freshRef,
		requireFresh,
	});
	const data = {
		valid: result.valid,
		artifactDir: resolved.artifactDir,
		...(resolved.artifactRoot === undefined
			? {}
			: { artifactRoot: resolved.artifactRoot }),
		repoId: result.repoId,
		manifest: result.manifest,
		checksums: result.checksum,
		safety: result.safety,
		importable: result.importable,
		counts: result.counts,
		fresh: result.fresh,
		expectedRevision: result.expectedRevision,
		indexedRevision: result.indexedRevision,
		diagnostics: result.diagnostics,
	};
	if (!result.valid) {
		throw new CliError(
			[resolved.migrationHint, formatDiagnostics(result.diagnostics)]
				.filter(Boolean)
				.join("\n"),
			{
				code: CLI_ARTIFACT_VERIFY_FAILED,
				exitCode: EXIT_INPUT_ERROR,
				details: data,
			},
		);
	}
	return renderSuccess(context, "artifact verify", data, [
		`Knowledge bundle: ${resolved.artifactLabel}`,
		`Bundle verified: ${result.repoId ?? "unknown"}`,
		"manifest: valid",
		`checksums: ${result.checksum.valid ? "valid" : "invalid"}`,
		`corpus import: ${result.importable ? "valid" : "invalid"}`,
		`safety: ${result.safety.valid ? "valid" : "invalid"}`,
		...(result.fresh === undefined ? [] : [`fresh: ${result.fresh}`]),
	]);
}

async function runInspect(
	context: CliCommandContext,
	options: Record<string, string | boolean | string[]>,
): Promise<CliCommandResult> {
	const resolved = await resolveArtifactCommandPath(context, options);
	const result = await inspectMoxelAtlasArtifact({
		artifactDir: resolved.artifactDir,
	});
	const data = {
		...result,
		artifactDir: resolved.artifactDir,
		...(resolved.artifactRoot === undefined
			? {}
			: { artifactRoot: resolved.artifactRoot }),
	};
	if (result.manifest === undefined && result.docsIndex === undefined) {
		throw new CliError(
			[resolved.migrationHint, "Artifact cannot be read."]
				.filter(Boolean)
				.join("\n"),
			{
				code: "CLI_ARTIFACT_INSPECT_FAILED",
				exitCode: EXIT_INPUT_ERROR,
				details: data,
			},
		);
	}
	return renderSuccess(context, "artifact inspect", data, [
		"Knowledge bundle",
		`  Bundle: ${resolved.artifactLabel}`,
		`  Path: ${resolved.artifactDir}`,
		"Manifest",
		`  Repo ID: ${result.manifest?.repoId ?? "unknown"}`,
		`  Ref: ${result.manifest?.ref ?? "unknown"}`,
		`  Indexed revision: ${result.manifest?.indexedRevision ?? "unknown"}`,
		`  Created at: ${result.manifest?.createdAt ?? "unknown"}`,
		`  Atlas version: ${result.manifest?.atlasVersion ?? "unknown"}`,
		`  Format version: ${result.manifest?.format.version ?? "unknown"}`,
		`  Corpus DB schema: ${result.manifest?.format.corpusDbSchemaVersion ?? "unknown"}`,
		"Files",
		...result.files.map((file) => `  ${file.path}: ${file.sizeBytes} bytes`),
		"Docs index",
		`  Documents: ${result.docsIndex?.counts.documents ?? 0}`,
		`  Skills: ${result.docsIndex?.counts.skills ?? 0}`,
		`  Packages: ${result.docsIndex?.counts.packages ?? 0}`,
		`  Modules: ${result.docsIndex?.counts.modules ?? 0}`,
		"Validation summary",
		`  checksums: ${result.checksumStatus.valid ? "valid" : "invalid"}`,
		`  safety: ${result.safetyStatus.valid ? "valid" : "invalid"}`,
	]);
}

function parseOptions(
	argv: readonly string[],
): Record<string, string | boolean | string[]> {
	const options: Record<string, string | boolean | string[]> = {};
	for (let index = 0; index < argv.length; index += 1) {
		const token = argv[index];
		if (!token?.startsWith("--")) continue;
		const key = token.slice(2);
		if (["json", "fresh"].includes(key)) {
			options[key] = true;
			continue;
		}
		options[key] = argv[index + 1] ?? "";
		index += 1;
	}
	return options;
}

async function resolveCurrentHead(
	artifactDir: string,
	cwd: string,
): Promise<string | undefined> {
	const marker = `${join(".moxel", "atlas")}`;
	const normalized = artifactDir.replaceAll("\\", "/");
	const suffix = marker.replaceAll("\\", "/");
	const repoRoot = normalized.endsWith(`/${suffix}`)
		? artifactDir.slice(0, -suffix.length - 1)
		: cwd;
	try {
		const subprocess = Bun.spawn(["git", "-C", repoRoot, "rev-parse", "HEAD"], {
			stdout: "pipe",
			stderr: "pipe",
		});
		const [exitCode, stdout] = await Promise.all([
			subprocess.exited,
			Bun.readableStreamToText(subprocess.stdout),
		]);
		if (exitCode !== 0) return undefined;
		const head = stdout.trim();
		if (head.length === 0) return undefined;
		const indexedRevision = await readArtifactIndexedRevision(artifactDir);
		if (
			indexedRevision !== undefined &&
			indexedRevision !== head &&
			(await onlyArtifactFilesChanged(repoRoot, indexedRevision, head, suffix))
		) {
			return indexedRevision;
		}
		return head;
	} catch {
		return undefined;
	}
}

async function readArtifactIndexedRevision(
	artifactDir: string,
): Promise<string | undefined> {
	try {
		const manifest = JSON.parse(
			await Bun.file(join(artifactDir, "manifest.json")).text(),
		) as { indexedRevision?: unknown };
		return typeof manifest.indexedRevision === "string"
			? manifest.indexedRevision
			: undefined;
	} catch {
		return undefined;
	}
}

async function onlyArtifactFilesChanged(
	repoRoot: string,
	fromRevision: string,
	toRevision: string,
	artifactRoot: string,
): Promise<boolean> {
	const subprocess = Bun.spawn(
		[
			"git",
			"-C",
			repoRoot,
			"diff",
			"--name-only",
			`${fromRevision}..${toRevision}`,
		],
		{ stdout: "pipe", stderr: "pipe" },
	);
	const [exitCode, stdout] = await Promise.all([
		subprocess.exited,
		Bun.readableStreamToText(subprocess.stdout),
	]);
	if (exitCode !== 0) return false;
	const changed = stdout
		.split(/\r?\n/)
		.map((line) => line.trim())
		.filter(Boolean);
	return (
		changed.length > 0 &&
		changed.every(
			(path) => path === artifactRoot || path.startsWith(`${artifactRoot}/`),
		)
	);
}

function formatDiagnostics(diagnostics: ArtifactDiagnostic[]): string {
	return diagnostics
		.map((diagnostic) => `${diagnostic.code}: ${diagnostic.message}`)
		.join("\n");
}

function helpText(): string {
	return [
		"atlas artifact <command>",
		"",
		"Verify and inspect Atlas knowledge bundles.",
		"",
		"Commands:",
		"  verify   Verify knowledge bundle (default .moxel/atlas)",
		"  inspect  Inspect knowledge bundle contents (default .moxel/atlas)",
	].join("\n");
}
