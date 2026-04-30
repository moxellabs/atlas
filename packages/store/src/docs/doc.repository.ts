import {
	type CanonicalDocument,
	type DocScope,
	stableHash,
	stableJson,
} from "@atlas/core";

import { StoreRepositoryError } from "../errors";
import { encodeJson } from "../json";
import {
	deleteFtsEntriesForDocument,
	reindexDocumentText,
} from "../search/fts";
import type { DocumentRecord, StoreDatabase } from "../types";
import {
	type DocumentRow,
	documentRowSelect,
	mapDocumentRow,
} from "./document-row";

/** Persists and queries canonical document records and their scope rows. */
export class DocRepository {
	constructor(private readonly db: StoreDatabase) {}

	/** Inserts or updates canonical document metadata and replaces scope rows. */
	upsert(document: CanonicalDocument): DocumentRecord {
		this.withRepositoryErrors("upsertDocument", () => {
			this.db.transaction(() => {
				upsertDocumentRow(this.db, document);
				replaceDocumentScopes(this.db, document.docId, document.scopes);
			});
		});
		return toDocumentRecord(document);
	}

	/** Replaces a document, its scopes, sections, and full-text index rows in one transaction. */
	replaceCanonicalDocument(document: CanonicalDocument): DocumentRecord {
		this.withRepositoryErrors("replaceCanonicalDocument", () => {
			this.db.transaction(() => {
				upsertDocumentRow(this.db, document);
				replaceDocumentScopes(this.db, document.docId, document.scopes);
				this.db.run("DELETE FROM chunks WHERE doc_id = $docId", {
					$docId: document.docId,
				});
				this.db.run("DELETE FROM sections WHERE doc_id = $docId", {
					$docId: document.docId,
				});
				for (const section of document.sections) {
					this.db.run(
						`INSERT INTO sections (section_id, doc_id, ordinal, heading_path_json, text, code_blocks_json)
             VALUES ($sectionId, $docId, $ordinal, $headingPathJson, $text, $codeBlocksJson)`,
						{
							$sectionId: section.sectionId,
							$docId: document.docId,
							$ordinal: section.ordinal,
							$headingPathJson: encodeJson(section.headingPath),
							$text: section.text,
							$codeBlocksJson: encodeJson(section.codeBlocks),
						},
					);
				}
				reindexDocumentText(this.db, document);
			});
		});
		return toDocumentRecord(document);
	}

	/** Returns a document record by ID, including scope rows. */
	get(docId: string): DocumentRecord | undefined {
		return this.withRepositoryErrors("getDocument", () => {
			const row = this.db.get<DocumentRow>(
				`SELECT ${documentRowSelect()}
         FROM documents
         WHERE doc_id = $docId`,
				{ $docId: docId },
			);
			return row === undefined
				? undefined
				: mapDocumentRow(row, listScopes(this.db, docId), "document");
		});
	}

	/** Lists documents by repository in deterministic path order. */
	listByRepo(repoId: string): DocumentRecord[] {
		return this.withRepositoryErrors("listDocumentsByRepo", () =>
			this.db
				.all<DocumentRow>(
					`SELECT ${documentRowSelect()}
           FROM documents
           WHERE repo_id = $repoId
           ORDER BY path`,
					{ $repoId: repoId },
				)
				.map((row) =>
					mapDocumentRow(row, listScopes(this.db, row.doc_id), "document"),
				),
		);
	}

	/** Lists documents by kind within a repository. */
	listByKind(
		repoId: string,
		kind: CanonicalDocument["kind"],
	): DocumentRecord[] {
		return this.withRepositoryErrors("listDocumentsByKind", () =>
			this.db
				.all<DocumentRow>(
					`SELECT ${documentRowSelect()}
           FROM documents
           WHERE repo_id = $repoId AND kind = $kind
           ORDER BY path`,
					{ $repoId: repoId, $kind: kind },
				)
				.map((row) =>
					mapDocumentRow(row, listScopes(this.db, row.doc_id), "document"),
				),
		);
	}

	/** Lists documents for one module in deterministic path order. */
	listByModule(moduleId: string): DocumentRecord[] {
		return this.withRepositoryErrors("listDocumentsByModule", () =>
			this.db
				.all<DocumentRow>(
					`SELECT ${documentRowSelect()}
           FROM documents
           WHERE module_id = $moduleId
           ORDER BY path`,
					{ $moduleId: moduleId },
				)
				.map((row) =>
					mapDocumentRow(row, listScopes(this.db, row.doc_id), "document"),
				),
		);
	}

	/** Deletes one document and dependent sections, chunks, scopes, skills, and FTS rows. */
	delete(docId: string): void {
		this.withRepositoryErrors("deleteDocument", () => {
			this.db.transaction(() => {
				deleteFtsEntriesForDocument(this.db, docId);
				this.db.run("DELETE FROM documents WHERE doc_id = $docId", {
					$docId: docId,
				});
			});
		});
	}

	private withRepositoryErrors<T>(operation: string, action: () => T): T {
		try {
			return action();
		} catch (error) {
			throw new StoreRepositoryError("Document persistence operation failed.", {
				operation,
				entity: "document",
				cause: error,
			});
		}
	}
}

interface ScopeRow {
	scope_level: DocScope["level"];
	repo_id: string;
	package_id: string | null;
	module_id: string | null;
	skill_id: string | null;
}

