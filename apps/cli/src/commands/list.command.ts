import { canonicalizeRepoId, loadConfig } from "@atlas/config";
import { readStringOption } from "../runtime/args";
import type { CliCommandContext, CliCommandResult } from "../runtime/types";
import { CliError, EXIT_INPUT_ERROR } from "../utils/errors";
import {
	inspectArtifacts,
	loadDependenciesFromGlobal,
	renderRows,
	renderSuccess,
} from "./shared";

/** Lists configured or stored ATLAS entities quickly. */
export async function runListCommand(
	context: CliCommandContext,
): Promise<CliCommandResult> {
	const subcommand = resolveListSubcommand(context.positionals);
	if (subcommand === "repos") {
		return listConfiguredRepos(context);
	}

	const deps = await loadDependenciesFromGlobal(
		context,
		readStringOption(context, "config"),
	);
	try {
		const artifacts = inspectArtifacts(deps.db);
		switch (subcommand) {
			case "packages":
				return listPackages(context, artifacts);
			case "modules":
				return listModules(context, artifacts);
			case "docs":
				return listDocs(context, artifacts);
			case "sections":
				return listSections(context, artifacts);
			case "freshness":
				return listFreshness(context, artifacts);
			case "skills":
				return listSkills(context, artifacts, deps.config.config.repos);
			default:
				throw new CliError(`Unknown list subcommand: ${subcommand}.`, {
					code: "CLI_UNKNOWN_LIST_SUBCOMMAND",
					exitCode: EXIT_INPUT_ERROR,
				});
		}
	} finally {
		deps.close();
	}
}

type ListArtifacts = ReturnType<typeof inspectArtifacts>;
type ConfiguredRepo = Awaited<
	ReturnType<typeof loadConfig>
>["config"]["repos"][number];

function resolveListSubcommand(argv: readonly string[]): string {
	return argv[0] ?? "repos";
}

async function listConfiguredRepos(
	context: CliCommandContext,
): Promise<CliCommandResult> {
	const configPath = readStringOption(context, "config");
	const resolved = await loadConfig({
		cwd: context.cwd,
		env: context.env,
		...(configPath === undefined ? {} : { configPath }),
	});
	const rows = resolved.config.repos.map((repo) => ({
		repoId: repo.repoId,
		mode: repo.mode,
		localPath: repo.git?.localPath ?? repo.github?.name ?? "",
	}));
	return renderSuccess(context, "list", rows, [renderRows(rows)]);
}


function resolveListRepoId(
	context: CliCommandContext,
	artifacts: ListArtifacts,
	entity: string,
): string {
	const explicit = readStringOption(context, "repo");
	if (explicit !== undefined && explicit.length > 0) {
		return canonicalizeListRepoId(explicit);
	}
	const repoIds = artifacts.repos.list().map((repo) => repo.repoId);
	if (repoIds.length === 1) {
		return repoIds[0]!;
	}
	if (repoIds.length === 0) {
		throw new CliError(
			`list ${entity} requires --repo, and no repos are indexed yet.`,
			{ code: "CLI_REPO_REQUIRED", exitCode: EXIT_INPUT_ERROR },
		);
	}
	throw new CliError(
		`list ${entity} requires --repo when multiple repositories are indexed (${repoIds.length} found).`,
		{ code: "CLI_REPO_REQUIRED", exitCode: EXIT_INPUT_ERROR },
	);
}

function canonicalizeListRepoId(repoId: string): string {
	try {
		return canonicalizeRepoId(repoId);
	} catch (error) {
		throw new CliError(
			error instanceof Error
				? error.message
				: "Repository ID must be host/owner/name.",
			{ code: "CLI_REPO_REQUIRED", exitCode: EXIT_INPUT_ERROR },
		);
	}
}

function listPackages(
	context: CliCommandContext,
	artifacts: ListArtifacts,
): Promise<CliCommandResult> {
	const repoId = resolveListRepoId(context, artifacts, "packages");
	const rows = artifacts.packages.listByRepo(repoId).map((pkg) => ({
		packageId: pkg.packageId,
		name: pkg.name,
		path: pkg.path,
	}));
	return renderSuccess(context, "list", rows, [renderRows(rows)]);
}

function listModules(
	context: CliCommandContext,
	artifacts: ListArtifacts,
): Promise<CliCommandResult> {
	const repoId = resolveListRepoId(context, artifacts, "modules");
	const rows = artifacts.modules.listByRepo(repoId).map((module) => ({
		moduleId: module.moduleId,
		name: module.name,
		path: module.path,
	}));
	return renderSuccess(context, "list", rows, [renderRows(rows)]);
}

