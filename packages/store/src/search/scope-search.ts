import { StoreSearchError } from "../errors";
import {
	type DocumentRow,
	documentRowSelect,
	mapDocumentRow,
} from "../docs/document-row";
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
			.all<DocumentRow>(
				`SELECT DISTINCT ${documentRowSelect("d.")}
         FROM documents d
         JOIN document_scopes ds ON ds.doc_id = d.doc_id
         WHERE ${filters.join(" AND ")}
         ORDER BY d.path
         LIMIT $limit`,
				params,
			)
			.map((row) => mapDocumentRow(row, []));
	} catch (error) {
		throw new StoreSearchError("Scope search failed.", {
			operation: "scopeSearch",
			entity: "document_scopes",
			cause: error,
		});
	}
}
