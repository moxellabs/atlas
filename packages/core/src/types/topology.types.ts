import type { Authority } from "../enums/authority.enum";
import type { DiagnosticConfidence } from "../enums/diagnostic-confidence.enum";
import type { DocKind } from "../enums/doc-kind.enum";
import type { FileEntry, ModuleNode, PackageNode } from "./repo.types";

/** Path-based topology classification rule. */
export interface TopologyRule {
	id: string;
	kind: DocKind;
	match: {
		include: string[];
		exclude?: string[];
	};
	ownership: {
		attachTo: "repo" | "package" | "module" | "skill";
		deriveFromPath?: boolean;
		packageRootPattern?: string;
		moduleRootPattern?: string;
		skillPattern?: string;
	};
	authority: Authority;
	priority: number;
}

/** Scope to which a document applies. */
export type DocScope =
	| { level: "repo"; repoId: string }
	| { level: "package"; repoId: string; packageId: string }
	| { level: "module"; repoId: string; packageId?: string; moduleId: string }
	| {
			level: "skill";
			repoId: string;
			packageId?: string;
			moduleId?: string;
			skillId: string;
	  };

/** Explanation emitted by topology classification. */
export interface ClassificationDiagnostic {
	/** Optional rule that produced the diagnostic. */
	ruleId?: string | undefined;
	/** Human-readable classification reason. */
	reason: string;
	/** Confidence in the classification decision. */
	confidence: DiagnosticConfidence;
}

/** Classified document emitted by topology packages. */
export interface ClassifiedDoc {
	docId: string;
	repoId: string;
	path: string;
	kind: DocKind;
	authority: Authority;
	scopes: DocScope[];
	packageId?: string | undefined;
	moduleId?: string | undefined;
	skillId?: string | undefined;
	diagnostics: ClassificationDiagnostic[];
}

/** Discovered skill node in a repository topology. */
export interface SkillNode {
	skillId: string;
	repoId: string;
	packageId?: string | undefined;
	moduleId?: string | undefined;
	path: string;
	title?: string | undefined;
	sourceDocPath: string;
	topics: string[];
	aliases: string[];
	tokenCount: number;
	diagnostics: ClassificationDiagnostic[];
}

/** Context passed to repository topology adapters. */
export interface TopologyContext {
	repoId: string;
	rootPath: string;
	files: FileEntry[];
	workspace: {
		rootPath: string;
		packageGlobs: string[];
		packageManifestFiles: string[];
	};
	rules: TopologyRule[];
}

/** Adapter contract for topology discovery and classification. */
export interface RepoTopologyAdapter {
	detect(ctx: TopologyContext): Promise<boolean>;
	discoverPackages(ctx: TopologyContext): Promise<PackageNode[]>;
	discoverModules(
		ctx: TopologyContext,
		packages: PackageNode[],
	): Promise<ModuleNode[]>;
	classifyDocs(
		ctx: TopologyContext,
		files: FileEntry[],
	): Promise<ClassifiedDoc[]>;
	classifySkills?(
		ctx: TopologyContext,
		files: FileEntry[],
	): Promise<SkillNode[]>;
}
