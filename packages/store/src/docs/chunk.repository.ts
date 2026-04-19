import type { CorpusChunk } from "@atlas/core";

import { StoreRepositoryError } from "../errors";
import { decodeJsonArray, encodeJson } from "../json";
import { reindexChunks } from "../search/fts";
import type { ChunkRecord, StoreDatabase } from "../types";

/** Persists and queries tokenizer-produced chunks. */
export class ChunkRepository {
  constructor(private readonly db: StoreDatabase) {}

  /** Inserts or updates one chunk. */
  upsert(chunk: CorpusChunk, sectionId?: string): ChunkRecord {
    this.withRepositoryErrors("upsertChunk", () => {
      insertChunk(this.db, chunk, sectionId);
    });
    return { ...chunk, ...(sectionId === undefined ? {} : { sectionId }) };
  }

  /** Replaces all chunks for a document and refreshes chunk FTS rows when document metadata exists. */
  replaceForDocument(docId: string, chunks: readonly CorpusChunk[]): ChunkRecord[] {
    this.withRepositoryErrors("replaceChunksForDocument", () => {
      this.db.transaction(() => {
        this.db.run("DELETE FROM chunks WHERE doc_id = $docId", { $docId: docId });
        for (const chunk of chunks) {
          insertChunk(this.db, chunk);
        }
        const document = this.db.get<DocumentForFtsRow>(
          `SELECT doc_id, repo_id, path, source_version, kind, authority, title, package_id, module_id, skill_id, tags_json
           FROM documents
           WHERE doc_id = $docId`,
          { $docId: docId }
        );
        if (document !== undefined) {
          reindexChunks(this.db, {
            docId: document.doc_id,
            repoId: document.repo_id,
            path: document.path,
            sourceVersion: document.source_version,
            ...(document.title === null ? {} : { title: document.title }),
            kind: document.kind,
            authority: document.authority,
            scopes: [],
            sections: [],
            metadata: {
              ...(document.package_id === null ? {} : { packageId: document.package_id }),
              ...(document.module_id === null ? {} : { moduleId: document.module_id }),
              ...(document.skill_id === null ? {} : { skillId: document.skill_id }),
              tags: decodeJsonArray<string>(document.tags_json, "documents.tags_json")
            }
          }, chunks);
        }
      });
    });
    return chunks.map((chunk) => ({ ...chunk }));
  }

  /** Lists chunks by document in ordinal order. */
  listByDocument(docId: string): ChunkRecord[] {
    return this.withRepositoryErrors("listChunksByDocument", () =>
      this.db
        .all<ChunkRow>(
          `SELECT chunk_id, doc_id, repo_id, package_id, module_id, skill_id, section_id, kind, authority,
                  ordinal, heading_path_json, text, token_count
           FROM chunks
           WHERE doc_id = $docId
           ORDER BY ordinal`,
          { $docId: docId }
        )
        .map(mapChunkRow)
    );
  }

  /** Returns one chunk by stable chunk ID. */
  getById(chunkId: string): ChunkRecord | undefined {
    return this.withRepositoryErrors("getChunkById", () => {
      const row = this.db.get<ChunkRow>(
        `SELECT chunk_id, doc_id, repo_id, package_id, module_id, skill_id, section_id, kind, authority,
                ordinal, heading_path_json, text, token_count
         FROM chunks
         WHERE chunk_id = $chunkId`,
        { $chunkId: chunkId }
      );
      return row === undefined ? undefined : mapChunkRow(row);
    });
  }

  /** Lists chunks for a module scope in deterministic document/ordinal order. */
  listByModule(moduleId: string): ChunkRecord[] {
    return this.withRepositoryErrors("listChunksByModule", () =>
      this.db
        .all<ChunkRow>(
          `SELECT chunk_id, doc_id, repo_id, package_id, module_id, skill_id, section_id, kind, authority,
                  ordinal, heading_path_json, text, token_count
           FROM chunks
           WHERE module_id = $moduleId
           ORDER BY doc_id, ordinal`,
          { $moduleId: moduleId }
        )
        .map(mapChunkRow)
    );
  }

