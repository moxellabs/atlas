import type { StoreDatabase } from "../types";
import { RepoRepository } from "./repo.repository";

export interface RepoCorpusCounts {
	repos: number;
	packages: number;
	modules: number;
	documents: number;
	sections: number;
	chunks: number;
	summaries: number;
	skills: number;
	manifests: number;
	ftsRows: number;
}

export interface DeleteRepoCorpusResult {
	repoId: string;
	before: RepoCorpusCounts;
	after: RepoCorpusCounts;
	deleted: RepoCorpusCounts;
}

export function countRepoCorpusRows(
	db: StoreDatabase,
	repoId: string,
): RepoCorpusCounts {
	const count = (sql: string) =>
		db.get<{ count: number }>(sql, { $repoId: repoId })?.count ?? 0;
	return {
		repos: count("SELECT COUNT(*) AS count FROM repos WHERE repo_id = $repoId"),
		packages: count(
			"SELECT COUNT(*) AS count FROM packages WHERE repo_id = $repoId",
		),
		modules: count(
			"SELECT COUNT(*) AS count FROM modules WHERE repo_id = $repoId",
		),
		documents: count(
			"SELECT COUNT(*) AS count FROM documents WHERE repo_id = $repoId",
		),
		sections: count(
			"SELECT COUNT(*) AS count FROM sections WHERE doc_id IN (SELECT doc_id FROM documents WHERE repo_id = $repoId)",
		),
		chunks: count(
			"SELECT COUNT(*) AS count FROM chunks WHERE repo_id = $repoId",
		),
		summaries:
			count(`SELECT COUNT(*) AS count FROM summaries WHERE target_id IN (
			SELECT doc_id FROM documents WHERE repo_id = $repoId
			UNION SELECT section_id FROM sections WHERE doc_id IN (SELECT doc_id FROM documents WHERE repo_id = $repoId)
			UNION SELECT chunk_id FROM chunks WHERE repo_id = $repoId
			UNION SELECT skill_id FROM skills WHERE repo_id = $repoId
			UNION SELECT package_id FROM packages WHERE repo_id = $repoId
			UNION SELECT module_id FROM modules WHERE repo_id = $repoId
		)`),
		skills: count(
			"SELECT COUNT(*) AS count FROM skills WHERE repo_id = $repoId",
		),
		manifests: count(
			"SELECT COUNT(*) AS count FROM manifests WHERE repo_id = $repoId",
		),
		ftsRows: count(
			"SELECT COUNT(*) AS count FROM fts_entries WHERE repo_id = $repoId",
		),
	};
}

export function deleteRepoCorpus(
	db: StoreDatabase,
	repoId: string,
): DeleteRepoCorpusResult {
	const before = countRepoCorpusRows(db, repoId);
	db.transaction(() => {
		db.run(
			`DELETE FROM summaries WHERE target_id IN (
			SELECT doc_id FROM documents WHERE repo_id = $repoId
			UNION SELECT section_id FROM sections WHERE doc_id IN (SELECT doc_id FROM documents WHERE repo_id = $repoId)
			UNION SELECT chunk_id FROM chunks WHERE repo_id = $repoId
			UNION SELECT skill_id FROM skills WHERE repo_id = $repoId
			UNION SELECT package_id FROM packages WHERE repo_id = $repoId
			UNION SELECT module_id FROM modules WHERE repo_id = $repoId
		)`,
			{ $repoId: repoId },
		);
		new RepoRepository(db).delete(repoId);
		db.run("DELETE FROM fts_entries WHERE repo_id = $repoId", {
			$repoId: repoId,
		});
	});
	const after = countRepoCorpusRows(db, repoId);
	return {
		repoId,
		before,
		after,
		deleted: {
			repos: before.repos - after.repos,
			packages: before.packages - after.packages,
			modules: before.modules - after.modules,
			documents: before.documents - after.documents,
			sections: before.sections - after.sections,
			chunks: before.chunks - after.chunks,
			summaries: before.summaries - after.summaries,
			skills: before.skills - after.skills,
			manifests: before.manifests - after.manifests,
			ftsRows: before.ftsRows - after.ftsRows,
		},
	};
}
