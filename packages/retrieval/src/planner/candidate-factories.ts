import type {
  CanonicalSection,
  DocumentMetadataFilters,
  Provenance,
} from "@atlas/core";
import type {
  ChunkRecord,
  DocumentRecord,
  LexicalSearchHit,
  SectionRecord,
  SkillRecord,
  SummaryRecord,
} from "@atlas/store";

import type {
  RetrievalCandidate,
  RetrievalStore,
  ScopeCandidate,
} from "../types";

export interface HydratedLexicalCandidate {
  candidate: RetrievalCandidate;
  document: DocumentRecord;
}

export function candidateFromLexicalHit(input: {
  readonly store: RetrievalStore;
  readonly hit: LexicalSearchHit;
  readonly score: number;
  readonly countTokens: (text: string) => number;
}): HydratedLexicalCandidate | undefined {
  const document = input.store.getDocument(input.hit.docId);
  if (document === undefined) {
    return undefined;
  }
  const baseScore = input.score;
  if (input.hit.entityType === "chunk" && input.hit.chunkId !== undefined) {
    const chunk = input.store.getChunk(input.hit.chunkId);
    return chunk === undefined
      ? undefined
      : {
          candidate: chunkCandidate(document, chunk, baseScore),
          document,
        };
  }
  if (input.hit.entityType === "section" && input.hit.sectionId !== undefined) {
    const section = input.store.getSection(input.hit.sectionId);
    return section === undefined
      ? undefined
      : {
          candidate: sectionCandidate(
            document,
            section,
            baseScore,
            input.countTokens,
          ),
          document,
        };
  }
  return {
    candidate: documentCandidate(
      document,
      "lexical",
      baseScore,
      ["Matched document full-text index."],
      input.countTokens,
    ),
    document,
  };
}

export function documentSummaries(
  store: RetrievalStore,
  document: DocumentRecord,
  score: number,
): RetrievalCandidate[] {
  return store
    .listSummaries("document", document.docId)
    .map((summary) => summaryCandidate(document, summary, score));
}

export function documentsForScope(
  store: RetrievalStore,
  scope: ScopeCandidate,
  filters?: DocumentMetadataFilters,
): DocumentRecord[] {
  return store.scopeSearch({
    repoId: scope.repoId,
    filters,
    ...(scope.packageId === undefined ? {} : { packageId: scope.packageId }),
    ...(scope.moduleId === undefined ? {} : { moduleId: scope.moduleId }),
    ...(scope.skillId === undefined ? {} : { skillId: scope.skillId }),
    limit: 20,
  });
}

export function documentCandidate(
  document: DocumentRecord,
  source: RetrievalCandidate["source"],
  score: number,
  rationale: string[],
  countTokens: (text: string) => number,
): RetrievalCandidate {
  const preview = [document.title, document.path, document.tags.join(" ")]
    .filter(Boolean)
    .join("\n");
  return {
    targetType: "document",
    targetId: document.docId,
    provenance: provenanceFromDocument(document),
    kind: document.kind,
    authority: document.authority,
    score,
    tokenCount: countTokens(preview),
    textPreview: preview,
    source,
    rationale,
  };
}

export function skillCandidate(
  store: RetrievalStore,
  skill: SkillRecord,
  score: number,
  countTokens: (text: string) => number,
): RetrievalCandidate {
  const document = store.getDocument(skill.sourceDocId);
  const text = [skill.title, skill.description, ...skill.keySections]
    .filter(Boolean)
    .join("\n");
  return {
    targetType: "skill",
    targetId: skill.skillId,
    provenance:
      document === undefined
        ? {
            repoId: skill.repoId,
            ...(skill.packageId === undefined
              ? {}
              : { packageId: skill.packageId }),
            ...(skill.moduleId === undefined
              ? {}
              : { moduleId: skill.moduleId }),
            skillId: skill.skillId,
            docId: skill.sourceDocId,
            path: skill.sourceDocPath,
            sourceVersion: "unknown",
            authority: "preferred",
          }
        : provenanceFromDocument(document, undefined, skill.skillId),
    kind: "skill-doc",
    authority: document?.authority ?? "preferred",
    score,
    tokenCount: countTokens(text),
    textPreview: text,
    source: "skill",
    rationale: [`Matched skill ${skill.title ?? skill.skillId}.`],
  };
}

function summaryCandidate(
  document: DocumentRecord,
  summary: SummaryRecord,
  score: number,
): RetrievalCandidate {
  return {
    targetType: "summary",
    targetId: summary.summaryId,
    provenance: provenanceFromDocument(document),
    kind: document.kind,
    authority: document.authority,
    score,
    tokenCount: summary.tokenCount,
    textPreview: summary.text,
    source: "summary",
    rationale: [
      `Selected ${summary.level} summary for ${summary.targetType}:${summary.targetId}.`,
    ],
  };
}

function sectionCandidate(
  document: DocumentRecord,
  section: SectionRecord,
  score: number,
  countTokens: (text: string) => number,
): RetrievalCandidate {
  const text = sectionText(section);
  return {
    targetType: "section",
    targetId: section.sectionId,
    provenance: provenanceFromDocument(document, section.headingPath),
    kind: document.kind,
    authority: document.authority,
    score,
    tokenCount: countTokens(text),
    textPreview: text,
    source: "lexical",
    rationale: [`Matched section ${section.headingPath.join(" > ")}.`],
  };
}

function chunkCandidate(
  document: DocumentRecord,
  chunk: ChunkRecord,
  score: number,
): RetrievalCandidate {
  return {
    targetType: "chunk",
    targetId: chunk.chunkId,
    provenance: provenanceFromDocument(document, chunk.headingPath),
    kind: chunk.kind,
    authority: chunk.authority,
    score,
    tokenCount: chunk.tokenCount,
    textPreview: chunk.text,
    source: "lexical",
    rationale: [`Matched chunk ${chunk.chunkId}.`],
  };
}

function provenanceFromDocument(
  document: DocumentRecord,
  headingPath?: readonly string[],
  skillId?: string,
): Provenance {
  const effectiveSkillId = skillId ?? document.skillId;
  return {
    repoId: document.repoId,
    ...(document.packageId === undefined
      ? {}
      : { packageId: document.packageId }),
    ...(document.moduleId === undefined ? {} : { moduleId: document.moduleId }),
    ...(effectiveSkillId === undefined ? {} : { skillId: effectiveSkillId }),
    docId: document.docId,
    path: document.path,
    ...(headingPath === undefined ? {} : { headingPath: [...headingPath] }),
    sourceVersion: document.sourceVersion,
    authority: document.authority,
  };
}

function sectionText(section: CanonicalSection): string {
  const code = section.codeBlocks
    .map((block) => `\`\`\`${block.lang ?? ""}\n${block.code}\n\`\`\``)
    .join("\n\n");
  return [section.headingPath.join(" > "), section.text, code]
    .filter((part) => part.trim().length > 0)
    .join("\n\n");
}
