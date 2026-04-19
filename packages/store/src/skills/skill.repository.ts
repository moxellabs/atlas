import { StoreRepositoryError } from "../errors";
import { decodeJsonArray, encodeJson } from "../json";
import type { SkillArtifactRecord, SkillArtifactSummary, SkillRecord, StoreDatabase, UpsertSkillInput } from "../types";

/** Persists topology skill nodes and compiler-extracted skill content. */
export class SkillRepository {
  constructor(private readonly db: StoreDatabase) {}

  /** Inserts or updates one skill record. */
  upsert(input: UpsertSkillInput): SkillRecord {
    const title = input.node.title;
    const headings = input.headings ?? [];
    const keySections = input.keySections ?? [];
    const topics = input.topics ?? input.node.topics;
    const aliases = input.aliases ?? input.node.aliases;
    const tokenCount = input.tokenCount ?? input.node.tokenCount;
    this.withRepositoryErrors("upsertSkill", () => {
      this.db.run(
        `INSERT INTO skills (
           skill_id, repo_id, package_id, module_id, source_doc_id, source_doc_path,
           title, description, headings_json, key_sections_json, topics_json, aliases_json, token_count
         )
         VALUES (
           $skillId, $repoId, $packageId, $moduleId, $sourceDocId, $sourceDocPath,
           $title, $description, $headingsJson, $keySectionsJson, $topicsJson, $aliasesJson, $tokenCount
         )
         ON CONFLICT(skill_id) DO UPDATE SET
           repo_id = excluded.repo_id,
           package_id = excluded.package_id,
           module_id = excluded.module_id,
           source_doc_id = excluded.source_doc_id,
           source_doc_path = excluded.source_doc_path,
           title = excluded.title,
           description = excluded.description,
           headings_json = excluded.headings_json,
           key_sections_json = excluded.key_sections_json,
           topics_json = excluded.topics_json,
           aliases_json = excluded.aliases_json,
           token_count = excluded.token_count`,
        {
          $skillId: input.node.skillId,
          $repoId: input.node.repoId,
          $packageId: input.node.packageId ?? null,
          $moduleId: input.node.moduleId ?? null,
          $sourceDocId: input.sourceDocId,
          $sourceDocPath: input.node.sourceDocPath,
          $title: title ?? null,
          $description: input.description ?? null,
          $headingsJson: encodeJson(headings),
          $keySectionsJson: encodeJson(keySections),
          $topicsJson: encodeJson(topics),
          $aliasesJson: encodeJson(aliases),
          $tokenCount: tokenCount
        }
      );
      if (input.artifacts !== undefined) {
        this.replaceArtifacts(input.node.skillId, input.artifacts);
      }
    });
    return {
      skillId: input.node.skillId,
      repoId: input.node.repoId,
      ...(input.node.packageId === undefined ? {} : { packageId: input.node.packageId }),
      ...(input.node.moduleId === undefined ? {} : { moduleId: input.node.moduleId }),
      sourceDocId: input.sourceDocId,
      sourceDocPath: input.node.sourceDocPath,
      ...(title === undefined ? {} : { title }),
      ...(input.description === undefined ? {} : { description: input.description }),
      headings,
      keySections,
      topics,
      aliases,
      tokenCount
    };
  }

  /** Replaces the read-only artifact bundle for one skill. */
  replaceArtifacts(skillId: string, artifacts: readonly SkillArtifactRecord[]): void {
    this.withRepositoryErrors("replaceSkillArtifacts", () => {
      this.db.run("DELETE FROM skill_artifacts WHERE skill_id = $skillId", { $skillId: skillId });
      for (const artifact of [...artifacts].sort((left, right) => left.path.localeCompare(right.path))) {
        this.db.run(
          `INSERT INTO skill_artifacts (skill_id, path, kind, content_hash, size_bytes, mime_type, content)
           VALUES ($skillId, $path, $kind, $contentHash, $sizeBytes, $mimeType, $content)`,
          {
            $skillId: skillId,
            $path: artifact.path,
            $kind: artifact.kind,
            $contentHash: artifact.contentHash,
            $sizeBytes: artifact.sizeBytes,
            $mimeType: artifact.mimeType ?? null,
            $content: artifact.content ?? null
          }
        );
      }
    });
  }

  /** Lists read-only artifacts bundled with one skill. */
  listArtifacts(skillId: string): SkillArtifactRecord[] {
    return this.withRepositoryErrors("listSkillArtifacts", () =>
      this.db
        .all<SkillArtifactRow>(
          `SELECT skill_id, path, kind, content_hash, size_bytes, mime_type, content
           FROM skill_artifacts
           WHERE skill_id = $skillId
           ORDER BY path`,
          { $skillId: skillId }
        )
        .map(mapSkillArtifactRow)
    );
  }

  /** Reads one artifact by skill ID and relative path. */
  getArtifact(skillId: string, path: string): SkillArtifactRecord | undefined {
    return this.withRepositoryErrors("getSkillArtifact", () => {
      const row = this.db.get<SkillArtifactRow>(
        `SELECT skill_id, path, kind, content_hash, size_bytes, mime_type, content
         FROM skill_artifacts
         WHERE skill_id = $skillId AND path = $path`,
        { $skillId: skillId, $path: path }
      );
      return row === undefined ? undefined : mapSkillArtifactRow(row);
    });
  }

