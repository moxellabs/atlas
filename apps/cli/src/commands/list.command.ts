import { loadConfig } from "@atlas/config";
import type { CliCommandContext, CliCommandResult } from "../runtime/types";
import { CliError, EXIT_INPUT_ERROR } from "../utils/errors";
import {
	inspectArtifacts,
	loadDependenciesFromGlobal,
	readArgvString,
	renderRows,
	renderSuccess,
} from "./shared";

/** Lists configured or stored ATLAS entities quickly. */
export async function runListCommand(
	context: CliCommandContext,
): Promise<CliCommandResult> {
	const firstArg = context.argv[0];
	const subcommand =
		firstArg === undefined || firstArg.startsWith("--") ? "repos" : firstArg;
	if (subcommand === "repos") {
		const configPath = readArgvString(context.argv, "--config");
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

	const deps = await loadDependenciesFromGlobal(
		context,
		readArgvString(context.argv, "--config"),
	);
	try {
		const artifacts = inspectArtifacts(deps.db);
		if (subcommand === "packages") {
			const repoId = readArgvString(context.argv, "--repo");
			if (!repoId) {
				throw new CliError("list packages requires --repo.", {
					code: "CLI_REPO_REQUIRED",
					exitCode: EXIT_INPUT_ERROR,
				});
			}
			const rows = artifacts.packages.listByRepo(repoId).map((pkg) => ({
				packageId: pkg.packageId,
				name: pkg.name,
				path: pkg.path,
			}));
			return renderSuccess(context, "list", rows, [renderRows(rows)]);
		}
		if (subcommand === "modules") {
			const repoId = readArgvString(context.argv, "--repo");
			if (!repoId) {
				throw new CliError("list modules requires --repo.", {
					code: "CLI_REPO_REQUIRED",
					exitCode: EXIT_INPUT_ERROR,
				});
			}
			const rows = artifacts.modules.listByRepo(repoId).map((module) => ({
				moduleId: module.moduleId,
				name: module.name,
				path: module.path,
			}));
			return renderSuccess(context, "list", rows, [renderRows(rows)]);
		}
		if (subcommand === "docs") {
			const repoId = readArgvString(context.argv, "--repo");
			if (!repoId) {
				throw new CliError("list docs requires --repo.", {
					code: "CLI_REPO_REQUIRED",
					exitCode: EXIT_INPUT_ERROR,
				});
			}
			const packageId = readArgvString(context.argv, "--package");
			const moduleId = readArgvString(context.argv, "--module");
			const kind = readArgvString(context.argv, "--kind");
			const documents = artifacts.docs
				.listByRepo(repoId)
				.filter((doc) => packageId === undefined || doc.packageId === packageId)
				.filter((doc) => moduleId === undefined || doc.moduleId === moduleId)
				.filter((doc) => kind === undefined || doc.kind === kind);
			const rows = Array.from(documents, (doc) => ({
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
		if (subcommand === "sections") {
			const docId = readArgvString(context.argv, "--doc");
			if (!docId) {
				throw new CliError("list sections requires --doc.", {
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
			const rows = artifacts.sections.listByDocument(docId).map((section) => ({
				sectionId: section.sectionId,
				ordinal: section.ordinal,
				heading: section.headingPath.join(" > "),
				preview: section.text.slice(0, 120),
			}));
			return renderSuccess(context, "list", rows, [renderRows(rows)]);
		}
		if (subcommand === "freshness") {
			const repoId = readArgvString(context.argv, "--repo");
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
		if (subcommand === "skills") {
			const repoId = readArgvString(context.argv, "--repo");
			const packageId = readArgvString(context.argv, "--package");
			const moduleId = readArgvString(context.argv, "--module");
			if (packageId !== undefined && moduleId !== undefined) {
				throw new CliError(
					"list skills accepts only one of --package or --module.",
					{
						code: "CLI_INVALID_SKILL_SCOPE",
						exitCode: EXIT_INPUT_ERROR,
					},
				);
			}

			const scopedRows =
				moduleId !== undefined
					? listSkillsByModule(artifacts, moduleId)
					: packageId !== undefined
						? listSkillsByPackage(artifacts, packageId)
						: repoId !== undefined
							? artifacts.skills.listByRepo(repoId)
							: deps.config.config.repos.flatMap((repo) =>
									artifacts.skills.listByRepo(repo.repoId),
								);
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
		throw new CliError(`Unknown list subcommand: ${subcommand}.`, {
			code: "CLI_UNKNOWN_LIST_SUBCOMMAND",
			exitCode: EXIT_INPUT_ERROR,
		});
	} finally {
		deps.close();
	}
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
