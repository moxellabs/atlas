import type { CanonicalDocument, CorpusChunk } from "@atlas/core";
import { normalizeRepoPath } from "@atlas/topology";

import { StoreSearchError } from "../errors";
import { encodeJson } from "../json";
import type { SectionRecord, StoreDatabase } from "../types";

/** Removes all full-text rows associated with one document. */
export function deleteFtsEntriesForDocument(db: StoreDatabase, docId: string): void {
  try {
    db.run("DELETE FROM fts_entries WHERE doc_id = $docId", { $docId: docId });
  } catch (error) {
    throw new StoreSearchError("Failed to delete FTS entries for document.", {
      operation: "deleteFtsDocument",
      entity: "fts_entries",
      cause: error
    });
  }
}

/** Rebuilds full-text rows for a canonical document and its persisted children. */
export function reindexDocumentText(db: StoreDatabase, document: CanonicalDocument, chunks: readonly CorpusChunk[] = []): void {
  try {
    deleteFtsEntriesForDocument(db, document.docId);
    insertDocumentEntry(db, document);
    for (const section of document.sections) {
      insertSectionEntry(db, document, { ...section, docId: document.docId });
    }
    for (const chunk of chunks) {
      insertChunkEntry(db, document, chunk);
    }
  } catch (error) {
    throw new StoreSearchError("Failed to reindex document text.", {
      operation: "reindexDocument",
      entity: "fts_entries",
      cause: error
    });
  }
}

/** Inserts or refreshes FTS rows for already persisted chunks. */
export function reindexChunks(db: StoreDatabase, document: CanonicalDocument, chunks: readonly CorpusChunk[]): void {
  try {
    db.run("DELETE FROM fts_entries WHERE doc_id = $docId AND entity_type = 'chunk'", { $docId: document.docId });
    for (const chunk of chunks) {
      insertChunkEntry(db, document, chunk);
    }
  } catch (error) {
    throw new StoreSearchError("Failed to reindex chunk text.", {
      operation: "reindexChunks",
      entity: "fts_entries",
      cause: error
    });
  }
}

function insertDocumentEntry(db: StoreDatabase, document: CanonicalDocument): void {
  db.run(
    `INSERT INTO fts_entries (entity_type, entity_id, doc_id, section_id, chunk_id, repo_id, path, title, headings, body)
     VALUES ('document', $entityId, $docId, NULL, NULL, $repoId, $path, $title, $headings, $body)`,
    {
      $entityId: document.docId,
      $docId: document.docId,
      $repoId: document.repoId,
      $path: normalizeRepoPath(document.path),
      $title: document.title ?? "",
      $headings: encodeJson(document.sections.map((section) => section.headingPath)),
      $body: document.sections.map(sectionSearchText).join("\n\n")
    }
  );
}

function insertSectionEntry(db: StoreDatabase, document: CanonicalDocument, section: SectionRecord): void {
  db.run(
    `INSERT INTO fts_entries (entity_type, entity_id, doc_id, section_id, chunk_id, repo_id, path, title, headings, body)
     VALUES ('section', $entityId, $docId, $sectionId, NULL, $repoId, $path, $title, $headings, $body)`,
    {
      $entityId: section.sectionId,
      $docId: document.docId,
      $sectionId: section.sectionId,
      $repoId: document.repoId,
      $path: normalizeRepoPath(document.path),
      $title: document.title ?? "",
      $headings: section.headingPath.join(" "),
      $body: sectionSearchText(section)
    }
  );
}

function insertChunkEntry(db: StoreDatabase, document: CanonicalDocument, chunk: CorpusChunk): void {
  db.run(
    `INSERT INTO fts_entries (entity_type, entity_id, doc_id, section_id, chunk_id, repo_id, path, title, headings, body)
     VALUES ('chunk', $entityId, $docId, NULL, $chunkId, $repoId, $path, $title, $headings, $body)`,
    {
      $entityId: chunk.chunkId,
      $docId: chunk.docId,
      $chunkId: chunk.chunkId,
      $repoId: chunk.repoId,
      $path: normalizeRepoPath(document.path),
      $title: document.title ?? "",
      $headings: chunk.headingPath.join(" "),
      $body: chunkSearchBody(document, chunk)
    }
  );
}

function chunkSearchBody(document: CanonicalDocument, chunk: CorpusChunk): string {
  return stripDuplicatedChunkMetadata(chunk.searchText ?? chunk.text, document);
}

function stripDuplicatedChunkMetadata(searchText: string, document: CanonicalDocument): string {
  const separator = "\n\n";
  const separatorIndex = searchText.indexOf(separator);
  if (separatorIndex === -1) {
    return searchText;
  }

  const header = searchText.slice(0, separatorIndex);
  if (!header.includes(" | ")) {
    return searchText;
  }

  const duplicateParts = new Set([
    `path: ${normalizeRepoPath(document.path)}`,
    ...(document.title === undefined ? [] : [`title: ${document.title}`])
  ]);
  const strippedHeader = header
    .split(" | ")
    .filter((part) => !duplicateParts.has(part.trim()))
    .join(" | ");
  const body = searchText.slice(separatorIndex + separator.length);

  return strippedHeader.length === 0 ? body : `${strippedHeader}${separator}${body}`;
}

function sectionSearchText(section: Pick<SectionRecord, "text" | "codeBlocks">): string {
  const codeText = section.codeBlocks
    .map((block) => [block.lang, block.code].filter(Boolean).join("\n"))
    .filter((text) => text.trim().length > 0)
    .join("\n\n");
  return [section.text, codeText].filter((text) => text.trim().length > 0).join("\n\n");
}
