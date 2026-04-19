import {
  ChunkRepository,
  DocRepository,
  SectionRepository,
  SkillRepository,
  SummaryRepository,
  type ChunkRecord,
  type DocumentRecord,
  type SectionRecord,
  type SkillRecord,
  type StoreDatabase,
  type SummaryRecord
} from "@atlas/store";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";

import { McpResourceNotFoundError } from "../errors";
import { toolResult } from "../mcp-result";
import { expandRelatedInputSchema, jsonOutputSchema, type ExpandRelatedInput } from "../schemas/tool-schemas";
import { listSummaries, provenanceFromDocument } from "../store-mappers";
import type { AtlasMcpDependencies, McpJsonObject } from "../types";

export const EXPAND_RELATED_TOOL = "expand_related";

type AnchorKind = ExpandRelatedInput["targetType"];

interface ResolvedAnchor {
  kind: AnchorKind;
  targetId: string;
  document?: DocumentRecord | undefined;
  section?: SectionRecord | undefined;
  chunk?: ChunkRecord | undefined;
  skill?: SkillRecord | undefined;
  summary?: SummaryRecord | undefined;
}

/** Expands one stored hit into deterministic nearby ATLAS context. */
export function executeExpandRelated(input: ExpandRelatedInput, dependencies: AtlasMcpDependencies): McpJsonObject {
  const parsed = expandRelatedInputSchema.parse(input);
  const limit = parsed.limit ?? 5;
  const anchor = resolveAnchor(dependencies.db, parsed.targetType, parsed.targetId);
  const anchorDocument = anchor.document;
  const anchorScope = anchorDocument ?? scopeDocumentFromAnchor(anchor);
  const relatedDocuments = anchorScope === undefined ? [] : relatedDocumentsFor(dependencies.db, anchorScope, limit);
  const sections = anchorDocument === undefined ? [] : new SectionRepository(dependencies.db).listByDocument(anchorDocument.docId);

  return {
    anchor: presentAnchor(anchor),
    related: {
      documents: relatedDocuments.map(presentDocument),
      sections: sections.slice(0, limit).map(presentSectionPreview),
      summaries: relatedSummaries(dependencies.db, anchor, relatedDocuments, limit),
      skills: relatedSkills(dependencies.db, anchorScope, limit)
    },
    diagnostics: [
      {
        stage: "expand_related",
        message: "Expanded related context by document locality.",
        metadata: {
          targetType: parsed.targetType,
          targetId: parsed.targetId,
          limit,
          relatedDocuments: relatedDocuments.length,
          relatedSections: Math.min(sections.length, limit)
        }
      }
    ]
  };
}

/** Registers the expand_related MCP tool. */
export function registerExpandRelatedTool(server: McpServer, dependencies: AtlasMcpDependencies): void {
  server.registerTool(
    EXPAND_RELATED_TOOL,
    {
      title: "Expand related ATLAS context",
      description: "Expand from a stored hit to nearby documents, sections, summaries, and skills by locality.",
      inputSchema: expandRelatedInputSchema,
      outputSchema: jsonOutputSchema
    },
    (input) => toolResult(executeExpandRelated(input, dependencies))
  );
}

function resolveAnchor(db: StoreDatabase, targetType: AnchorKind, targetId: string): ResolvedAnchor {
  if (targetType === "document") {
    const document = new DocRepository(db).get(targetId);
    if (document === undefined) {
      throw notFound(targetType, targetId);
    }
    return { kind: targetType, targetId, document };
  }

  if (targetType === "section") {
    const section = new SectionRepository(db).getById(targetId);
    if (section === undefined) {
      throw notFound(targetType, targetId);
    }
    return { kind: targetType, targetId, section, document: new DocRepository(db).get(section.docId) };
  }

  if (targetType === "chunk") {
    const chunk = new ChunkRepository(db).getById(targetId);
    if (chunk === undefined) {
      throw notFound(targetType, targetId);
    }
    return { kind: targetType, targetId, chunk, document: new DocRepository(db).get(chunk.docId) };
  }

  if (targetType === "skill") {
    const skill = new SkillRepository(db).get(targetId);
    if (skill === undefined) {
      throw notFound(targetType, targetId);
    }
    return { kind: targetType, targetId, skill, document: new DocRepository(db).get(skill.sourceDocId) };
  }

  const summary = new SummaryRepository(db).getById(targetId);
  if (summary === undefined) {
    throw notFound(targetType, targetId);
  }
  return { kind: targetType, targetId, summary, document: documentForSummary(db, summary) };
}

function documentForSummary(db: StoreDatabase, summary: SummaryRecord): DocumentRecord | undefined {
  if (summary.targetType === "document") {
    return new DocRepository(db).get(summary.targetId);
  }
  if (summary.targetType === "skill") {
    const skill = new SkillRepository(db).get(summary.targetId);
    return skill === undefined ? undefined : new DocRepository(db).get(skill.sourceDocId);
  }
  return undefined;
}

