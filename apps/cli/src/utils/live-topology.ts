import { existsSync, statSync } from "node:fs";
import { opendir } from "node:fs/promises";
import { basename, join, relative, resolve, sep } from "node:path";
import { AtlasConfigNotFoundError, loadConfig } from "@atlas/config";
import type {
	ClassifiedDoc,
	FileEntry,
	ModuleNode,
	PackageNode,
	RepoConfig,
	SkillNode,
	TopologyContext,
	TopologyRule,
} from "@atlas/core";
import { selectTopologyAdapter } from "@atlas/topology";

import { topologyTemplate } from "./topology-templates";

// `.moxel` is the current repo-local artifact root; `.atlas` remains ignored only as legacy generated output.
const IGNORED_DIRECTORIES = new Set([
	".moxel",
	".atlas",
	".cache",
	".git",
	".hg",
	".next",
	".nuxt",
	".svn",
	".turbo",
	".venv",
	".vite",
	"coverage",
	"dist",
	"htmlcov",
	"lcov-report",
	"node_modules",
	"out",
	"target",
	"venv",
]);

export interface InspectLiveTopologyOptions {
	cwd: string;
	configPath?: string | undefined;
	repoId?: string | undefined;
}

export interface LiveTopologyInspection {
	source: "live";
	repo: {
		repoId: string;
		rootPath: string;
		config: "matched" | "inferred";
		packageGlobs: string[];
		packageManifestFiles: string[];
	};
	packages: PackageNode[];
	modules: ModuleNode[];
	docs: ClassifiedDoc[];
	skills: SkillNode[];
	diagnostics: Array<{ severity: "info" | "warn"; message: string }>;
}

/** Inspects a checkout topology directly from the filesystem without opening the corpus store. */
export async function inspectLiveTopology(
	options: InspectLiveTopologyOptions,
): Promise<LiveTopologyInspection> {
	const rootPath = resolve(options.cwd);
	const diagnostics: LiveTopologyInspection["diagnostics"] = [];
	const configuredRepo = await resolveConfiguredRepo(
		options,
		rootPath,
		diagnostics,
	);
	const repo = configuredRepo ?? inferRepo(rootPath, options.repoId);
	const files = await listLiveFiles(rootPath);
	const ctx: TopologyContext = {
		repoId: repo.repoId,
		rootPath,
		files,
		workspace: {
			rootPath,
			packageGlobs: repo.workspace.packageGlobs,
			packageManifestFiles: repo.workspace.packageManifestFiles,
		},
		rules: repo.topology,
	};
	const adapter = await selectTopologyAdapter(ctx);
	const packages = await adapter.discoverPackages(ctx);
	const modules = await adapter.discoverModules(ctx, packages);
	const docs = await adapter.classifyDocs(ctx, files);
	const skills = adapter.classifySkills
		? await adapter.classifySkills(ctx, files)
		: [];

	return {
		source: "live",
		repo: {
			repoId: repo.repoId,
			rootPath,
			config: configuredRepo === undefined ? "inferred" : "matched",
			packageGlobs: repo.workspace.packageGlobs,
			packageManifestFiles: repo.workspace.packageManifestFiles,
		},
		packages,
		modules,
		docs,
		skills,
		diagnostics,
	};
}

export function renderLiveTopologyLines(
	result: LiveTopologyInspection,
): string[] {
	const lines = [
		`Live topology for ${result.repo.repoId} (${result.repo.config})`,
		`Packages: ${result.packages.length}`,
		`Modules: ${result.modules.length}`,
		`Docs: ${result.docs.length}`,
		`Skills: ${result.skills.length}`,
	];
	if (result.skills.length > 0) {
		lines.push("Skills:");
		lines.push(
			...result.skills.map((skill) => {
				const scope = skill.moduleId ?? skill.packageId ?? "repo";
				return `- ${skill.path} (${scope})`;
			}),
		);
	}
	if (result.diagnostics.length > 0) {
		lines.push("Diagnostics:");
		lines.push(
			...result.diagnostics.map(
				(diagnostic) =>
					`- ${diagnostic.severity.toUpperCase()} ${diagnostic.message}`,
			),
		);
	}
	return lines;
}

