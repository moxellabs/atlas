import type { DocScope } from "@atlas/core";

import { decodeJsonArray } from "../json";
import type { DocumentRecord } from "../types";

export interface DocumentRow {
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

export const DOCUMENT_ROW_COLUMNS = [
	"doc_id",
	"repo_id",
	"path",
	"source_version",
	"kind",
	"authority",
	"title",
	"content_hash",
	"package_id",
	"module_id",
	"skill_id",
	"description",
	"audience_json",
	"purpose_json",
	"visibility",
	"order_value",
	"profile",
	"tags_json",
] as const;

export function documentRowSelect(prefix = ""): string {
	return DOCUMENT_ROW_COLUMNS.map((column) => `${prefix}${column}`).join(", ");
}

export function mapDocumentRow(
	row: DocumentRow,
	scopes: DocScope[],
	jsonColumnPrefix = "documents",
): DocumentRecord {
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
			`${jsonColumnPrefix}.audience_json`,
		),
		purpose: decodeJsonArray<DocumentRecord["purpose"][number]>(
			row.purpose_json,
			`${jsonColumnPrefix}.purpose_json`,
		),
		visibility: row.visibility,
		...(row.order_value === null ? {} : { order: row.order_value }),
		...(row.profile === null ? {} : { profile: row.profile }),
		tags: decodeJsonArray<string>(
			row.tags_json,
			`${jsonColumnPrefix}.tags_json`,
		),
		scopes,
	};
}
