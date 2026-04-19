import { StoreSearchError } from "../errors";
import { decodeJsonArray } from "../json";
import type {
	DocumentRecord,
	ScopeSearchOptions,
	StoreDatabase,
} from "../types";
import { appendMetadataFilterSql } from "./metadata-filters";

/** Returns documents matching explicit repo/package/module/skill scope constraints. */
export function scopeSearch(
	db: StoreDatabase,
	options: ScopeSearchOptions,
): DocumentRecord[] {
	const limit = options.limit ?? 100;
	const filters = ["ds.repo_id = $repoId"];
	const params: Record<string, string | number> = {
		$repoId: options.repoId,
		$limit: limit,
	};

	if (options.packageId !== undefined) {
		filters.push("ds.package_id = $packageId");
		params.$packageId = options.packageId;
	}
	if (options.moduleId !== undefined) {
		filters.push("ds.module_id = $moduleId");
		params.$moduleId = options.moduleId;
	}
	if (options.skillId !== undefined) {
		filters.push("ds.skill_id = $skillId");
		params.$skillId = options.skillId;
	}
	if (options.kind !== undefined) {
		filters.push("d.kind = $kind");
		params.$kind = options.kind;
	}
	appendMetadataFilterSql(options.filters, "d.", filters, params);

	try {
		return db
			.all<ScopeDocumentRow>(
				`SELECT DISTINCT d.doc_id, d.repo_id, d.path, d.source_version, d.kind, d.authority, d.title,
                d.content_hash, d.package_id, d.module_id, d.skill_id, d.description, d.audience_json, d.purpose_json, d.visibility, d.order_value, d.profile, d.tags_json
         FROM documents d
         JOIN document_scopes ds ON ds.doc_id = d.doc_id
         WHERE ${filters.join(" AND ")}
         ORDER BY d.path
         LIMIT $limit`,
				params,
			)
			.map(mapScopeDocumentRow);
	} catch (error) {
		throw new StoreSearchError("Scope search failed.", {
			operation: "scopeSearch",
			entity: "document_scopes",
			cause: error,
		});
	}
}

interface ScopeDocumentRow {
	doc_id: string;
	repo_id: string;
	path: string;
	source_version: string;
	kind: DocumentRecord["kind"];
	authority: DocumentRecord["authority"];
	title: string | null;
	content_hash: string;
	package_id: string | null;
	module_id: string | null;
	skill_id: string | null;
	description: string | null;
	audience_json: string;
	purpose_json: string;
	visibility: DocumentRecord["visibility"];
	order_value: number | null;
	profile: string | null;
	tags_json: string;
}

function mapScopeDocumentRow(row: ScopeDocumentRow): DocumentRecord {
	return {
		docId: row.doc_id,
		repoId: row.repo_id,
		path: row.path,
		sourceVersion: row.source_version,
		kind: row.kind,
		authority: row.authority,
		...(row.title === null ? {} : { title: row.title }),
		contentHash: row.content_hash,
		...(row.package_id === null ? {} : { packageId: row.package_id }),
		...(row.module_id === null ? {} : { moduleId: row.module_id }),
		...(row.skill_id === null ? {} : { skillId: row.skill_id }),
		...(row.description === null ? {} : { description: row.description }),
		audience: decodeJsonArray<DocumentRecord["audience"][number]>(
			row.audience_json,
			"documents.audience_json",
		),
		purpose: decodeJsonArray<DocumentRecord["purpose"][number]>(
			row.purpose_json,
			"documents.purpose_json",
		),
		visibility: row.visibility,
		...(row.order_value === null ? {} : { order: row.order_value }),
		...(row.profile === null ? {} : { profile: row.profile }),
		tags: decodeJsonArray<string>(row.tags_json, "documents.tags_json"),
		scopes: [],
	};
}