function scopeDocumentFromAnchor(anchor: ResolvedAnchor): DocumentRecord | undefined {
  if (anchor.document !== undefined) {
    return anchor.document;
  }
  return undefined;
}

function relatedDocumentsFor(db: StoreDatabase, anchor: DocumentRecord, limit: number): DocumentRecord[] {
  return new DocRepository(db)
    .listByRepo(anchor.repoId)
    .filter((document) => document.docId !== anchor.docId)
    .map((document) => ({ document, rank: localityRank(anchor, document) }))
    .filter((entry) => entry.rank < 4)
    .sort((left, right) => left.rank - right.rank || left.document.path.localeCompare(right.document.path))
    .slice(0, limit)
    .map((entry) => entry.document);
}

function localityRank(anchor: DocumentRecord, candidate: DocumentRecord): number {
  if (anchor.moduleId !== undefined && candidate.moduleId === anchor.moduleId) {
    return 1;
  }
  if (anchor.packageId !== undefined && candidate.packageId === anchor.packageId) {
    return 2;
  }
  if (candidate.repoId === anchor.repoId) {
    return 3;
  }
  return 4;
}

function relatedSummaries(db: StoreDatabase, anchor: ResolvedAnchor, documents: readonly DocumentRecord[], limit: number): SummaryRecord[] {
  const summaries = new Map<string, SummaryRecord>();
  const add = (summary: SummaryRecord) => summaries.set(summary.summaryId, summary);

  if (anchor.summary !== undefined) {
    add(anchor.summary);
  }
  if (anchor.document !== undefined) {
    listSummaries(db, "document", anchor.document.docId).forEach(add);
    if (anchor.document.moduleId !== undefined) {
      listSummaries(db, "module", anchor.document.moduleId).forEach(add);
    }
    if (anchor.document.packageId !== undefined) {
      listSummaries(db, "package", anchor.document.packageId).forEach(add);
    }
    listSummaries(db, "repo", anchor.document.repoId).forEach(add);
  }
  for (const document of documents) {
    listSummaries(db, "document", document.docId).forEach(add);
  }

  return [...summaries.values()].slice(0, limit);
}

function relatedSkills(db: StoreDatabase, anchor: DocumentRecord | undefined, limit: number): SkillRecord[] {
  if (anchor === undefined) {
    return [];
  }
  return new SkillRepository(db)
    .listByRepo(anchor.repoId, {
      ...(anchor.packageId === undefined ? {} : { packageId: anchor.packageId }),
      ...(anchor.moduleId === undefined ? {} : { moduleId: anchor.moduleId })
    })
    .slice(0, limit);
}

function presentAnchor(anchor: ResolvedAnchor): McpJsonObject {
  return {
    targetType: anchor.kind,
    targetId: anchor.targetId,
    ...(anchor.document === undefined ? {} : { document: presentDocument(anchor.document), provenance: provenanceFromDocument(anchor.document) }),
    ...(anchor.section === undefined ? {} : { section: presentSectionPreview(anchor.section) }),
    ...(anchor.chunk === undefined ? {} : { chunk: presentChunkPreview(anchor.chunk) }),
    ...(anchor.skill === undefined ? {} : { skill: anchor.skill }),
    ...(anchor.summary === undefined ? {} : { summary: anchor.summary })
  };
}

function presentDocument(document: DocumentRecord): McpJsonObject {
  return {
    docId: document.docId,
    repoId: document.repoId,
    path: document.path,
    title: document.title,
    kind: document.kind,
    authority: document.authority,
    sourceVersion: document.sourceVersion,
    packageId: document.packageId,
    moduleId: document.moduleId,
    skillId: document.skillId
  };
}

function presentSectionPreview(section: SectionRecord): McpJsonObject {
  return {
    sectionId: section.sectionId,
    docId: section.docId,
    headingPath: section.headingPath,
    ordinal: section.ordinal,
    preview: section.text.slice(0, 240)
  };
}

function presentChunkPreview(chunk: ChunkRecord): McpJsonObject {
  return {
    chunkId: chunk.chunkId,
    docId: chunk.docId,
    sectionId: chunk.sectionId,
    headingPath: chunk.headingPath,
    ordinal: chunk.ordinal,
    tokenCount: chunk.tokenCount,
    preview: chunk.text.slice(0, 240)
  };
}

function notFound(targetType: AnchorKind, targetId: string): McpResourceNotFoundError {
  return new McpResourceNotFoundError("Related expansion target was not found.", { operation: "expandRelated", entity: `${targetType}:${targetId}` });
}
