import type { Authority } from "../enums/authority.enum";
import type { DocKind } from "../enums/doc-kind.enum";
import type { DocScope } from "./topology.types";

export type AtlasDocVisibility = "public" | "internal";
export type AtlasDocAudience =
	| "consumer"
	| "contributor"
	| "maintainer"
	| "internal";
export type AtlasDocPurpose =
	| "guide"
	| "reference"
	| "api"
	| "architecture"
	| "operations"
	| "workflow"
	| "planning"
	| "implementation"
	| "archive"
	| "troubleshooting";

export interface AtlasDocMetadataProfile {
	description?: string | undefined;
	visibility?: AtlasDocVisibility[] | undefined;
	audience?: AtlasDocAudience[] | undefined;
	purpose?: AtlasDocPurpose[] | undefined;
	include?: string[] | undefined;
	exclude?: string[] | undefined;
}

export interface DocumentMetadata {
	description?: string | undefined;
	audience?: AtlasDocAudience[] | undefined;
	purpose?: AtlasDocPurpose[] | undefined;
	visibility?: AtlasDocVisibility | undefined;
	order?: number | undefined;
	profile?: string | undefined;
	packageId?: string | undefined;
	moduleId?: string | undefined;
	skillId?: string | undefined;
	tags: string[];
}

export interface DocumentMetadataFilters {
	profile?: string | undefined;
	audience?: AtlasDocAudience[] | undefined;
	purpose?: AtlasDocPurpose[] | undefined;
	visibility?: AtlasDocVisibility[] | undefined;
}

export const BUILT_IN_DOC_METADATA_PROFILES = {
	public: { visibility: ["public"], audience: ["consumer"] },
	contributor: {
		visibility: ["public"],
		audience: ["consumer", "contributor"],
	},
	maintainer: {
		visibility: ["public"],
		audience: ["consumer", "contributor", "maintainer"],
	},
	internal: {
		visibility: ["public", "internal"],
		audience: ["consumer", "contributor", "maintainer", "internal"],
	},
} as const satisfies Record<string, AtlasDocMetadataProfile>;

export function documentMatchesMetadataFilters(
	metadata: DocumentMetadata,
	filters: DocumentMetadataFilters | undefined,
	profiles: Record<
		string,
		AtlasDocMetadataProfile
	> = BUILT_IN_DOC_METADATA_PROFILES,
): boolean {
	if (!filters) return true;
	const profile =
		filters.profile === undefined ? undefined : profiles[filters.profile];
	if (filters.profile !== undefined && profile === undefined) return false;
	const visibility = filters.visibility ?? profile?.visibility;
	const audience = filters.audience ?? profile?.audience;
	const purpose = filters.purpose ?? profile?.purpose;
	if (
		visibility !== undefined &&
		(metadata.visibility === undefined ||
			!visibility.includes(metadata.visibility))
	)
		return false;
	if (
		audience !== undefined &&
		!(metadata.audience ?? []).some((value) => audience.includes(value))
	)
		return false;
	if (
		purpose !== undefined &&
		!(metadata.purpose ?? []).some((value) => purpose.includes(value))
	)
		return false;
	return true;
}

/** Canonical document representation shared by compiler, store, and retrieval. */
export interface CanonicalDocument {
	docId: string;
	repoId: string;
	path: string;
	sourceVersion: string;
	title?: string | undefined;
	kind: DocKind;
	authority: Authority;
	scopes: DocScope[];
	sections: CanonicalSection[];
	metadata: DocumentMetadata;
}

/** Canonical section within a parsed document. */
export interface CanonicalSection {
	sectionId: string;
	headingPath: string[];
	ordinal: number;
	text: string;
	codeBlocks: CodeBlockFragment[];
}

/** Code block fragment extracted from source documentation. */
export interface CodeBlockFragment {
	/** Optional language info string. */
	lang?: string | undefined;
	/** Raw code block contents. */
	code: string;
}