  /** Deletes chunks for one document. */
  deleteForDocument(docId: string): void {
    this.withRepositoryErrors("deleteChunksForDocument", () => {
      this.db.run("DELETE FROM chunks WHERE doc_id = $docId", { $docId: docId });
      this.db.run("DELETE FROM fts_entries WHERE doc_id = $docId AND entity_type = 'chunk'", { $docId: docId });
    });
  }

  private withRepositoryErrors<T>(operation: string, action: () => T): T {
    try {
      return action();
    } catch (error) {
      throw new StoreRepositoryError("Chunk persistence operation failed.", {
        operation,
        entity: "chunk",
        cause: error
      });
    }
  }
}

interface ChunkRow {
  chunk_id: string;
  doc_id: string;
  repo_id: string;
  package_id: string | null;
  module_id: string | null;
  skill_id: string | null;
  section_id: string | null;
  kind: CorpusChunk["kind"];
  authority: CorpusChunk["authority"];
  ordinal: number;
  heading_path_json: string;
  text: string;
  token_count: number;
}

interface DocumentForFtsRow {
  doc_id: string;
  repo_id: string;
  path: string;
  source_version: string;
  kind: CorpusChunk["kind"];
  authority: CorpusChunk["authority"];
  title: string | null;
  package_id: string | null;
  module_id: string | null;
  skill_id: string | null;
  tags_json: string;
}

function insertChunk(db: StoreDatabase, chunk: CorpusChunk, sectionId?: string): void {
  db.run(
    `INSERT INTO chunks (
       chunk_id, doc_id, repo_id, package_id, module_id, skill_id, section_id, kind, authority,
       ordinal, heading_path_json, text, token_count
     )
     VALUES (
       $chunkId, $docId, $repoId, $packageId, $moduleId, $skillId, $sectionId, $kind, $authority,
       $ordinal, $headingPathJson, $text, $tokenCount
     )
     ON CONFLICT(chunk_id) DO UPDATE SET
       doc_id = excluded.doc_id,
       repo_id = excluded.repo_id,
       package_id = excluded.package_id,
       module_id = excluded.module_id,
       skill_id = excluded.skill_id,
       section_id = excluded.section_id,
       kind = excluded.kind,
       authority = excluded.authority,
       ordinal = excluded.ordinal,
       heading_path_json = excluded.heading_path_json,
       text = excluded.text,
       token_count = excluded.token_count`,
    {
      $chunkId: chunk.chunkId,
      $docId: chunk.docId,
      $repoId: chunk.repoId,
      $packageId: chunk.packageId ?? null,
      $moduleId: chunk.moduleId ?? null,
      $skillId: chunk.skillId ?? null,
      $sectionId: sectionId ?? null,
      $kind: chunk.kind,
      $authority: chunk.authority,
      $ordinal: chunk.ordinal,
      $headingPathJson: encodeJson(chunk.headingPath),
      $text: chunk.text,
      $tokenCount: chunk.tokenCount
    }
  );
}

function mapChunkRow(row: ChunkRow): ChunkRecord {
  return {
    chunkId: row.chunk_id,
    docId: row.doc_id,
    repoId: row.repo_id,
    ...(row.package_id === null ? {} : { packageId: row.package_id }),
    ...(row.module_id === null ? {} : { moduleId: row.module_id }),
    ...(row.skill_id === null ? {} : { skillId: row.skill_id }),
    ...(row.section_id === null ? {} : { sectionId: row.section_id }),
    kind: row.kind,
    authority: row.authority,
    ordinal: row.ordinal,
    headingPath: decodeJsonArray<string>(row.heading_path_json, "chunks.heading_path_json"),
    text: row.text,
    tokenCount: row.token_count
  };
}