async function resolveConfiguredRepo(
	options: InspectLiveTopologyOptions,
	rootPath: string,
	diagnostics: LiveTopologyInspection["diagnostics"],
): Promise<RepoConfig | undefined> {
	try {
		const resolved = await loadConfig({
			cwd: options.cwd,
			...(options.configPath === undefined
				? {}
				: { configPath: options.configPath }),
		});
		const repos = resolved.config.repos;
		const explicitRepo =
			options.repoId === undefined
				? undefined
				: repos.find((repo) => repo.repoId === options.repoId);
		if (options.repoId !== undefined && explicitRepo === undefined) {
			diagnostics.push({
				severity: "warn",
				message: `No configured repository matched ${options.repoId}; using inferred live topology defaults.`,
			});
			return undefined;
		}
		const matchedRepo =
			explicitRepo ??
			repos.find((repo) => {
				const localPath =
					repo.mode === "local-git" ? repo.git?.localPath : undefined;
				return localPath !== undefined && pathsEqual(rootPath, localPath);
			});
		if (matchedRepo === undefined) {
			return undefined;
		}
		return {
			...matchedRepo,
			workspace: {
				...matchedRepo.workspace,
				rootPath,
			},
			...(matchedRepo.mode === "local-git" && matchedRepo.git
				? {
						git: {
							...matchedRepo.git,
							localPath: rootPath,
						},
					}
				: {}),
			topology: normalizeRules(matchedRepo.topology),
		};
	} catch (error) {
		if (
			error instanceof AtlasConfigNotFoundError &&
			options.configPath === undefined
		) {
			return undefined;
		}
		throw error;
	}
}

function inferRepo(rootPath: string, repoId: string | undefined): RepoConfig {
	const inferredRepoId = repoId ?? normalizeRepoId(basename(rootPath));
	return {
		repoId: inferredRepoId,
		mode: "local-git",
		git: {
			remote: `file://${rootPath}`,
			localPath: rootPath,
			ref: "HEAD",
		},
		workspace: {
			rootPath,
			packageGlobs: inferPackageGlobs(rootPath),
			packageManifestFiles: ["package.json"],
		},
		topology: normalizeRules(topologyTemplate("mixed-monorepo")),
	};
}

function normalizeRules(rules: readonly TopologyRuleInput[]): TopologyRule[] {
	return rules.map((rule) => ({
		id: rule.id,
		kind: rule.kind,
		match: {
			include: rule.match.include,
			...(rule.match.exclude === undefined
				? {}
				: { exclude: rule.match.exclude }),
		},
		ownership: {
			attachTo: rule.ownership.attachTo,
			...(rule.ownership.deriveFromPath === undefined
				? {}
				: { deriveFromPath: rule.ownership.deriveFromPath }),
			...(rule.ownership.packageRootPattern === undefined
				? {}
				: { packageRootPattern: rule.ownership.packageRootPattern }),
			...(rule.ownership.moduleRootPattern === undefined
				? {}
				: { moduleRootPattern: rule.ownership.moduleRootPattern }),
			...(rule.ownership.skillPattern === undefined
				? {}
				: { skillPattern: rule.ownership.skillPattern }),
		},
		authority: rule.authority,
		priority: rule.priority,
	}));
}

type TopologyRuleInput = {
	id: TopologyRule["id"];
	kind: TopologyRule["kind"];
	match: {
		include: string[];
		exclude?: string[] | undefined;
	};
	ownership: {
		attachTo: TopologyRule["ownership"]["attachTo"];
		deriveFromPath?: boolean | undefined;
		packageRootPattern?: string | undefined;
		moduleRootPattern?: string | undefined;
		skillPattern?: string | undefined;
	};
	authority: TopologyRule["authority"];
	priority: number;
};

function inferPackageGlobs(rootPath: string): string[] {
	const globs: string[] = [];
	if (directoryExistsSyncLike(rootPath, "apps")) {
		globs.push("apps/*");
	}
	if (directoryExistsSyncLike(rootPath, "packages")) {
		globs.push("packages/*");
	}
	return globs.length > 0 ? globs : ["packages/*"];
}

function directoryExistsSyncLike(rootPath: string, name: string): boolean {
	const path = join(rootPath, name);
	try {
		return existsSync(path) && statSync(path).isDirectory();
	} catch {
		return false;
	}
}

async function listLiveFiles(rootPath: string): Promise<FileEntry[]> {
	const entries: FileEntry[] = [];
	await walk(rootPath, rootPath, entries);
	return entries.sort((left, right) => left.path.localeCompare(right.path));
}

async function walk(
	rootPath: string,
	directoryPath: string,
	entries: FileEntry[],
): Promise<void> {
	const directory = await opendir(directoryPath);
	for await (const entry of directory) {
		if (entry.isDirectory() && IGNORED_DIRECTORIES.has(entry.name)) {
			continue;
		}
		const absolutePath = join(directoryPath, entry.name);
		if (entry.isDirectory()) {
			await walk(rootPath, absolutePath, entries);
			continue;
		}
		if (!entry.isFile()) {
			continue;
		}
		entries.push({
			path: normalizeRelativePath(relative(rootPath, absolutePath)),
			type: "file",
		});
	}
}

function pathsEqual(left: string, right: string): boolean {
	return resolve(left) === resolve(right);
}

function normalizeRelativePath(path: string): string {
	return path.split(sep).join("/").replaceAll("\\", "/");
}

function normalizeRepoId(value: string): string {
	const normalized = value
		.trim()
		.toLowerCase()
		.replace(/[^a-z0-9_-]+/g, "-")
		.replace(/^-+|-+$/g, "");
	return normalized.length > 0 ? normalized : "repo";
}
