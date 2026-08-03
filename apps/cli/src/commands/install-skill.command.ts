import { stat } from "node:fs/promises";
import type { SkillRecord } from "@atlas/store";
import { readBooleanOption, readStringOption } from "../runtime/args";
import type { CliCommandContext, CliCommandResult } from "../runtime/types";
import { CliError, EXIT_INPUT_ERROR } from "../utils/errors";
import {
	installSkills,
	SkillInstallError,
	type SkillInstallScope,
	type SkillInstallTarget,
} from "../utils/skill-install";
import {
	inspectArtifacts,
	loadDependenciesFromGlobal,
	renderRows,
	renderSuccess,
} from "./shared";

/** Installs discovered ATLAS skills into supported agent and editor instruction locations. */
export async function runInstallSkillCommand(
	context: CliCommandContext,
): Promise<CliCommandResult> {
	const configPath = readStringOption(context, "config");
	const target = readTarget(context);
	const scope = readScope(context);
	const workspacePath = readStringOption(context, "workspace");
	const dryRun = readBooleanOption(context, "dryRun");
	const overwrite = readBooleanOption(context, "overwrite");

	const deps = await loadDependenciesFromGlobal(context, configPath);
	try {
		const artifacts = inspectArtifacts(deps.db);
		const skills = resolveSkillSelection(
			context,
			deps.config.config.repos.map((repo) => repo.repoId),
			artifacts,
		).map((record) => ({
			record,
			artifacts: artifacts.skills.listArtifacts(record.skillId),
		}));
		const result = await installSkills({
			target,
			scope,
			skills,
			cwd: context.cwd,
			workspacePath,
			homeDir: context.env.HOME ?? process.env.HOME ?? context.cwd,
			dryRun,
			overwrite,
			fileExists: exists,
		});
		const fileRows = [
			...result.writtenFiles.map((path) => ({ action: "written", path })),
			...result.wouldWriteFiles.map((path) => ({
				action: "would-write",
				path,
			})),
			...result.skippedFiles.map((path) => ({ action: "skipped", path })),
		];
		return renderSuccess(context, "install-skill", result, [
			`Installed skills: ${result.skills.length}`,
			`Target: ${result.target}`,
			`Scope: ${result.scope}`,
			renderRows(fileRows),
		]);
	} catch (error) {
		if (error instanceof SkillInstallError) {
			throw new CliError(error.message, {
				code: error.code,
				exitCode: EXIT_INPUT_ERROR,
				details: error.details,
			});
		}
		throw error;
	} finally {
		deps.close();
	}
}

function readTarget(context: CliCommandContext): SkillInstallTarget {
	const value = readStringOption(context, "target");
	if (
		value === "codex" ||
		value === "claude-code" ||
		value === "cursor" ||
		value === "vscode-copilot"
	) {
		return value;
	}
	throw new CliError(
		value === undefined
			? "install-skill requires --target codex|claude-code|cursor|vscode-copilot."
			: `Invalid install-skill target: ${value}. Expected codex|claude-code|cursor|vscode-copilot.`,
		{
			code:
				value === undefined
					? "CLI_SKILL_INSTALL_TARGET_REQUIRED"
					: "CLI_SKILL_INSTALL_TARGET_INVALID",
			exitCode: EXIT_INPUT_ERROR,
		},
	);
}

function readScope(context: CliCommandContext): SkillInstallScope {
	const value = readStringOption(context, "scope");
	if (value === "user" || value === "workspace") {
		return value;
	}
	throw new CliError(
		value === undefined
			? "install-skill requires --scope user|workspace."
			: `Invalid install-skill scope: ${value}. Expected user|workspace.`,
		{
			code:
				value === undefined
					? "CLI_SKILL_INSTALL_SCOPE_REQUIRED"
					: "CLI_SKILL_INSTALL_SCOPE_INVALID",
			exitCode: EXIT_INPUT_ERROR,
		},
	);
}

function resolveSkillSelection(
	context: CliCommandContext,
	configuredRepoIds: readonly string[],
	artifacts: ReturnType<typeof inspectArtifacts>,
): SkillRecord[] {
	const positional = context.positionals;
	const all = readBooleanOption(context, "all");
	const repoId = readStringOption(context, "repo");
	const packageId = readStringOption(context, "package");
	const moduleId = readStringOption(context, "module");
	const selectorCount = [
		positional.length > 0,
		all,
		repoId !== undefined,
		packageId !== undefined,
		moduleId !== undefined,
	].filter(Boolean).length;
	if (selectorCount !== 1) {
		throw new CliError(
			"install-skill requires exactly one selector: skill IDs, --all, --repo, --package, or --module.",
			{
				code: "CLI_SKILL_INSTALL_SELECTOR_INVALID",
				exitCode: EXIT_INPUT_ERROR,
			},
		);
	}
	if (positional.length > 0) {
		return positional.map((skillId) => {
			const skill = artifacts.skills.get(skillId);
			if (skill === undefined) {
				throw new CliError(`Unknown skill: ${skillId}.`, {
					code: "CLI_SKILL_NOT_FOUND",
					exitCode: EXIT_INPUT_ERROR,
				});
			}
			return skill;
		});
	}
	if (all) {
		return configuredRepoIds.flatMap((id) => artifacts.skills.listByRepo(id));
	}
	if (repoId !== undefined) {
		return artifacts.skills.listByRepo(repoId);
	}
	if (packageId !== undefined) {
		const pkg = artifacts.packages.get(packageId);
		if (pkg === undefined) {
			throw new CliError(`Unknown package: ${packageId}.`, {
				code: "CLI_PACKAGE_NOT_FOUND",
				exitCode: EXIT_INPUT_ERROR,
			});
		}
		return artifacts.skills.listByRepo(pkg.repoId, { packageId });
	}
	const selectedModuleId = moduleId as string;
	const module = artifacts.modules.get(selectedModuleId);
	if (module === undefined) {
		throw new CliError(`Unknown module: ${moduleId}.`, {
			code: "CLI_MODULE_NOT_FOUND",
			exitCode: EXIT_INPUT_ERROR,
		});
	}
	return artifacts.skills.listByRepo(module.repoId, {
		moduleId: selectedModuleId,
	});
}


async function exists(path: string): Promise<boolean> {
	return stat(path).then(
		() => true,
		() => false,
	);
}
