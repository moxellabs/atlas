import { StoreRepositoryError } from "../errors";
import type { RepoRecord, StoreDatabase, UpsertRepoInput } from "../types";

/** Persists and queries repository-level store metadata. */
export class RepoRepository {
  constructor(private readonly db: StoreDatabase) {}

  /** Inserts or updates a repository revision record. */
  upsert(input: UpsertRepoInput): RepoRecord {
    const updatedAt = input.updatedAt ?? new Date().toISOString();
    this.withRepositoryErrors("upsertRepo", () => {
      this.db.run(
        `INSERT INTO repos (repo_id, mode, revision, updated_at)
         VALUES ($repoId, $mode, $revision, $updatedAt)
         ON CONFLICT(repo_id) DO UPDATE SET
           mode = excluded.mode,
           revision = excluded.revision,
           updated_at = excluded.updated_at`,
        {
          $repoId: input.repoId,
          $mode: input.mode,
          $revision: input.revision,
          $updatedAt: updatedAt
        }
      );
    });
    return { repoId: input.repoId, mode: input.mode, revision: input.revision, updatedAt };
  }

  /** Returns a repository record by ID. */
  get(repoId: string): RepoRecord | undefined {
    return this.withRepositoryErrors("getRepo", () => {
      const row = this.db.get<RepoRow>("SELECT repo_id, mode, revision, updated_at FROM repos WHERE repo_id = $repoId", {
        $repoId: repoId
      });
      return row === undefined ? undefined : mapRepoRow(row);
    });
  }

  /** Lists repositories in deterministic ID order. */
  list(): RepoRecord[] {
    return this.withRepositoryErrors("listRepos", () =>
      this.db.all<RepoRow>("SELECT repo_id, mode, revision, updated_at FROM repos ORDER BY repo_id").map(mapRepoRow)
    );
  }

  /** Deletes a repository and all dependent stored artifacts via cascades. */
  delete(repoId: string): void {
    this.withRepositoryErrors("deleteRepo", () => {
      this.db.transaction(() => {
        this.db.run("DELETE FROM fts_entries WHERE repo_id = $repoId", { $repoId: repoId });
        this.db.run("DELETE FROM repos WHERE repo_id = $repoId", { $repoId: repoId });
      });
    });
  }

  private withRepositoryErrors<T>(operation: string, action: () => T): T {
    try {
      return action();
    } catch (error) {
      throw new StoreRepositoryError("Repository persistence operation failed.", {
        operation,
        entity: "repo",
        cause: error
      });
    }
  }
}

interface RepoRow {
  repo_id: string;
  mode: RepoRecord["mode"];
  revision: string;
  updated_at: string;
}

function mapRepoRow(row: RepoRow): RepoRecord {
  return {
    repoId: row.repo_id,
    mode: row.mode,
    revision: row.revision,
    updatedAt: row.updated_at
  };
}
