import {
	type AtlasDocAudience,
	type AtlasDocPurpose,
	type AtlasDocVisibility,
	type CanonicalDocument,
	type CanonicalSection,
	createDocId,
	type DocMetadataRule,
	type DocumentMetadata,
} from "@atlas/core";

import { compilerDiagnostic } from "../diagnostics";
import { CanonicalDocumentBuildError } from "../errors";
import { firstNonEmpty } from "../text-utils";
import type {
	BuildCanonicalDocumentInput,
	BuildCanonicalDocumentResult,
	FrontmatterData,
	NormalizedMarkdown,
	ResolvedDocumentTitle,
} from "../types";
import { buildSections } from "./build-sections";

const VISIBILITIES = new Set<AtlasDocVisibility>(["public", "internal"]);
const AUDIENCES = new Set<AtlasDocAudience>([
	"consumer",
	"contributor",
	"maintainer",
	"internal",
]);
const PURPOSES = new Set<AtlasDocPurpose>([
	"guide",
	"reference",
	"api",
	"architecture",
	"operations",
	"workflow",
	"planning",
	"implementation",
	"archive",
	"troubleshooting",
]);

/** Builds a canonical document from topology classification and normalized markdown. */
export function buildCanonicalDocument(
	input: BuildCanonicalDocumentInput,
): BuildCanonicalDocumentResult {
	assertCanonicalInput(input);
	const expectedDocId = createDocId({
		repoId: input.classifiedDoc.repoId,
		path: input.classifiedDoc.path,
	});
	const docId = input.classifiedDoc.docId || expectedDocId;
	const sectionsResult =
		input.sections === undefined
			? buildSections({ docId, normalized: input.normalized })
			: { sections: input.sections, diagnostics: [] };
	const title = resolveDocumentTitle(input.normalized, sectionsResult.sections);
	const resolvedMetadata = resolveDocumentMetadata(
		input.classifiedDoc.path,
		input.normalized.frontmatter.data,
		input.metadataRules ?? [],
	);
	const document: CanonicalDocument = {
		docId,
		repoId: input.classifiedDoc.repoId,
		path: input.classifiedDoc.path,
		sourceVersion: input.sourceVersion,
		...(title.title === undefined ? {} : { title: title.title }),
		kind: input.classifiedDoc.kind,
		authority: input.classifiedDoc.authority,
		scopes: input.classifiedDoc.scopes,
		sections: sectionsResult.sections,
		metadata: {
			...(input.classifiedDoc.packageId === undefined
				? {}
				: { packageId: input.classifiedDoc.packageId }),
			...(input.classifiedDoc.moduleId === undefined
				? {}
				: { moduleId: input.classifiedDoc.moduleId }),
			...(input.classifiedDoc.skillId === undefined
				? {}
				: { skillId: input.classifiedDoc.skillId }),
			...(resolvedMetadata.description === undefined
				? {}
				: { description: resolvedMetadata.description }),
			...(resolvedMetadata.order === undefined
				? {}
				: { order: resolvedMetadata.order }),
			...(resolvedMetadata.profile === undefined
				? {}
				: { profile: resolvedMetadata.profile }),
			audience: resolvedMetadata.audience,
			purpose: resolvedMetadata.purpose,
			visibility: resolvedMetadata.visibility,
			tags: extractTags(input.normalized.frontmatter.data),
		},
	};

	return {
		document,
		title,
		diagnostics: [
			...sectionsResult.diagnostics,
			...resolvedMetadata.diagnostics.map((message) =>
				compilerDiagnostic({
					stage: "canonical",
					code: "ATLAS_DOC_METADATA_INVALID_FRONTMATTER",
					message,
					path: input.classifiedDoc.path,
					docId,
				}),
			),
			compilerDiagnostic({
				stage: "canonical",
				code: `title.${title.source}`,
				message:
					title.source === "none"
						? "No document title was found."
						: `Selected document title from ${title.source}.`,
				path: input.classifiedDoc.path,
				docId,
			}),
			compilerDiagnostic({
				stage: "canonical",
				code: "canonical.document",
				message: `Built canonical document with ${sectionsResult.sections.length} section(s).`,
				path: input.classifiedDoc.path,
				docId,
			}),
		],
	};
}

