import { Buffer } from "node:buffer";
import {
	buildDocSummary,
	buildModuleSummary,
	buildOutline,
	type CompilerDiagnostic,
	compileMarkdownDocument,
	extractSkill,
} from "@atlas/compiler";
import type { RepoConfig } from "@atlas/core";
import {
	type CanonicalDocument,
	type FileEntry,
	type SummaryArtifact,
	stableHash,
	stableJson,
} from "@atlas/core";
import type { DocumentRecord, SkillArtifactRecord } from "@atlas/store";
import { chunkBySection, createTextEncoder } from "@atlas/tokenizer";

import { IndexerBuildError } from "../errors/indexer-errors";
import type { IndexerDependencies } from "../services/create-indexer-services";
import type {
	AffectedDocs,
	RebuildArtifacts,
	RebuiltDocument,
} from "../types/indexer.types";

/** Rebuilds the selected document set for one repository into in-memory artifacts. */
export async function rebuildDocs(
	repo: RepoConfig,
	affected: AffectedDocs,
	currentRevision: string,
	deps: IndexerDependencies,
): Promise<RebuildArtifacts> {
	try {
		const source = deps.getSourceAdapter(repo);
		const files = await source.listFiles(repo);
		const rebuiltDocs: RebuiltDocument[] = [];

		for (const classifiedDoc of affected.selectedDocs) {
			const sourceFile = await source.readFile(repo, classifiedDoc.path);
			const compiled = compileMarkdownDocument({
				markdown: sourceFile.content,
				classifiedDoc,
				sourceVersion: currentRevision,
				metadataRules: repo.docs?.metadata.rules,
			});
			const chunked = chunkBySection({
				document: compiled.canonical.document,
				options: deps.chunking,
			});
			const shortSummary = buildDocSummary(compiled.canonical.document, {
				level: "short",
			});
			const shortSummaryArtifact = withExactSummaryTokenCount(
				shortSummary.summary,
			);
			const mediumSummary = buildDocSummary(compiled.canonical.document, {
				level: "medium",
			});
			const mediumSummaryArtifact = withExactSummaryTokenCount(
				mediumSummary.summary,
			);
			const outline = buildOutline(compiled.canonical.document);
			const outlineSummary = createOutlineSummary(
				compiled.canonical.document,
				outline.outline,
			);
			const skillNode = affected.skillsBySourceDocPath.get(classifiedDoc.path);
			const extractedSkill = skillNode
				? extractSkill({
						skill: skillNode,
						classifiedDoc,
						document: compiled.canonical.document,
						frontmatter: compiled.parsed.frontmatter.data,
					})
				: undefined;
			const skillSummary = extractedSkill?.skill.description
				? createSkillSummary(
						extractedSkill.skill.skillId,
						extractedSkill.skill.description,
					)
				: undefined;
			const skillArtifacts =
				skillNode === undefined
					? []
					: await readSkillArtifacts(
							repo,
							skillNode.sourceDocPath,
							skillNode.skillId,
							files,
							source,
						);

			rebuiltDocs.push({
				classifiedDoc,
				document: compiled.canonical.document,
				chunks: chunked.chunks,
				documentSummaries: [
					shortSummaryArtifact,
					mediumSummaryArtifact,
					outlineSummary,
				],
				...(skillNode === undefined ? {} : { skillNode }),
				...(extractedSkill === undefined
					? {}
					: { extractedSkill: extractedSkill.skill }),
				...(skillSummary === undefined ? {} : { skillSummary }),
				skillArtifacts,
				outlineSummary,
				compilerDiagnostics: [
					...compiled.parsed.diagnostics,
					...compiled.normalized.diagnostics,
					...compiled.canonical.diagnostics,
					...shortSummary.diagnostics,
					...mediumSummary.diagnostics,
					...outline.diagnostics,
					...(extractedSkill?.diagnostics ?? []),
				] satisfies CompilerDiagnostic[],
				chunkingDiagnostics: chunked.diagnostics,
			});
		}

		const moduleSummaries = buildAffectedModuleSummaries(
			repo.repoId,
			affected.affectedModuleIds,
			rebuiltDocs,
			affected,
			deps,
		);
		return {
			repoId: repo.repoId,
			packages: affected.packages,
			modules: affected.modules,
			selectedDocs: rebuiltDocs,
			deletedStoredDocIds: affected.deletedStoredDocIds,
			deletedStoredSkillIds: affected.deletedStoredSkillIds,
			moduleSummaries,
		};
	} catch (cause) {
		throw new IndexerBuildError(`Failed to rebuild docs for ${repo.repoId}.`, {
			operation: "rebuildDocs",
			stage: "compile",
			repoId: repo.repoId,
			cause,
		});
	}
}

async function readSkillArtifacts(
	repo: RepoConfig,
	sourceDocPath: string,
	skillId: string,
	files: readonly FileEntry[],
	source: ReturnType<IndexerDependencies["getSourceAdapter"]>,
): Promise<SkillArtifactRecord[]> {
	const root = skillRoot(sourceDocPath);
	const artifactPaths = files
		.filter((entry) => entry.type === "file")
		.map((entry) => entry.path)
		.filter((path) => path.startsWith(`${root}/`) && path !== sourceDocPath)
		.sort((left, right) => left.localeCompare(right));

	const artifacts: SkillArtifactRecord[] = [];
	for (const path of artifactPaths) {
		const sourceFile = await source.readFile(repo, path);
		const relativePath = path.slice(root.length + 1);
		artifacts.push({
			skillId,
			path: relativePath,
			kind: classifyArtifact(relativePath),
			contentHash: stableHash(sourceFile.content),
			sizeBytes: Buffer.byteLength(sourceFile.content, "utf8"),
			mimeType: mimeTypeFor(relativePath),
			content: sourceFile.content,
		});
	}
	return artifacts;
}