  /** Returns deterministic artifact counts for one skill. */
  summarizeArtifacts(skillId: string): SkillArtifactSummary {
    const summary: SkillArtifactSummary = { scripts: 0, references: 0, agentProfiles: 0, other: 0 };
    for (const artifact of this.listArtifacts(skillId)) {
      if (artifact.kind === "script") {
        summary.scripts += 1;
      } else if (artifact.kind === "reference") {
        summary.references += 1;
      } else if (artifact.kind === "agent-profile") {
        summary.agentProfiles += 1;
      } else {
        summary.other += 1;
      }
    }
    return summary;
  }

  /** Returns one skill record by ID. */
  get(skillId: string): SkillRecord | undefined {
    return this.withRepositoryErrors("getSkill", () => {
      const row = this.db.get<SkillRow>(
        `SELECT skill_id, repo_id, package_id, module_id, source_doc_id, source_doc_path,
                title, description, headings_json, key_sections_json, topics_json, aliases_json, token_count
         FROM skills
         WHERE skill_id = $skillId`,
        { $skillId: skillId }
      );
      return row === undefined ? undefined : mapSkillRow(row);
    });
  }

  /** Lists skills by repository and optional package/module scope. */
  listByRepo(repoId: string, scope: { packageId?: string; moduleId?: string } = {}): SkillRecord[] {
    return this.withRepositoryErrors("listSkillsByRepo", () => {
      const rows =
        scope.moduleId !== undefined
          ? this.db.all<SkillRow>(
              `SELECT skill_id, repo_id, package_id, module_id, source_doc_id, source_doc_path,
                      title, description, headings_json, key_sections_json, topics_json, aliases_json, token_count
               FROM skills
               WHERE repo_id = $repoId AND module_id = $moduleId
               ORDER BY source_doc_path`,
              { $repoId: repoId, $moduleId: scope.moduleId }
            )
          : scope.packageId !== undefined
            ? this.db.all<SkillRow>(
                `SELECT skill_id, repo_id, package_id, module_id, source_doc_id, source_doc_path,
                        title, description, headings_json, key_sections_json, topics_json, aliases_json, token_count
                 FROM skills
                 WHERE repo_id = $repoId AND package_id = $packageId
                 ORDER BY source_doc_path`,
                { $repoId: repoId, $packageId: scope.packageId }
              )
            : this.db.all<SkillRow>(
                `SELECT skill_id, repo_id, package_id, module_id, source_doc_id, source_doc_path,
                        title, description, headings_json, key_sections_json, topics_json, aliases_json, token_count
                 FROM skills
                 WHERE repo_id = $repoId
                 ORDER BY source_doc_path`,
                { $repoId: repoId }
              );
      return rows.map(mapSkillRow);
    });
  }

  /** Lists all skills across repositories in deterministic source path order. */
  listAll(): SkillRecord[] {
    return this.withRepositoryErrors("listAllSkills", () =>
      this.db
        .all<SkillRow>(
          `SELECT skill_id, repo_id, package_id, module_id, source_doc_id, source_doc_path,
                  title, description, headings_json, key_sections_json, topics_json, aliases_json, token_count
           FROM skills
           ORDER BY repo_id, source_doc_path`
        )
        .map(mapSkillRow)
    );
  }

  /** Deletes one skill record. */
  delete(skillId: string): void {
    this.withRepositoryErrors("deleteSkill", () => {
      this.db.run("DELETE FROM skills WHERE skill_id = $skillId", { $skillId: skillId });
    });
  }

  private withRepositoryErrors<T>(operation: string, action: () => T): T {
    try {
      return action();
    } catch (error) {
      throw new StoreRepositoryError("Skill persistence operation failed.", {
        operation,
        entity: "skill",
        cause: error
      });
    }
  }
}

interface SkillArtifactRow {
  skill_id: string;
  path: string;
  kind: SkillArtifactRecord["kind"];
  content_hash: string;
  size_bytes: number;
  mime_type: string | null;
  content: string | null;
}

interface SkillRow {
  skill_id: string;
  repo_id: string;
  package_id: string | null;
  module_id: string | null;
  source_doc_id: string;
  source_doc_path: string;
  title: string | null;
  description: string | null;
  headings_json: string;
  key_sections_json: string;
  topics_json: string;
  aliases_json: string;
  token_count: number;
}

function mapSkillRow(row: SkillRow): SkillRecord {
  return {
    skillId: row.skill_id,
    repoId: row.repo_id,
    ...(row.package_id === null ? {} : { packageId: row.package_id }),
    ...(row.module_id === null ? {} : { moduleId: row.module_id }),
    sourceDocId: row.source_doc_id,
    sourceDocPath: row.source_doc_path,
    ...(row.title === null ? {} : { title: row.title }),
    ...(row.description === null ? {} : { description: row.description }),
    headings: decodeJsonArray<string[]>(row.headings_json, "skills.headings_json"),
    keySections: decodeJsonArray<string>(row.key_sections_json, "skills.key_sections_json"),
    topics: decodeJsonArray<string>(row.topics_json, "skills.topics_json"),
    aliases: decodeJsonArray<string>(row.aliases_json, "skills.aliases_json"),
    tokenCount: row.token_count
  };
}

function mapSkillArtifactRow(row: SkillArtifactRow): SkillArtifactRecord {
  return {
    skillId: row.skill_id,
    path: row.path,
    kind: row.kind,
    contentHash: row.content_hash,
    sizeBytes: row.size_bytes,
    ...(row.mime_type === null ? {} : { mimeType: row.mime_type }),
    ...(row.content === null ? {} : { content: row.content })
  };
}