/** Resolves a document title with precedence: frontmatter title, first H1, first heading, none. */
export function resolveDocumentTitle(
	normalized: NormalizedMarkdown,
	sections: readonly CanonicalSection[],
): ResolvedDocumentTitle {
	const frontmatterTitle = stringField(normalized.frontmatter.data, "title");
	if (frontmatterTitle !== undefined) {
		return { title: frontmatterTitle, source: "frontmatter" };
	}

	const firstH1 = firstNonEmpty(
		normalized.blocks.map((block) =>
			block.type === "heading" && block.depth === 1 ? block.text : undefined,
		),
	);
	if (firstH1 !== undefined) {
		return { title: firstH1, source: "h1" };
	}

	const firstHeading = firstNonEmpty(
		sections.map((section) => section.headingPath.at(-1)),
	);
	if (firstHeading !== undefined) {
		return { title: firstHeading, source: "heading" };
	}

	return { source: "none" };
}

function resolveDocumentMetadata(
	path: string,
	frontmatter: FrontmatterData,
	rules: readonly DocMetadataRule[],
): DocumentMetadata & { diagnostics: string[]; title?: string | undefined } {
	const base = defaultMetadataFor(path);
	const rule = [...rules]
		.filter(
			(candidate) =>
				matchesAny(path, candidate.match.include) &&
				!matchesAny(path, candidate.match.exclude ?? []),
		)
		.sort(
			(left, right) =>
				right.priority - left.priority || left.id.localeCompare(right.id),
		)[0];
	const merged: DocumentMetadata & { title?: string | undefined } = {
		...base,
		...(rule?.metadata.title === undefined
			? {}
			: { title: rule.metadata.title }),
		...(rule?.metadata.description === undefined
			? {}
			: { description: rule.metadata.description }),
		...(rule?.metadata.order === undefined
			? {}
			: { order: rule.metadata.order }),
		...(rule?.metadata.audience === undefined
			? {}
			: { audience: [...rule.metadata.audience] }),
		...(rule?.metadata.purpose === undefined
			? {}
			: { purpose: [...rule.metadata.purpose] }),
		...(rule?.metadata.visibility === undefined
			? {}
			: { visibility: rule.metadata.visibility }),
	};
	const diagnostics: string[] = [];
	const title = stringField(frontmatter, "title");
	if (title !== undefined) merged.title = title;
	const description = stringField(frontmatter, "description");
	if (description !== undefined) merged.description = description;
	const order = numberField(frontmatter, "order");
	if (order !== undefined) merged.order = order;
	const visibility = enumField(
		frontmatter,
		"visibility",
		VISIBILITIES,
		diagnostics,
	);
	if (visibility !== undefined) merged.visibility = visibility;
	const audience = enumArrayField(
		frontmatter,
		"audience",
		AUDIENCES,
		diagnostics,
	);
	if (audience !== undefined) merged.audience = audience;
	const purpose = enumArrayField(frontmatter, "purpose", PURPOSES, diagnostics);
	if (purpose !== undefined) merged.purpose = purpose;
	return { ...merged, diagnostics };
}

