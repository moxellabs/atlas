import type { SummaryArtifact } from "@atlas/core";

import { StoreRepositoryError } from "../errors";
import type { StoreDatabase, SummaryRecord } from "../types";

/** Persists and queries summary artifacts. */
export class SummaryRepository {
  constructor(private readonly db: StoreDatabase) {}

  /** Inserts or updates one summary artifact. */
  upsert(summary: SummaryArtifact): SummaryRecord {
    this.withRepositoryErrors("upsertSummary", () => {
      this.db.run(
        `INSERT INTO summaries (summary_id, target_type, target_id, level, text, token_count)
         VALUES ($summaryId, $targetType, $targetId, $level, $text, $tokenCount)
         ON CONFLICT(summary_id) DO UPDATE SET
           target_type = excluded.target_type,
           target_id = excluded.target_id,
           level = excluded.level,
           text = excluded.text,
           token_count = excluded.token_count`,
        {
          $summaryId: summary.summaryId,
          $targetType: summary.targetType,
          $targetId: summary.targetId,
          $level: summary.level,
          $text: summary.text,
          $tokenCount: summary.tokenCount
        }
      );
    });
    return summary;
  }

  /** Replaces all summaries for a target. */
  replaceForTarget(targetType: SummaryArtifact["targetType"], targetId: string, summaries: readonly SummaryArtifact[]): SummaryRecord[] {
    this.withRepositoryErrors("replaceSummariesForTarget", () => {
      this.db.transaction(() => {
        this.db.run("DELETE FROM summaries WHERE target_type = $targetType AND target_id = $targetId", {
          $targetType: targetType,
          $targetId: targetId
        });
        for (const summary of summaries) {
          this.upsert(summary);
        }
      });
    });
    return [...summaries];
  }

  /** Lists summaries for a target in deterministic level order. */
  listForTarget(targetType: SummaryArtifact["targetType"], targetId: string): SummaryRecord[] {
    return this.withRepositoryErrors("listSummariesForTarget", () =>
      this.db
        .all<SummaryRow>(
          `SELECT summary_id, target_type, target_id, level, text, token_count
           FROM summaries
           WHERE target_type = $targetType AND target_id = $targetId
           ORDER BY level`,
          { $targetType: targetType, $targetId: targetId }
        )
        .map(mapSummaryRow)
    );
  }

  /** Reads one summary artifact by its stable ID. */
  getById(summaryId: string): SummaryRecord | undefined {
    return this.withRepositoryErrors("getSummaryById", () => {
      const row = this.db.get<SummaryRow>(
        `SELECT summary_id, target_type, target_id, level, text, token_count
         FROM summaries
         WHERE summary_id = $summaryId`,
        { $summaryId: summaryId }
      );
      return row === undefined ? undefined : mapSummaryRow(row);
    });
  }

  /** Deletes all summaries for a target. */
  deleteForTarget(targetType: SummaryArtifact["targetType"], targetId: string): void {
    this.withRepositoryErrors("deleteSummariesForTarget", () => {
      this.db.run("DELETE FROM summaries WHERE target_type = $targetType AND target_id = $targetId", {
        $targetType: targetType,
        $targetId: targetId
      });
    });
  }

  private withRepositoryErrors<T>(operation: string, action: () => T): T {
    try {
      return action();
    } catch (error) {
      throw new StoreRepositoryError("Summary persistence operation failed.", {
        operation,
        entity: "summary",
        cause: error
      });
    }
  }
}

interface SummaryRow {
  summary_id: string;
  target_type: SummaryArtifact["targetType"];
  target_id: string;
  level: SummaryArtifact["level"];
  text: string;
  token_count: number;
}

function mapSummaryRow(row: SummaryRow): SummaryRecord {
  return {
    summaryId: row.summary_id,
    targetType: row.target_type,
    targetId: row.target_id,
    level: row.level,
    text: row.text,
    tokenCount: row.token_count
  };
}