function upsertDocumentRow(
	db: StoreDatabase,
	document: CanonicalDocument,
): void {
	db.run(
		`INSERT INTO documents (
       doc_id, repo_id, path, source_version, kind, authority, title, content_hash,
       package_id, module_id, skill_id, description, audience_json, purpose_json, visibility, order_value, profile, tags_json
     )
     VALUES (
       $docId, $repoId, $path, $sourceVersion, $kind, $authority, $title, $contentHash,
       $packageId, $moduleId, $skillId, $description, $audienceJson, $purposeJson, $visibility, $orderValue, $profile, $tagsJson
     )
     ON CONFLICT(doc_id) DO UPDATE SET
       repo_id = excluded.repo_id,
       path = excluded.path,
       source_version = excluded.source_version,
       kind = excluded.kind,
       authority = excluded.authority,
       title = excluded.title,
       content_hash = excluded.content_hash,
       package_id = excluded.package_id,
       module_id = excluded.module_id,
       skill_id = excluded.skill_id,
       description = excluded.description,
       audience_json = excluded.audience_json,
       purpose_json = excluded.purpose_json,
       visibility = excluded.visibility,
       order_value = excluded.order_value,
       profile = excluded.profile,
       tags_json = excluded.tags_json`,
		{
			$docId: document.docId,
			$repoId: document.repoId,
			$path: document.path,
			$sourceVersion: document.sourceVersion,
			$kind: document.kind,
			$authority: document.authority,
			$title: document.title ?? null,
			$contentHash: documentContentHash(document),
			$packageId: document.metadata.packageId ?? null,
			$moduleId: document.metadata.moduleId ?? null,
			$skillId: document.metadata.skillId ?? null,
			$description: document.metadata.description ?? null,
			$audienceJson: encodeJson(document.metadata.audience ?? ["consumer"]),
			$purposeJson: encodeJson(document.metadata.purpose ?? ["guide"]),
			$visibility: document.metadata.visibility ?? "public",
			$orderValue: document.metadata.order ?? null,
			$profile: document.metadata.profile ?? null,
			$tagsJson: encodeJson(document.metadata.tags),
		},
	);
}

function replaceDocumentScopes(
	db: StoreDatabase,
	docId: string,
	scopes: readonly DocScope[],
): void {
	db.run("DELETE FROM document_scopes WHERE doc_id = $docId", {
		$docId: docId,
	});
	for (const scope of scopes) {
		db.run(
			`INSERT INTO document_scopes (doc_id, scope_level, repo_id, package_id, module_id, skill_id)
       VALUES ($docId, $scopeLevel, $repoId, $packageId, $moduleId, $skillId)`,
			{
				$docId: docId,
				$scopeLevel: scope.level,
				$repoId: scope.repoId,
				$packageId: "packageId" in scope ? (scope.packageId ?? null) : null,
				$moduleId: "moduleId" in scope ? (scope.moduleId ?? null) : null,
				$skillId: "skillId" in scope ? scope.skillId : null,
			},
		);
	}
}

function listScopes(db: StoreDatabase, docId: string): DocScope[] {
	return db
		.all<ScopeRow>(
			`SELECT scope_level, repo_id, package_id, module_id, skill_id
       FROM document_scopes
       WHERE doc_id = $docId
       ORDER BY scope_level, package_id, module_id, skill_id`,
			{ $docId: docId },
		)
		.map(mapScopeRow);
}

function mapScopeRow(row: ScopeRow): DocScope {
	if (row.scope_level === "repo") {
		return { level: "repo", repoId: row.repo_id };
	}
	if (row.scope_level === "package" && row.package_id !== null) {
		return { level: "package", repoId: row.repo_id, packageId: row.package_id };
	}
	if (row.scope_level === "module" && row.module_id !== null) {
		return {
			level: "module",
			repoId: row.repo_id,
			...(row.package_id === null ? {} : { packageId: row.package_id }),
			moduleId: row.module_id,
		};
	}
	if (row.scope_level === "skill" && row.skill_id !== null) {
		return {
			level: "skill",
			repoId: row.repo_id,
			...(row.package_id === null ? {} : { packageId: row.package_id }),
			...(row.module_id === null ? {} : { moduleId: row.module_id }),
			skillId: row.skill_id,
		};
	}
	throw new TypeError(
		`Invalid persisted document scope for ${row.scope_level}.`,
	);
}

function toDocumentRecord(document: CanonicalDocument): DocumentRecord {
	return {
		docId: document.docId,
		repoId: document.repoId,
		path: document.path,
		sourceVersion: document.sourceVersion,
		kind: document.kind,
		authority: document.authority,
		...(document.title === undefined ? {} : { title: document.title }),
		contentHash: documentContentHash(document),
		...(document.metadata.packageId === undefined
			? {}
			: { packageId: document.metadata.packageId }),
		...(document.metadata.moduleId === undefined
			? {}
			: { moduleId: document.metadata.moduleId }),
		...(document.metadata.skillId === undefined
			? {}
			: { skillId: document.metadata.skillId }),
		...(document.metadata.description === undefined
			? {}
			: { description: document.metadata.description }),
		audience: document.metadata.audience ?? ["consumer"],
		purpose: document.metadata.purpose ?? ["guide"],
		visibility: document.metadata.visibility ?? "public",
		...(document.metadata.order === undefined
			? {}
			: { order: document.metadata.order }),
		...(document.metadata.profile === undefined
			? {}
			: { profile: document.metadata.profile }),
		tags: document.metadata.tags,
		scopes: document.scopes,
	};
}

function documentContentHash(document: CanonicalDocument): string {
	return stableHash(
		stableJson({
			path: document.path,
			title: document.title,
			sections: document.sections,
		}),
	);
}