function defaultMetadataFor(path: string): DocumentMetadata {
	if (matchesGlob(path, "docs/archive/**"))
		return {
			visibility: "internal",
			audience: ["internal"],
			purpose: ["archive"],
			tags: [],
		};
	if (matchesGlob(path, ".planning/**"))
		return {
			visibility: "internal",
			audience: ["internal"],
			purpose: ["planning", "implementation"],
			tags: [],
		};
	if (path === "README.md" || path.endsWith("/README.md"))
		return {
			visibility: "public",
			audience: ["consumer"],
			purpose: ["guide"],
			tags: [],
		};
	if (matchesGlob(path, "docs/**"))
		return {
			visibility: "public",
			audience: ["consumer"],
			purpose: ["guide", "reference"],
			tags: [],
		};
	if (matchesGlob(path, "skills/**"))
		return {
			visibility: "public",
			audience: ["consumer"],
			purpose: ["workflow"],
			tags: [],
		};
	return {
		visibility: "internal",
		audience: ["contributor"],
		purpose: ["implementation"],
		tags: [],
	};
}

function matchesAny(path: string, patterns: readonly string[]): boolean {
	return patterns.some((pattern) => matchesGlob(path, pattern));
}

function matchesGlob(path: string, pattern: string): boolean {
	if (pattern.endsWith("/**"))
		return (
			path === pattern.slice(0, -3) || path.startsWith(pattern.slice(0, -2))
		);
	if (pattern.includes("*")) {
		const regex = new RegExp(
			`^${pattern.split("*").map(escapeRegExp).join(".*")}$`,
		);
		return regex.test(path);
	}
	return path === pattern;
}

function escapeRegExp(value: string): string {
	return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function assertCanonicalInput(input: BuildCanonicalDocumentInput): void {
	if (input.classifiedDoc.repoId.trim().length === 0) {
		throw new CanonicalDocumentBuildError(
			"Classified document repoId is required.",
			{
				path: input.classifiedDoc.path,
				docId: input.classifiedDoc.docId,
				sourceVersion: input.sourceVersion,
			},
		);
	}
	if (input.classifiedDoc.path.trim().length === 0) {
		throw new CanonicalDocumentBuildError(
			"Classified document path is required.",
			{
				docId: input.classifiedDoc.docId,
				sourceVersion: input.sourceVersion,
			},
		);
	}
	if (input.sourceVersion.trim().length === 0) {
		throw new CanonicalDocumentBuildError("Source version is required.", {
			path: input.classifiedDoc.path,
			docId: input.classifiedDoc.docId,
		});
	}
}

function stringField(data: FrontmatterData, field: string): string | undefined {
	const value = data[field];
	return typeof value === "string" && value.trim().length > 0
		? value.trim()
		: undefined;
}

function numberField(data: FrontmatterData, field: string): number | undefined {
	const value = data[field];
	return typeof value === "number" && Number.isInteger(value)
		? value
		: undefined;
}

function enumField<T extends string>(
	data: FrontmatterData,
	field: string,
	allowed: ReadonlySet<T>,
	diagnostics: string[],
): T | undefined {
	const value = data[field];
	if (value === undefined) return undefined;
	if (typeof value === "string" && allowed.has(value as T)) return value as T;
	diagnostics.push(`Invalid frontmatter ${field}: ${String(value)}.`);
	return undefined;
}

function enumArrayField<T extends string>(
	data: FrontmatterData,
	field: string,
	allowed: ReadonlySet<T>,
	diagnostics: string[],
): T[] | undefined {
	const value = data[field];
	if (value === undefined) return undefined;
	const values = Array.isArray(value) ? value : [value];
	if (
		values.every(
			(entry): entry is T =>
				typeof entry === "string" && allowed.has(entry as T),
		)
	) {
		return [...new Set(values)].sort();
	}
	diagnostics.push(`Invalid frontmatter ${field}: ${JSON.stringify(value)}.`);
	return undefined;
}

function extractTags(data: FrontmatterData): string[] {
	const value = data.tags;
	if (Array.isArray(value)) {
		return [
			...new Set(
				value
					.filter((tag): tag is string => typeof tag === "string")
					.map((tag) => tag.trim())
					.filter(Boolean),
			),
		].sort();
	}
	if (typeof value === "string") {
		return [
			...new Set(
				value
					.split(",")
					.map((tag) => tag.trim())
					.filter(Boolean),
			),
		].sort();
	}
	return [];
}
