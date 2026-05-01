import { normalizeRepoPath } from "@atlas/topology";
import {
	type DocumentRow,
	documentRowSelect,
	mapDocumentRow,
} from "../docs/document-row";
import { StoreSearchError } from "../errors";
import type {
	DocumentRecord,
	PathSearchOptions,
	StoreDatabase,
} from "../types";
import { appendMetadataFilterSql } from "./metadata-filters";

/** Searches documents by exact path, prefix, or path fragment. */
export function pathSearch(
	db: StoreDatabase,
	options: PathSearchOptions,
): DocumentRecord[] {
	const limit = options.limit ?? 50;
	const pathPattern = pathPatternFor(options.path, options.mode);
	const clauses = ["path LIKE $path ESCAPE '\\'"];
	const params: Record<string, string | number> = {
		$path: pathPattern,
		$limit: limit,
	};
	if (options.repoId !== undefined) {
		clauses.unshift("repo_id = $repoId");
		params.$repoId = options.repoId;
	}
	appendMetadataFilterSql(options.filters, "", clauses, params);

	try {
		const rows = db.all<DocumentRow>(
			`${baseSelect()} WHERE ${clauses.join(" AND ")} ORDER BY path LIMIT $limit`,
			params,
		);
		return rows.map((row) => mapDocumentRow(row, []));
	} catch (error) {
		throw new StoreSearchError("Path search failed.", {
			operation: "pathSearch",
			entity: "documents",
			cause: error,
		});
	}
}

function baseSelect(): string {
	return `SELECT ${documentRowSelect()} FROM documents`;
}

function pathPatternFor(path: string, mode: PathSearchOptions["mode"]): string {
	const escaped = escapeLike(normalizeRepoPath(path));
	if (mode === "exact") {
		return escaped;
	}
	if (mode === "prefix") {
		return `${escaped}%`;
	}
	return `%${escaped}%`;
}

function escapeLike(value: string): string {
	return value
		.replaceAll("\\", "\\\\")
		.replaceAll("%", "\\%")
		.replaceAll("_", "\\_");
}
