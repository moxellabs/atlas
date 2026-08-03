import { ChunkRepository } from "@atlas/store";
import { readBooleanOption, readStringOption } from "../runtime/args";
import type { CliCommandContext, CliCommandResult } from "../runtime/types";
import { CliError, EXIT_INPUT_ERROR } from "../utils/errors";
import {
	inspectLiveTopology,
	renderLiveTopologyLines,
} from "../utils/live-topology";
import { loadDependenciesFromGlobal } from "./dependencies";
import { inspectArtifacts, inspectRetrievalPlan } from "./inspection";
import {
	readRepoTargetArg,
	resolveRepoIdentity,
} from "./repo-identity";
import { renderSuccess } from "./render";

/** Inspects local ATLAS store and retrieval state without mutating it. */
export async function runInspectCommand(
	context: CliCommandContext,
): Promise<CliCommandResult> {
	const mode = requireInspectMode(context);
	if (mode === "topology" && readBooleanOption(context, "live")) {
		return inspectLiveTopologyCommand(context);
	}

	const deps = await loadDependenciesFromGlobal(
		context,
		readStringOption(context, "config"),
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
				return await inspectRepo(context, artifacts, deps.config.config);
			case "topology":
				return await inspectTopology(context, artifacts, deps.config.config);
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

function requireInspectMode(context: CliCommandContext): string {
	const mode = resolveInspectMode(context);
	if (mode !== undefined) return mode;
	throw new CliError(
		"inspect requires a subcommand: manifest, freshness, repo, topology, retrieval, doc, section, or skill.",
		{ code: "CLI_INSPECT_MODE_REQUIRED", exitCode: EXIT_INPUT_ERROR },
	);
}

async function inspectLiveTopologyCommand(
	context: CliCommandContext,
): Promise<CliCommandResult> {
	const configPath = readStringOption(context, "config");
	const repoId = readTopologyRepoId(context);
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
	const repoId = context.positionals[1];
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
	return resolveRepoIdentity(context, { intent: "target", config,
		...readRepoTargetArg(context, 1),
		command,
		nonInteractive: readBooleanOption(context, "nonInteractive"), });
}

function inspectRetrieval(
	context: CliCommandContext,
	deps: InspectDependencies,
): Promise<CliCommandResult> {
	const query = readStringOption(context, "query");
	if (!query) {
		throw new CliError("inspect retrieval requires --query.", {
			code: "CLI_QUERY_REQUIRED",
			exitCode: EXIT_INPUT_ERROR,
		});
	}
	return renderSuccess(
		context,
		"inspect",
		inspectRetrievalPlan(deps, query, readStringOption(context, "repo")),
	);
}

function inspectDoc(
	context: CliCommandContext,
	artifacts: InspectArtifacts,
	db: InspectDb,
): Promise<CliCommandResult> {
	const docId = requiredInspectPositional(
		context.positionals,
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
		context.positionals,
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
		context.positionals,
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

function resolveInspectMode(context: CliCommandContext): string | undefined {
	const first = context.positionals[0];
	if (first !== undefined) {
		return first;
	}
	if (readBooleanOption(context, "live")) {
		return "topology";
	}
	if (readStringOption(context, "query") !== undefined) {
		return "retrieval";
	}
	return undefined;
}


function readTopologyRepoId(context: CliCommandContext): string | undefined {
	return context.positionals[1] ?? readStringOption(context, "repo");
}