function listDocs(
	context: CliCommandContext,
	artifacts: ListArtifacts,
): Promise<CliCommandResult> {
	const repoId = resolveListRepoId(context, artifacts, "docs");
	const packageId = readStringOption(context, "package");
	const moduleId = readStringOption(context, "module");
	const kind = readStringOption(context, "kind");
	const rows = artifacts.docs
		.listByRepo(repoId)
		.filter((doc) => packageId === undefined || doc.packageId === packageId)
		.filter((doc) => moduleId === undefined || doc.moduleId === moduleId)
		.filter((doc) => kind === undefined || doc.kind === kind)
		.map((doc) => ({
			docId: doc.docId,
			title: doc.title ?? "",
			kind: doc.kind,
			authority: doc.authority,
			path: doc.path,
			packageId: doc.packageId ?? "",
			moduleId: doc.moduleId ?? "",
		}));
	return renderSuccess(context, "list", rows, [renderRows(rows)]);
}

function listSections(
	context: CliCommandContext,
	artifacts: ListArtifacts,
): Promise<CliCommandResult> {
	const docId = readStringOption(context, "doc");
	if (docId === undefined || docId.length === 0) {
		throw new CliError("list sections requires --doc.", {
			code: "CLI_DOC_REQUIRED",
			exitCode: EXIT_INPUT_ERROR,
		});
	}
	if (artifacts.docs.get(docId) === undefined) {
		throw new CliError(`Unknown document: ${docId}.`, {
			code: "CLI_DOC_NOT_FOUND",
			exitCode: EXIT_INPUT_ERROR,
		});
	}
	const rows = artifacts.sections.listByDocument(docId).map((section) => ({
		sectionId: section.sectionId,
		ordinal: section.ordinal,
		heading: section.headingPath.join(" > "),
		preview: section.text.slice(0, 120),
	}));
	return renderSuccess(context, "list", rows, [renderRows(rows)]);
}

function listFreshness(
	context: CliCommandContext,
	artifacts: ListArtifacts,
): Promise<CliCommandResult> {
	const rawRepoId = readStringOption(context, "repo");
	const repoId =
		rawRepoId === undefined ? undefined : canonicalizeListRepoId(rawRepoId);
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
	const rows = repos.map((repo) => {
		const manifest = artifacts.manifests.get(repo.repoId);
		return {
			repoId: repo.repoId,
			repoRevision: repo.revision,
			indexedRevision: manifest?.indexedRevision ?? "",
			fresh: manifest?.indexedRevision === repo.revision,
		};
	});
	return renderSuccess(context, "list", rows, [renderRows(rows)]);
}

function listSkills(
	context: CliCommandContext,
	artifacts: ListArtifacts,
	repos: readonly ConfiguredRepo[],
): Promise<CliCommandResult> {
	const rawRepoId = readStringOption(context, "repo");
	const repoId =
		rawRepoId === undefined ? undefined : canonicalizeListRepoId(rawRepoId);
	const packageId = readStringOption(context, "package");
	const moduleId = readStringOption(context, "module");
	if (packageId !== undefined && moduleId !== undefined) {
		throw new CliError(
			"list skills accepts only one of --package or --module.",
			{ code: "CLI_INVALID_SKILL_SCOPE", exitCode: EXIT_INPUT_ERROR },
		);
	}
	const scopedRows =
		moduleId !== undefined
			? listSkillsByModule(artifacts, moduleId)
			: packageId !== undefined
				? listSkillsByPackage(artifacts, packageId)
				: repoId !== undefined
					? artifacts.skills.listByRepo(repoId)
					: repos.flatMap((repo) => artifacts.skills.listByRepo(repo.repoId));
	const rows = scopedRows.map((skill) => ({
		skillId: skill.skillId,
		title: skill.title ?? "",
		repoId: skill.repoId,
		packageId: skill.packageId ?? "",
		moduleId: skill.moduleId ?? "",
		sourceDocId: skill.sourceDocId,
	}));
	return renderSuccess(context, "list", rows, [renderRows(rows)]);
}

function listSkillsByPackage(
	artifacts: ReturnType<typeof inspectArtifacts>,
	packageId: string,
) {
	const pkg = artifacts.packages.get(packageId);
	if (!pkg) {
		throw new CliError(`Unknown package: ${packageId}.`, {
			code: "CLI_PACKAGE_NOT_FOUND",
			exitCode: EXIT_INPUT_ERROR,
		});
	}
	return artifacts.skills.listByRepo(pkg.repoId, { packageId });
}

function listSkillsByModule(
	artifacts: ReturnType<typeof inspectArtifacts>,
	moduleId: string,
) {
	const module = artifacts.modules.get(moduleId);
	if (!module) {
		throw new CliError(`Unknown module: ${moduleId}.`, {
			code: "CLI_MODULE_NOT_FOUND",
			exitCode: EXIT_INPUT_ERROR,
		});
	}
	return artifacts.skills.listByRepo(module.repoId, { moduleId });
}
