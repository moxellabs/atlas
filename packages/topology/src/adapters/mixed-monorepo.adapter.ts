import type {
	ClassifiedDoc,
	FileEntry,
	ModuleNode,
	PackageNode,
	RepoTopologyAdapter,
	SkillNode,
	TopologyContext,
} from "@atlas/core";

import { classifyDoc } from "../classifiers/classify-doc";
import { classifySkill } from "../classifiers/classify-skill";
import { discoverModules } from "../discovery/discover-modules";
import { discoverPackages } from "../discovery/discover-packages";
import { normalizeRepoPath } from "../path-utils";

/** Default topology adapter for heterogeneous monorepos. */
export class MixedMonorepoTopologyAdapter implements RepoTopologyAdapter {
	/** Detects repos with any materialized documentation-like markdown path. */
	async detect(ctx: TopologyContext): Promise<boolean> {
		return ctx.files.some(
			(file) => file.type === "file" && isDocumentationPath(file.path),
		);
	}

	/** Discovers package nodes from workspace manifest configuration. */
	async discoverPackages(ctx: TopologyContext): Promise<PackageNode[]> {
		return discoverPackages({
			repoId: ctx.repoId,
			rootPath: ctx.rootPath,
			files: ctx.files,
			workspace: ctx.workspace,
		});
	}

	/** Discovers module nodes from module-local docs and rule hints. */
	async discoverModules(
		ctx: TopologyContext,
		packages: PackageNode[],
	): Promise<ModuleNode[]> {
		return discoverModules({
			repoId: ctx.repoId,
			files: ctx.files,
			packages,
			rules: ctx.rules,
		});
	}

	/** Classifies all documentation files in the repo context. */
	async classifyDocs(
		ctx: TopologyContext,
		files: FileEntry[] = ctx.files,
	): Promise<ClassifiedDoc[]> {
		const packages = await this.discoverPackages(ctx);
		const modules = await this.discoverModules(ctx, packages);
		return files
			.filter((file) => file.type === "file" && isDocumentationPath(file.path))
			.map((file) =>
				classifyDoc({
					repoId: ctx.repoId,
					path: file.path,
					rules: ctx.rules,
					packages,
					modules,
				}),
			)
			.filter((doc): doc is ClassifiedDoc => doc !== undefined)
			.sort((left, right) => left.path.localeCompare(right.path));
	}

	/** Classifies all skill artifacts in the repo context. */
	async classifySkills(
		ctx: TopologyContext,
		files: FileEntry[] = ctx.files,
	): Promise<SkillNode[]> {
		const packages = await this.discoverPackages(ctx);
		const modules = await this.discoverModules(ctx, packages);
		return files
			.filter((file) => file.type === "file")
			.map((file) =>
				classifySkill({
					repoId: ctx.repoId,
					path: file.path,
					packages,
					modules,
					rules: ctx.rules,
				}),
			)
			.filter((skill): skill is SkillNode => skill !== undefined)
			.sort((left, right) => left.path.localeCompare(right.path));
	}
}

function isDocumentationPath(path: string): boolean {
	const normalizedPath = normalizeRepoPath(path);
	const lowerPath = normalizedPath.toLowerCase();
	return (
		normalizedPath.endsWith(".md") &&
		(lowerPath === "readme.md" ||
			lowerPath.endsWith("/readme.md") ||
			normalizedPath.startsWith("docs/") ||
			normalizedPath.startsWith("skills/") ||
			normalizedPath.includes("/docs/"))
	);
}
