import { ChunkRepository } from "@atlas/store";
import type { CliCommandContext, CliCommandResult } from "../runtime/types";
import { CliError, EXIT_INPUT_ERROR } from "../utils/errors";
import {
	inspectLiveTopology,
	renderLiveTopologyLines,
} from "../utils/live-topology";
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
	const mode = resolveInspectMode(context.argv);
	if (!mode) {
		throw new CliError(
			"inspect requires a subcommand: manifest, freshness, repo, topology, retrieval, doc, section, or skill.",
			{
				code: "CLI_INSPECT_MODE_REQUIRED",
				exitCode: EXIT_INPUT_ERROR,
			},
		);
	}

	if (mode === "topology" && hasFlag(context.argv, "--live")) {
		const repoId = readTopologyRepoId(context.argv);
		const result = await inspectLiveTopology({
			cwd: context.cwd,
			...(readArgvString(context.argv, "--config") === undefined
				? {}
				: { configPath: readArgvString(context.argv, "--config") }),
			...(repoId === undefined ? {} : { repoId }),
		});
		return renderSuccess(
			context,
			"inspect",
			result,
			renderLiveTopologyLines(result),
		);
	}

	const deps = await loadDependenciesFromGlobal(
		context,
		readArgvString(context.argv, "--config"),
	);
	try {
		const artifacts = inspectArtifacts(deps.db);
		if (mode === "manifest") {
			return renderSuccess(context, "inspect", artifacts.manifests.list(), []);
		}
		if (mode === "freshness") {
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
		if (mode === "repo") {
			const repoId = context.argv[1];
			if (!repoId) {
				throw new CliError("inspect repo requires <repoId>.", {
					code: "CLI_REPO_REQUIRED",
					exitCode: EXIT_INPUT_ERROR,
				});
			}
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
		if (mode === "topology") {
			const repoId = context.argv[1] ?? readArgvString(context.argv, "--repo");
			if (!repoId) {
				throw new CliError("inspect topology requires <repoId> or --repo.", {
					code: "CLI_REPO_REQUIRED",
					exitCode: EXIT_INPUT_ERROR,
				});
			}
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
		if (mode === "retrieval") {
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
				inspectRetrievalPlan(
					deps,
					query,
					readArgvString(context.argv, "--repo"),
				),
			);
		}
		if (mode === "doc") {
			const docId = context.argv[1];
			if (!docId) {
				throw new CliError("inspect doc requires <docId>.", {
					code: "CLI_DOC_REQUIRED",
					exitCode: EXIT_INPUT_ERROR,
				});
			}
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
				chunks: new ChunkRepository(deps.db).listByDocument(docId),
				summaries: artifacts.summaries.listForTarget("document", docId),
			});
		}
		if (mode === "section") {
			const sectionId = context.argv[1];
			if (!sectionId) {
				throw new CliError("inspect section requires <sectionId>.", {
					code: "CLI_SECTION_REQUIRED",
					exitCode: EXIT_INPUT_ERROR,
				});
			}
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
				chunks: new ChunkRepository(deps.db)
					.listByDocument(section.docId)
					.filter((chunk) => chunk.sectionId === section.sectionId),
			});
		}
		if (mode === "skill") {
			const skillId = context.argv[1];
			if (!skillId) {
				throw new CliError("inspect skill requires <skillId>.", {
					code: "CLI_SKILL_REQUIRED",
					exitCode: EXIT_INPUT_ERROR,
				});
			}
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
		throw new CliError(`Unknown inspect subcommand: ${mode}.`, {
			code: "CLI_UNKNOWN_INSPECT_SUBCOMMAND",
			exitCode: EXIT_INPUT_ERROR,
		});
	} finally {
		deps.close();
	}
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