function skillRoot(sourceDocPath: string): string {
	const marker = sourceDocPath.endsWith("/SKILL.md")
		? "/SKILL.md"
		: sourceDocPath.endsWith("/skill.md")
			? "/skill.md"
			: undefined;
	if (marker !== undefined) {
		return sourceDocPath.slice(0, -marker.length);
	}
	const lastSlash = sourceDocPath.lastIndexOf("/");
	return lastSlash === -1 ? "" : sourceDocPath.slice(0, lastSlash);
}

function classifyArtifact(path: string): SkillArtifactRecord["kind"] {
	if (path.startsWith("scripts/")) {
		return "script";
	}
	if (path.startsWith("references/")) {
		return "reference";
	}
	if (path.startsWith("agents/")) {
		return "agent-profile";
	}
	return "other";
}

function mimeTypeFor(path: string): string {
	if (path.endsWith(".md")) {
		return "text/markdown";
	}
	if (path.endsWith(".json")) {
		return "application/json";
	}
	if (path.endsWith(".yaml") || path.endsWith(".yml")) {
		return "application/yaml";
	}
	if (path.endsWith(".py")) {
		return "text/x-python";
	}
	if (path.endsWith(".ts")) {
		return "text/typescript";
	}
	if (path.endsWith(".js")) {
		return "text/javascript";
	}
	return "text/plain";
}

function buildAffectedModuleSummaries(
	repoId: string,
	moduleIds: string[],
	rebuiltDocs: RebuiltDocument[],
	affected: AffectedDocs,
	deps: IndexerDependencies,
): SummaryArtifact[] {
	return moduleIds.map((moduleId) => {
		const rebuiltIds = new Set(rebuiltDocs.map((doc) => doc.document.docId));
		const selected = rebuiltDocs
			.filter((doc) => doc.document.metadata.moduleId === moduleId)
			.map((doc) => doc.document);
		const retained = deps.store.docs
			.listByRepo(repoId)
			.filter(
				(doc: DocumentRecord) =>
					doc.moduleId === moduleId &&
					!rebuiltIds.has(doc.docId) &&
					!affected.deletedStoredDocIds.includes(doc.docId),
			)
			.map((doc: DocumentRecord) => restoreCanonicalDocument(doc, deps));
		return withExactSummaryTokenCount(
			buildModuleSummary([...selected, ...retained], { moduleId }).summary,
		);
	});
}

function restoreCanonicalDocument(
	doc: DocumentRecord,
	deps: IndexerDependencies,
): CanonicalDocument {
	return {
		docId: doc.docId,
		repoId: doc.repoId,
		path: doc.path,
		sourceVersion: doc.sourceVersion,
		...(doc.title === undefined ? {} : { title: doc.title }),
		kind: doc.kind,
		authority: doc.authority,
		scopes: doc.scopes,
		sections: deps.store.sections.listByDocument(doc.docId).map((section) => ({
			sectionId: section.sectionId,
			headingPath: section.headingPath,
			ordinal: section.ordinal,
			text: section.text,
			codeBlocks: section.codeBlocks,
		})),
		metadata: {
			...(doc.packageId === undefined ? {} : { packageId: doc.packageId }),
			...(doc.moduleId === undefined ? {} : { moduleId: doc.moduleId }),
			...(doc.skillId === undefined ? {} : { skillId: doc.skillId }),
			...(doc.description === undefined
				? {}
				: { description: doc.description }),
			...(doc.order === undefined ? {} : { order: doc.order }),
			...(doc.profile === undefined ? {} : { profile: doc.profile }),
			audience: doc.audience,
			purpose: doc.purpose,
			visibility: doc.visibility,
			tags: doc.tags,
		},
	};
}

function createOutlineSummary(
	document: CanonicalDocument,
	outline: ReturnType<typeof buildOutline>["outline"],
): SummaryArtifact {
	const text = outline
		.map((entry) =>
			entry.headingPath.length === 0 ? "(root)" : entry.headingPath.join(" > "),
		)
		.join("\n");
	return {
		summaryId: `summary_${stableHash(stableJson({ targetType: "document", targetId: document.docId, level: "outline" })).slice(0, 24)}`,
		targetType: "document",
		targetId: document.docId,
		level: "outline",
		text,
		tokenCount: countSummaryTokens(text),
	};
}

function createSkillSummary(
	skillId: string,
	description: string,
): SummaryArtifact {
	return withExactSummaryTokenCount({
		summaryId: `summary_${stableHash(stableJson({ targetType: "skill", targetId: skillId, level: "short" })).slice(0, 24)}`,
		targetType: "skill",
		targetId: skillId,
		level: "short",
		text: description,
		tokenCount: 0,
	});
}

function withExactSummaryTokenCount(summary: SummaryArtifact): SummaryArtifact {
	return {
		...summary,
		tokenCount: countSummaryTokens(summary.text),
	};
}

function countSummaryTokens(text: string): number {
	return text.length === 0 ? 0 : summaryEncoder.count(text);
}

const summaryEncoder = createTextEncoder();
