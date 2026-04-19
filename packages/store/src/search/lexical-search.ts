import { StoreSearchError } from "../errors";
import type {
	LexicalSearchHit,
	LexicalSearchOptions,
	StoreDatabase,
} from "../types";
import { appendMetadataFilterSql } from "./metadata-filters";

/** Runs lexical FTS search over documents, sections, and chunks. */
export function lexicalSearch(
	db: StoreDatabase,
	options: LexicalSearchOptions,
): LexicalSearchHit[] {
	const limit = options.limit ?? 20;
	if (options.query.trim().length === 0) {
		return [];
	}

	try {
		const clauses = ["fts_entries MATCH $query"];
		const params: Record<string, string | number> = {
			$query: toFtsQuery(options.query),
			$limit: limit,
		};
		if (options.repoId !== undefined) {
			clauses.push("f.repo_id = $repoId");
			params.$repoId = options.repoId;
		}
		appendMetadataFilterSql(options.filters, "d.", clauses, params);
		const rows = db.all<LexicalSearchRow>(
			`SELECT f.entity_type, f.entity_id, f.doc_id, f.section_id, f.chunk_id, f.repo_id, f.path, f.title, bm25(fts_entries) AS rank
       FROM fts_entries f
       JOIN documents d ON d.doc_id = f.doc_id
       WHERE ${clauses.join(" AND ")}
       ORDER BY rank, f.path, f.entity_type, f.entity_id
       LIMIT $limit`,
			params,
		);
		return rows.map(mapLexicalRow);
	} catch (error) {
		throw new StoreSearchError("Lexical search failed.", {
			operation: "lexicalSearch",
			entity: "fts_entries",
			cause: error,
		});
	}
}

function toFtsQuery(query: string): string {
	return query
		.trim()
		.split(/\s+/)
		.map((term) => `"${term.replaceAll('"', '""')}"`)
		.join(" ");
}

interface LexicalSearchRow {
	entity_type: LexicalSearchHit["entityType"];
	entity_id: string;
	doc_id: string;
	section_id: string | null;
	chunk_id: string | null;
	repo_id: string;
	path: string;
	title: string | null;
	rank: number;
}

function mapLexicalRow(row: LexicalSearchRow): LexicalSearchHit {
	return {
		entityType: row.entity_type,
		entityId: row.entity_id,
		repoId: row.repo_id,
		docId: row.doc_id,
		path: row.path,
		...(row.title === null || row.title.length === 0
			? {}
			: { title: row.title }),
		...(row.section_id === null ? {} : { sectionId: row.section_id }),
		...(row.chunk_id === null ? {} : { chunkId: row.chunk_id }),
		rank: row.rank,
	};
}
