import type { SourceMode } from "../enums";
import type { SourceChange } from "./change.types";
import type {
	AtlasDocAudience,
	AtlasDocMetadataProfile,
	AtlasDocPurpose,
	AtlasDocVisibility,
} from "./doc.types";
import type { TopologyRule } from "./topology.types";

/** Repository source mode. */
export type RepoMode = SourceMode;

/** Resolved repository configuration consumed by source adapters. */
export interface RepoConfig {
	/** Stable machine-safe repository identifier. */
	repoId: string;
	/** Source acquisition mode. */
	mode: RepoMode;
	/** Optional processing priority. Higher-level packages define ordering semantics. */
	priority?: number | undefined;
	/** Local Git source configuration for `local-git` repos. */
	git?:
		| {
				remote: string;
				localPath: string;
				ref: string;
		  }
		| undefined;
	/** GitHub Enterprise API source configuration for `ghes-api` repos. */
	github?:
		| {
				baseUrl: string;
				owner: string;
				name: string;
				ref: string;
		  }
		| undefined;
	/** Repository workspace metadata. */
	workspace: WorkspaceConfig;
	/** Topology classification rules for this repo. */
	topology: TopologyRule[];
	/** Document metadata classification rules and profiles. */
	docs?: RepoDocsConfig | undefined;
}

/** Workspace metadata associated with a repository. */
export interface RepoDocsConfig {
	metadata: {
		rules: DocMetadataRule[];
		profiles: Record<string, AtlasDocMetadataProfile>;
	};
}

export interface DocMetadataRule {
	id: string;
	match: { include: string[]; exclude?: string[] | undefined };
	metadata: {
		title?: string | undefined;
		description?: string | undefined;
		audience?: AtlasDocAudience[] | undefined;
		purpose?: AtlasDocPurpose[] | undefined;
		visibility?: AtlasDocVisibility | undefined;
		order?: number | undefined;
	};
	priority: number;
}

export interface WorkspaceConfig {
	/** Local workspace root path used by topology and compiler packages. */
	rootPath: string;
	/** Glob patterns that identify package root directories. */
	packageGlobs: string[];
	/** Manifest file names that identify packages inside package roots. */
	packageManifestFiles: string[];
	/** Optional package manager hint. */
	packageManager?: "bun" | "npm" | "pnpm" | "yarn" | undefined;
}

/** Resolved source revision for a repository ref. */
export interface RepoRevision {
	/** Stable repository identifier. */
	repoId: string;
	/** Source ref that was resolved. */
	ref: string;
	/** Immutable source revision identifier, typically a commit SHA. */
	revision: string;
}

/** Materialized source tree entry. */
export interface FileEntry {
	/** Repository-relative POSIX path. */
	path: string;
	/** Entry kind. */
	type: "file" | "dir";
}

/** UTF-8 source file content read from an adapter. */
export interface SourceFile {
	/** Repository-relative POSIX path. */
	path: string;
	/** UTF-8 file content. */
	content: string;
}

/** Backward-compatible alias for source changes returned by adapters. */
export type PathDiff = SourceChange;

/** Shared source adapter contract implemented by source packages. */
export interface RepoSourceAdapter {
	getRevision(repo: RepoConfig): Promise<RepoRevision>;
	listFiles(repo: RepoConfig): Promise<FileEntry[]>;
	readFile(repo: RepoConfig, path: string): Promise<SourceFile>;
	diffPaths(
		repo: RepoConfig,
		from: string,
		to: string,
	): Promise<SourceChange[]>;
}

/** Discovered package node in a repository topology. */
export interface PackageNode {
	packageId: string;
	repoId: string;
	name: string;
	path: string;
	manifestPath: string;
}

/** Discovered module node in a repository topology. */
export interface ModuleNode {
	moduleId: string;
	repoId: string;
	packageId?: string | undefined;
	name: string;
	path: string;
}
