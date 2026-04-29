import type { CanonicalSection } from "@atlas/core";

import { StoreRepositoryError } from "../errors";
import { decodeJsonArray, encodeJson } from "../json";
import type { SectionRecord, StoreDatabase } from "../types";

/** Persists and queries canonical sections. */
export class SectionRepository {
	constructor(private readonly db: StoreDatabase) {}

	/** Replaces all sections for a document in source order. */
	replaceForDocument(
		docId: string,
		sections: readonly CanonicalSection[],
	): SectionRecord[] {
		this.withRepositoryErrors("replaceSectionsForDocument", () => {
			this.db.transaction(() => {
				this.db.run(
					"DELETE FROM fts_entries WHERE doc_id = $docId AND entity_type IN ('section', 'chunk')",
					{ $docId: docId },
				);
				this.db.run("DELETE FROM chunks WHERE doc_id = $docId", {
					$docId: docId,
				});
				this.db.run("DELETE FROM sections WHERE doc_id = $docId", {
					$docId: docId,
				});
				for (const section of sections) {
					insertSection(this.db, docId, section);
				}
			});
		});
		return sections.map((section) => ({ ...section, docId }));
	}

	/** Lists sections by document in ordinal order. */
	listByDocument(docId: string): SectionRecord[] {
		return this.withRepositoryErrors("listSectionsByDocument", () =>
			this.db
				.all<SectionRow>(
					`SELECT section_id, doc_id, ordinal, heading_path_json, text, code_blocks_json
           FROM sections
           WHERE doc_id = $docId
           ORDER BY ordinal`,
					{ $docId: docId },
				)
				.map(mapSectionRow),
		);
	}

	/** Returns one section by stable section ID. */
	getById(sectionId: string): SectionRecord | undefined {
		return this.withRepositoryErrors("getSectionById", () => {
			const row = this.db.get<SectionRow>(
				`SELECT section_id, doc_id, ordinal, heading_path_json, text, code_blocks_json
         FROM sections
         WHERE section_id = $sectionId`,
				{ $sectionId: sectionId },
			);
			return row === undefined ? undefined : mapSectionRow(row);
		});
	}

	/** Deletes all sections and dependent chunks for one document. */
	deleteForDocument(docId: string): void {
		this.withRepositoryErrors("deleteSectionsForDocument", () => {
			this.db.transaction(() => {
				this.db.run(
					"DELETE FROM fts_entries WHERE doc_id = $docId AND entity_type IN ('section', 'chunk')",
					{ $docId: docId },
				);
				this.db.run("DELETE FROM chunks WHERE doc_id = $docId", {
					$docId: docId,
				});
				this.db.run("DELETE FROM sections WHERE doc_id = $docId", {
					$docId: docId,
				});
			});
		});
	}

	private withRepositoryErrors<T>(operation: string, action: () => T): T {
		try {
			return action();
		} catch (error) {
			throw new StoreRepositoryError("Section persistence operation failed.", {
				operation,
				entity: "section",
				cause: error,
			});
		}
	}
}

interface SectionRow {
	section_id: string;
	doc_id: string;
	ordinal: number;
	heading_path_json: string;
	text: string;
	code_blocks_json: string;
}

function insertSection(
	db: StoreDatabase,
	docId: string,
	section: CanonicalSection,
): void {
	db.run(
		`INSERT INTO sections (section_id, doc_id, ordinal, heading_path_json, text, code_blocks_json)
     VALUES ($sectionId, $docId, $ordinal, $headingPathJson, $text, $codeBlocksJson)`,
		{
			$sectionId: section.sectionId,
			$docId: docId,
			$ordinal: section.ordinal,
			$headingPathJson: encodeJson(section.headingPath),
			$text: section.text,
			$codeBlocksJson: encodeJson(section.codeBlocks),
		},
	);
}

function mapSectionRow(row: SectionRow): SectionRecord {
	return {
		sectionId: row.section_id,
		docId: row.doc_id,
		ordinal: row.ordinal,
		headingPath: decodeJsonArray<string>(
			row.heading_path_json,
			"sections.heading_path_json",
		),
		text: row.text,
		codeBlocks: decodeJsonArray(
			row.code_blocks_json,
			"sections.code_blocks_json",
		),
	};
}
