import type { RepoConfig } from "@atlas/core";
import { reindexDocumentText } from "@atlas/store";

import { IndexerPersistenceError } from "../errors/indexer-errors";
import type { IndexerDependencies } from "../services/create-indexer-services";
import type {
	BuildSelection,
	BuildStrategy,
	PersistBuildResult,
	RebuildArtifacts,
} from "../types/indexer.types";

/** Persists one repo rebuild result into the store and updates manifest state last. */
export function persistBuildResults(
	repo: RepoConfig,
	input: {
		currentRevision: string;
		strategy: BuildStrategy;
		partial: boolean;
		selection?: BuildSelection | undefined;
		artifacts: RebuildArtifacts;
	},
	deps: IndexerDependencies,
): PersistBuildResult {
	try {
		deps.db.transaction(() => {
			deps.store.repos.upsert({
				repoId: repo.repoId,
				mode: repo.mode,
				revision: input.currentRevision,
			});

			if (input.strategy === "full") {
				deps.store.packages.replaceForRepo(
					repo.repoId,
					input.artifacts.packages,
				);
				deps.store.modules.replaceForRepo(repo.repoId, input.artifacts.modules);
			} else {
				for (const pkg of input.artifacts.packages) {
					deps.store.packages.upsert(pkg);
				}
				for (const module of input.artifacts.modules) {
					deps.store.modules.upsert(module);
				}
			}

			for (const skillId of input.artifacts.deletedStoredSkillIds) {
				deps.store.skills.delete(skillId);
				deps.store.summaries.deleteForTarget("skill", skillId);
			}
			for (const docId of input.artifacts.deletedStoredDocIds) {
				deps.store.summaries.deleteForTarget("document", docId);
				deps.store.docs.delete(docId);
			}

			for (const rebuilt of input.artifacts.selectedDocs) {
				deps.store.docs.upsert(rebuilt.document);
				deps.store.sections.replaceForDocument(
					rebuilt.document.docId,
					rebuilt.document.sections,
				);
				deps.store.chunks.replaceForDocument(
					rebuilt.document.docId,
					rebuilt.chunks,
				);
				reindexDocumentText(deps.db, rebuilt.document, rebuilt.chunks);

				deps.store.summaries.replaceForTarget(
					"document",
					rebuilt.document.docId,
					rebuilt.documentSummaries,
				);

				if (rebuilt.skillNode) {
					deps.store.skills.upsert({
						node: {
							...rebuilt.skillNode,
							...(rebuilt.extractedSkill === undefined
								? {}
								: {
										title: rebuilt.extractedSkill.title,
										topics: rebuilt.extractedSkill.topics,
										aliases: rebuilt.extractedSkill.aliases,
										tokenCount: rebuilt.extractedSkill.tokenCount,
									}),
						},
						sourceDocId: rebuilt.document.docId,
						description:
							rebuilt.extractedSkill?.description ?? rebuilt.skillSummary?.text,
						headings:
							rebuilt.extractedSkill?.headings ??
							rebuilt.document.sections
								.map((section) => section.headingPath)
								.filter((heading) => heading.length > 0),
						keySections:
							rebuilt.extractedSkill?.keySections ??
							rebuilt.document.sections
								.map((section) => section.text)
								.filter((text) => text.trim().length > 0)
								.slice(0, 5),
						topics: rebuilt.extractedSkill?.topics,
						aliases: rebuilt.extractedSkill?.aliases,
						tokenCount: rebuilt.extractedSkill?.tokenCount,
						artifacts: rebuilt.skillArtifacts,
					});
					if (rebuilt.skillSummary) {
						deps.store.summaries.replaceForTarget(
							"skill",
							rebuilt.skillNode.skillId,
							[rebuilt.skillSummary],
						);
					}
				}
			}

			for (const moduleSummary of input.artifacts.moduleSummaries) {
				deps.store.summaries.replaceForTarget(
					"module",
					moduleSummary.targetId,
					[moduleSummary],
				);
			}

			if (input.partial) {
				deps.store.manifests.recordPartialBuild({
					repoId: repo.repoId,
					revision: input.currentRevision,
					selector: input.selection ?? {},
				});
			} else {
				deps.store.manifests.upsert({
					repoId: repo.repoId,
					indexedRevision: input.currentRevision,
					compilerVersion: deps.compilerVersion,
					schemaVersion: deps.storeSchemaVersion,
				});
			}
		});

		const manifest = deps.store.manifests.get(repo.repoId);
		if (!manifest) {
			throw new TypeError(`Manifest was not persisted for ${repo.repoId}.`);
		}
		return {
			manifest,
			docsPersisted: input.artifacts.selectedDocs.length,
			docsDeleted: input.artifacts.deletedStoredDocIds.length,
			chunksPersisted: input.artifacts.selectedDocs.reduce(
				(total, rebuilt) => total + rebuilt.chunks.length,
				0,
			),
			skillsUpdated: input.artifacts.selectedDocs.filter(
				(rebuilt) => rebuilt.skillNode !== undefined,
			).length,
			summariesUpdated:
				input.artifacts.selectedDocs.reduce(
					(total, rebuilt) =>
						total +
						rebuilt.documentSummaries.length +
						(rebuilt.skillSummary ? 1 : 0),
					0,
				) + input.artifacts.moduleSummaries.length,
		};
	} catch (cause) {
		throw new IndexerPersistenceError(
			`Failed to persist build results for ${repo.repoId}.`,
			{
				operation: "persistBuildResults",
				stage: "persistence",
				repoId: repo.repoId,
				cause,
			},
		);
	}
}
