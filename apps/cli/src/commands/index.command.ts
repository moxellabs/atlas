import { readdir, readFile, stat } from "node:fs/promises";
import { join, relative } from "node:path";
import {
	AtlasConfigNotFoundError,
	type AtlasRepoConfig,
	buildDefaultConfig,
	DEFAULT_MOXEL_ATLAS_CONFIG_RELATIVE_PATH,
	loadConfig,
	resolveIdentityProfile,
} from "@atlas/config";
import { indexLocalOnlyRepo } from "@atlas/indexer";
import { RepoCacheService } from "@atlas/source-git";
import { canUseInteractiveUi, createPrompts } from "../io/prompts";
import { buildCliDependencies } from "../runtime/dependencies";
import type { CliCommandContext, CliCommandResult } from "../runtime/types";
import { CliError, EXIT_INPUT_ERROR } from "../utils/errors";
import { resolveRepoInput } from "./repo-resolver";
import {
	appendRepoConfig,
	readArgvString,
	renderSuccess,
	writeRepoArtifactMetadata,
} from "./shared";

const WEAK_DOCS_HINT =
	"Consider running the document-codebase skill before indexing.";

export async function runIndexCommand(
	context: CliCommandContext,
): Promise<CliCommandResult> {
	const repoInput = context.argv[0];
	if (!repoInput || repoInput.startsWith("--")) {
		throw new CliError("Repo input required.", {
			code: "CLI_REPO_INPUT_REQUIRED",
			exitCode: EXIT_INPUT_ERROR,
		});
	}
	const explicitConfigPath = readArgvString(context.argv, "--config");
	const identityProfile = resolveIdentityProfile({
		cliIdentityRoot: context.identityRoot,
		envIdentityRoot: context.env.ATLAS_IDENTITY_ROOT,
	});
	let loaded: Awaited<ReturnType<typeof loadConfig>>;
	try {
		loaded = await loadConfig({
			cwd: context.cwd,
			env: context.env,
			...(explicitConfigPath === undefined
				? {}
				: { configPath: explicitConfigPath }),
		});
	} catch (error) {
		if (!(error instanceof AtlasConfigNotFoundError)) throw error;
		loaded = {
			config: buildDefaultConfig(identityProfile.runtimeRoot),
			source: {
				configPath:
					explicitConfigPath ??
					join(
						context.env.HOME ?? process.env.HOME ?? "~",
						identityProfile.runtimeRoot.startsWith("~/")
							? identityProfile.runtimeRoot.slice(2)
							: identityProfile.runtimeRoot,
						DEFAULT_MOXEL_ATLAS_CONFIG_RELATIVE_PATH,
					),
				loadedFrom:
					explicitConfigPath === undefined ? "discovered" : "explicit",
			},
			env: context.env as never,
		};
	}
	const cacheDir =
		readArgvString(context.argv, "--cache-dir") ?? loaded.config.cacheDir;
	const configPath = loaded.source.configPath;
	const hostFlag = readArgvString(context.argv, "--host");
	const resolved = await resolveRepoInput(context, loaded.config, {
		input: repoInput,
		...(hostFlag === undefined ? {} : { host: hostFlag }),
		nonInteractive: context.argv.includes("--non-interactive"),
	});
	const repoId = readArgvString(context.argv, "--repo-id") ?? resolved.repoId;
	const ref = readArgvString(context.argv, "--ref") ?? "main";
	const [host, owner, name] = repoId.split("/") as [string, string, string];
	const checkoutPath = join(
		cacheDir,
		"repos",
		host,
		owner,
		name,
		".atlas",
		"checkout",
	);
	const remote =
		resolved.remote ??
		(resolved.host.protocol === "ssh"
			? `git@${resolved.host.name}:${owner}/${name}.git`
			: `${resolved.host.webUrl}/${owner}/${name}.git`);
	const repo: AtlasRepoConfig = {
		repoId,
		mode: "local-git",
		git: { remote, localPath: checkoutPath, ref, refMode: "remote" },
		workspace: {
			packageGlobs: ["packages/*"],
			packageManifestFiles: ["package.json"],
		},
		topology: [],
	};
	const force = context.argv.includes("--force");
	const result = await indexLocalOnlyRepo({
		repo: repo as never,
		repoId,
		checkoutPath,
		globalDbPath: loaded.config.corpusDbPath,
		ref,
		forceWeakDocs: force,
		ensureCheckout: () => new RepoCacheService().ensureCache(repo as never),
		listFiles: () => listFiles(checkoutPath),
		readFile: (path) => readFile(join(checkoutPath, path)),
		buildImport: async () => {
			await appendRepoConfig(context, repo, { configPath, cacheDir });
			const deps = await buildCliDependencies({
				cwd: context.cwd,
				env: context.env,
				configPath,
			});
			try {
				return await deps.indexer.buildRepo(repoId, { force: true });
			} finally {
				deps.close();
			}
		},
	});
	if (!result.imported) {
		const lines = [
			...warningLines(result.documentationSignal.warnings),
			WEAK_DOCS_HINT,
		];
		if (
			!canUseInteractiveUi(context, {
				interactive: true,
				nonInteractive: context.argv.includes("--non-interactive"),
			})
		) {
			throw new CliError(lines.join("\n"), {
				code: "CLI_WEAK_DOCS_SIGNAL",
				exitCode: EXIT_INPUT_ERROR,
			});
		}
		const proceed = await createPrompts().confirm(
			`${lines.join("\n")}\nContinue local-only indexing?`,
			false,
		);
		if (!proceed) {
			throw new CliError(lines.join("\n"), {
				code: "CLI_WEAK_DOCS_SIGNAL",
				exitCode: EXIT_INPUT_ERROR,
			});
		}
		return runIndexCommand({ ...context, argv: [...context.argv, "--force"] });
	}
	await writeRepoArtifactMetadata(cacheDir, repoId, {
		artifactPath: null,
		indexSource: "local-only",
		checkoutPath: ".atlas/checkout",
		importStatus: "imported",
		importedAt: new Date().toISOString(),
		globalCorpusPath: "../../../../corpus.db",
		importCounts: result.counts,
		documentationSignal: { ...result.documentationSignal },
	});
	return renderSuccess(context, "index", result, [
		`Indexed ${repoId} locally only.`,
		...warningLines(result.documentationSignal.warnings),
		...(result.documentationSignal.signal === "strong" ? [] : [WEAK_DOCS_HINT]),
	]);
}

async function listFiles(root: string): Promise<string[]> {
	const out: string[] = [];
	async function walk(dir: string) {
		for (const entry of await readdir(dir)) {
			if (entry === ".git" || entry === "node_modules") continue;
			const full = join(dir, entry);
			const s = await stat(full);
			if (s.isDirectory()) await walk(full);
			else if (s.isFile()) out.push(relative(root, full).replaceAll("\\", "/"));
		}
	}
	await walk(root);
	return out;
}

function warningLines(
	warnings: Array<{ code: string; message: string }>,
): string[] {
	return warnings.map((warning) => `${warning.code}: ${warning.message}`);
}
