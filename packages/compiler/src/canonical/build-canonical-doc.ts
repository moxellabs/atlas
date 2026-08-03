import {
	ATLAS_DOC_AUDIENCES,
	ATLAS_DOC_PURPOSES,
	ATLAS_DOC_VISIBILITIES,
	BUILT_IN_DOC_METADATA_RULES,
	type CanonicalDocument,
	type CanonicalSection,
	createDocId,
	type DocMetadataRule,
	type DocumentMetadata,
	matchesAnyRepoPath,
	UNCLASSIFIED_FRONTMATTER_METADATA_RULE,
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
		input.normalized.frontmatter,
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
	frontmatter: { present: boolean; data: FrontmatterData },
	rules: readonly DocMetadataRule[],
): DocumentMetadata & { diagnostics: string[]; title?: string | undefined } {
	const data = frontmatter.data;
	const builtInRules =
		frontmatter.present && !hasAtlasMetadata(data)
			? [UNCLASSIFIED_FRONTMATTER_METADATA_RULE]
			: BUILT_IN_DOC_METADATA_RULES;
	const rule = [...builtInRules, ...rules]
		.filter(
			(candidate) =>
				matchesAnyRepoPath(path, candidate.match.include) &&
				!matchesAnyRepoPath(path, candidate.match.exclude ?? []),
		)
		.sort(
			(left, right) =>
				right.priority - left.priority || left.id.localeCompare(right.id),
		)[0];
	const metadata = rule?.metadata ?? {};
	const merged: DocumentMetadata & { title?: string | undefined } = {
		tags: [],
		...metadata,
		...(metadata.audience === undefined
			? {}
			: { audience: [...metadata.audience] }),
		...(metadata.purpose === undefined
			? {}
			: { purpose: [...metadata.purpose] }),
	};
	const diagnostics: string[] = [];
	const title = stringField(data, "title");
	if (title !== undefined) merged.title = title;
	const description = stringField(data, "description");
	if (description !== undefined) merged.description = description;
	const order = numberField(data, "order");
	if (order !== undefined) merged.order = order;
	const visibility = enumField(
		data,
		"visibility",
		ATLAS_DOC_VISIBILITIES,
		diagnostics,
	);
	if (visibility !== undefined) merged.visibility = visibility;
	const audience = enumArrayField(
		data,
		"audience",
		ATLAS_DOC_AUDIENCES,
		diagnostics,
	);
	if (audience !== undefined) merged.audience = audience;
	const purpose = enumArrayField(
		data,
		"purpose",
		ATLAS_DOC_PURPOSES,
		diagnostics,
	);
	if (purpose !== undefined) merged.purpose = purpose;
	return { ...merged, diagnostics };
}

function hasAtlasMetadata(frontmatter: FrontmatterData): boolean {
	return ["audience", "purpose", "visibility"].some(
		(field) => frontmatter[field] !== undefined,
	);
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
	allowed: readonly T[],
	diagnostics: string[],
): T | undefined {
	const value = data[field];
	if (value === undefined) return undefined;
	if (typeof value === "string" && allowed.includes(value as T))
		return value as T;
	diagnostics.push(`Invalid frontmatter ${field}: ${String(value)}.`);
	return undefined;
}

function enumArrayField<T extends string>(
	data: FrontmatterData,
	field: string,
	allowed: readonly T[],
	diagnostics: string[],
): T[] | undefined {
	const value = data[field];
	if (value === undefined) return undefined;
	const values = Array.isArray(value) ? value : [value];
	if (
		values.every(
			(entry): entry is T =>
				typeof entry === "string" && allowed.includes(entry as T),
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
