import { ChunkRepository } from "@atlas/store";
import type { CliCommandContext, CliCommandResult } from "../runtime/types";
import { CliError, EXIT_INPUT_ERROR } from "../utils/errors";
import {
	inspectLiveTopology,
	renderLiveTopologyLines,
} from "../utils/live-topology";
import { readRepoTargetArg, resolveRepoTarget } from "./repo-target";
import {
	inspectArtifacts,
	inspectRetrievalPlan,
	loadDependenciesFromGlobal,
	readArgvString,
	renderSuccess,
} from "./shared";

/** Inspects local ATLAS store and retrieval state without mutating it. */
export async function runInspectCommand(
	context: CliCommandContext,
): Promise<CliCommandResult> {
	const mode = requireInspectMode(context.argv);
	if (mode === "topology" && hasFlag(context.argv, "--live")) {
		return inspectLiveTopologyCommand(context);
	}

	const deps = await loadDependenciesFromGlobal(
		context,
		readArgvString(context.argv, "--config"),
	);
	try {
		const artifacts = inspectArtifacts(deps.db);
		switch (mode) {
			case "manifest":
				return renderSuccess(
					context,
					"inspect",
					artifacts.manifests.list(),
					[],
				);
			case "freshness":
				return inspectFreshness(context, artifacts);
			case "repo":
				return inspectRepo(context, artifacts, deps.config.config);
			case "topology":
				return inspectTopology(context, artifacts, deps.config.config);
			case "retrieval":
				return inspectRetrieval(context, deps);
			case "doc":
				return inspectDoc(context, artifacts, deps.db);
			case "section":
				return inspectSection(context, artifacts, deps.db);
			case "skill":
				return inspectSkill(context, artifacts);
			default:
				throw new CliError(`Unknown inspect subcommand: ${mode}.`, {
					code: "CLI_UNKNOWN_INSPECT_SUBCOMMAND",
					exitCode: EXIT_INPUT_ERROR,
				});
		}
	} finally {
		deps.close();
	}
}

type InspectArtifacts = ReturnType<typeof inspectArtifacts>;
type InspectDependencies = Awaited<
	ReturnType<typeof loadDependenciesFromGlobal>
>;
type InspectConfig = InspectDependencies["config"]["config"];
type InspectDb = InspectDependencies["db"];

function requireInspectMode(argv: readonly string[]): string {
	const mode = resolveInspectMode(argv);
	if (mode !== undefined) return mode;
	throw new CliError(
		"inspect requires a subcommand: manifest, freshness, repo, topology, retrieval, doc, section, or skill.",
		{ code: "CLI_INSPECT_MODE_REQUIRED", exitCode: EXIT_INPUT_ERROR },
	);
}

async function inspectLiveTopologyCommand(
	context: CliCommandContext,
): Promise<CliCommandResult> {
	const configPath = readArgvString(context.argv, "--config");
	const repoId = readTopologyRepoId(context.argv);
	const result = await inspectLiveTopology({
		cwd: context.cwd,
		...(configPath === undefined ? {} : { configPath }),
		...(repoId === undefined ? {} : { repoId }),
	});
	return renderSuccess(
		context,
		"inspect",
		result,
		renderLiveTopologyLines(result),
	);
}

function inspectFreshness(
	context: CliCommandContext,
	artifacts: InspectArtifacts,
): Promise<CliCommandResult> {
	const repoId = context.argv[1];
	const repos =
		repoId === undefined
			? artifacts.repos.list()
			: [artifacts.repos.get(repoId)].filter((repo) => repo !== undefined);
	if (repoId !== undefined && repos.length === 0) {
		throw new CliError(`Unknown repository: ${repoId}.`, {
			code: "CLI_REPO_NOT_FOUND",
			exitCode: EXIT_INPUT_ERROR,
		});
	}
	return renderSuccess(
		context,
		"inspect",
		repos.map((repo) => {
			const manifest = artifacts.manifests.get(repo.repoId);
			return {
				repoId: repo.repoId,
				repoRevision: repo.revision,
				indexedRevision: manifest?.indexedRevision,
				fresh: manifest?.indexedRevision === repo.revision,
				repo,
				manifest,
			};
		}),
	);
}

async function inspectRepo(
	context: CliCommandContext,
	artifacts: InspectArtifacts,
	config: InspectConfig,
): Promise<CliCommandResult> {
	const repoId = (
		await resolveInspectRepoTarget(context, config, "inspect repo")
	).repoId;
	const repo = artifacts.repos.get(repoId);
	if (repo === undefined) {
		throw new CliError(`Unknown repository: ${repoId}.`, {
			code: "CLI_REPO_NOT_FOUND",
			exitCode: EXIT_INPUT_ERROR,
		});
	}
	return renderSuccess(context, "inspect", {
		repo,
		manifest: artifacts.manifests.get(repoId),
		packages: artifacts.packages.listByRepo(repoId),
		modules: artifacts.modules.listByRepo(repoId),
		docs: artifacts.docs.listByRepo(repoId),
		skills: artifacts.skills.listByRepo(repoId),
	});
}

