import { StoreSearchError } from "../errors";
import { decodeJsonArray } from "../json";
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
		const rows = db.all<DocumentPathRow>(
			`${baseSelect()} WHERE ${clauses.join(" AND ")} ORDER BY path LIMIT $limit`,
			params,
		);
		return rows.map(mapDocumentPathRow);
	} catch (error) {
		throw new StoreSearchError("Path search failed.", {
			operation: "pathSearch",
			entity: "documents",
			cause: error,
		});
	}
}

interface DocumentPathRow {
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

function baseSelect(): string {
	return `SELECT doc_id, repo_id, path, source_version, kind, authority, title, content_hash,
                 package_id, module_id, skill_id, description, audience_json, purpose_json, visibility, order_value, profile, tags_json
          FROM documents`;
}

function mapDocumentPathRow(row: DocumentPathRow): DocumentRecord {
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

function pathPatternFor(path: string, mode: PathSearchOptions["mode"]): string {
	const escaped = escapeLike(path);
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