async function inspectTopology(
	context: CliCommandContext,
	artifacts: InspectArtifacts,
	config: InspectConfig,
): Promise<CliCommandResult> {
	const repoId = (
		await resolveInspectRepoTarget(context, config, "inspect topology")
	).repoId;
	if (artifacts.repos.get(repoId) === undefined) {
		throw new CliError(`Unknown repository: ${repoId}.`, {
			code: "CLI_REPO_NOT_FOUND",
			exitCode: EXIT_INPUT_ERROR,
		});
	}
	return renderSuccess(context, "inspect", {
		packages: artifacts.packages.listByRepo(repoId),
		modules: artifacts.modules.listByRepo(repoId),
		docs: artifacts.docs.listByRepo(repoId),
		skills: artifacts.skills.listByRepo(repoId),
	});
}

function resolveInspectRepoTarget(
	context: CliCommandContext,
	config: InspectConfig,
	command: string,
) {
	return resolveRepoTarget(context, {
		config,
		...readRepoTargetArg(context.argv, 1),
		command,
		nonInteractive: context.argv.includes("--non-interactive"),
	});
}

function inspectRetrieval(
	context: CliCommandContext,
	deps: InspectDependencies,
): Promise<CliCommandResult> {
	const query = readArgvString(context.argv, "--query");
	if (!query) {
		throw new CliError("inspect retrieval requires --query.", {
			code: "CLI_QUERY_REQUIRED",
			exitCode: EXIT_INPUT_ERROR,
		});
	}
	return renderSuccess(
		context,
		"inspect",
		inspectRetrievalPlan(deps, query, readArgvString(context.argv, "--repo")),
	);
}

function inspectDoc(
	context: CliCommandContext,
	artifacts: InspectArtifacts,
	db: InspectDb,
): Promise<CliCommandResult> {
	const docId = requiredInspectPositional(
		context.argv,
		"inspect doc requires <docId>.",
		"CLI_DOC_REQUIRED",
	);
	const document = artifacts.docs.get(docId);
	if (document === undefined) {
		throw new CliError(`Unknown document: ${docId}.`, {
			code: "CLI_DOC_NOT_FOUND",
			exitCode: EXIT_INPUT_ERROR,
		});
	}
	return renderSuccess(context, "inspect", {
		document,
		sections: artifacts.sections.listByDocument(docId),
		chunks: new ChunkRepository(db).listByDocument(docId),
		summaries: artifacts.summaries.listForTarget("document", docId),
	});
}

function inspectSection(
	context: CliCommandContext,
	artifacts: InspectArtifacts,
	db: InspectDb,
): Promise<CliCommandResult> {
	const sectionId = requiredInspectPositional(
		context.argv,
		"inspect section requires <sectionId>.",
		"CLI_SECTION_REQUIRED",
	);
	const section = artifacts.sections.getById(sectionId);
	if (section === undefined) {
		throw new CliError(`Unknown section: ${sectionId}.`, {
			code: "CLI_SECTION_NOT_FOUND",
			exitCode: EXIT_INPUT_ERROR,
		});
	}
	return renderSuccess(context, "inspect", {
		section,
		document: artifacts.docs.get(section.docId),
		chunks: new ChunkRepository(db)
			.listByDocument(section.docId)
			.filter((chunk) => chunk.sectionId === section.sectionId),
	});
}

function inspectSkill(
	context: CliCommandContext,
	artifacts: InspectArtifacts,
): Promise<CliCommandResult> {
	const skillId = requiredInspectPositional(
		context.argv,
		"inspect skill requires <skillId>.",
		"CLI_SKILL_REQUIRED",
	);
	const skill = artifacts.skills.get(skillId);
	if (skill === undefined) {
		throw new CliError(`Unknown skill: ${skillId}.`, {
			code: "CLI_SKILL_NOT_FOUND",
			exitCode: EXIT_INPUT_ERROR,
		});
	}
	return renderSuccess(context, "inspect", {
		skill,
		summaries: artifacts.summaries.listForTarget("skill", skillId),
	});
}

function requiredInspectPositional(
	argv: readonly string[],
	message: string,
	code: string,
): string {
	const value = argv[1];
	if (value === undefined || value.length === 0) {
		throw new CliError(message, { code, exitCode: EXIT_INPUT_ERROR });
	}
	return value;
}

function resolveInspectMode(argv: readonly string[]): string | undefined {
	const first = argv[0];
	if (first !== undefined && !first.startsWith("-")) {
		return first;
	}
	if (hasFlag(argv, "--live")) {
		return "topology";
	}
	if (readArgvString(argv, "--query") !== undefined) {
		return "retrieval";
	}
	return undefined;
}

function hasFlag(argv: readonly string[], flag: string): boolean {
	return argv.includes(flag);
}

function readTopologyRepoId(argv: readonly string[]): string | undefined {
	const repoId = argv[1];
	if (repoId !== undefined && !repoId.startsWith("--")) return repoId;
	return readArgvString(argv, "--repo");
}
