import {
  computeFreshness,
  type DocumentMetadataFilters,
  type Provenance,
} from "@atlas/core";
import {
  DocRepository,
  type DocumentRecord,
  ManifestRepository,
  type ManifestRecord,
  RepoRepository,
  type RepoRecord,
  SectionRepository,
  type SectionRecord,
  SkillRepository,
  type SkillArtifactSummary,
  type SkillRecord,
  type StoreDatabase,
  type SummaryRecord,
  SummaryRepository,
} from "@atlas/store";

import { RetrievalEntityNotFoundError } from "../errors";
import { planContext } from "../planner/plan-context";
import { classifyQuery } from "../classify/classify-query";
import { inferScopes } from "../scopes/infer-scopes";
import type {
  PlannedContext,
  QueryClassification,
  RankedHit,
  RetrievalStore,
  RetrievalDiagnostic,
  RetrievalTargetType,
  ScopeCandidate,
} from "../types";

/** Input shared by document and scope search operations. */
export interface SearchApplicationInput {
  store: RetrievalStore;
  query: string;
  repoId?: string | undefined;
  limit?: number | undefined;
  filters?: DocumentMetadataFilters | undefined;
}

/** Scope inference result shared by HTTP and MCP transports. */
export interface FindScopesResult {
  query: string;
  classification: QueryClassification;
  scopes: ScopeCandidate[];
  diagnostics: RetrievalDiagnostic[];
}

/** Infers repository, package, module, and skill scopes through one transport-neutral path. */
export function findScopes(input: SearchApplicationInput): FindScopesResult {
  const classification = classifyQuery(input.query);
  const result = inferScopes({
    store: input.store,
    query: input.query,
    classification,
    ...(input.repoId === undefined ? {} : { repoId: input.repoId }),
    ...(input.limit === undefined ? {} : { limit: input.limit }),
    ...(input.filters === undefined ? {} : { filters: input.filters }),
  });
  return {
    query: input.query,
    classification,
    scopes: result.scopes,
    diagnostics: result.diagnostics,
  };
}

/** Input for precise ranked document retrieval. */
export interface FindDocsInput extends SearchApplicationInput {
  scopeIds?: readonly string[] | undefined;
  documentKinds?: readonly DocumentRecord["kind"][] | undefined;
  targetTypes?: readonly Exclude<RetrievalTargetType, "summary">[] | undefined;
}

/** Ranked document retrieval result shared by HTTP and MCP transports. */
export interface FindDocsResult {
  query: string;
  classification: QueryClassification;
  hits: RankedHit[];
  filters?: unknown;
  ambiguity: PlannedContext["ambiguity"];
  diagnostics: RetrievalDiagnostic[];
}

/** Finds ranked document, section, chunk, and skill hits through one application path. */
export function findDocs(input: FindDocsInput): FindDocsResult {
  const plan = planContext({
    store: input.store,
    query: input.query,
    budgetTokens: 8_000,
    ...(input.repoId === undefined ? {} : { repoId: input.repoId }),
    candidateLimit: input.limit ?? 20,
    ...(input.filters === undefined ? {} : { filters: input.filters }),
  });
  const scopeIds = new Set(input.scopeIds ?? []);
  const documentKinds = new Set(input.documentKinds ?? []);
  const targetTypes = new Set(input.targetTypes ?? []);
  const filters = plan.diagnostics.find(
    (diagnostic) => diagnostic.stage === "candidate-generation",
  )?.metadata?.filters;

  return {
    query: input.query,
    classification: plan.classification,
    hits: plan.rankedHits
      .filter(
        (hit) =>
          hit.targetType !== "summary" &&
          (targetTypes.size === 0 || targetTypes.has(hit.targetType)) &&
          (documentKinds.size === 0 ||
            (hit.kind !== undefined && documentKinds.has(hit.kind))),
      )
      .filter((hit) =>
        scopeIds.size === 0
          ? true
          : [
              hit.provenance.repoId,
              hit.provenance.packageId,
              hit.provenance.moduleId,
              hit.provenance.skillId,
            ].some((scopeId) => scopeId !== undefined && scopeIds.has(scopeId)),
      )
      .slice(0, input.limit ?? 20),
    ...(filters === undefined ? {} : { filters }),
    ambiguity: plan.ambiguity,
    diagnostics: plan.diagnostics,
  };
}

/** Compact document outline shared by direct read transports. */
export interface DocumentOutlineResult {
  document: DocumentRecord;
  provenance: Provenance;
  outline: Array<{
    sectionId: string;
    headingPath: string[];
    ordinal: number;
    preview: string;
  }>;
  summaries: SummaryRecord[];
}

/** Reads one document and its compact section outline. */
export function readDocumentOutline(
  db: StoreDatabase,
  docId: string,
): DocumentOutlineResult {
  const document = requiredDocument(db, docId, "readDocumentOutline");
  return {
    document,
    provenance: provenanceFromDocument(document),
    outline: new SectionRepository(db).listByDocument(docId).map((section) => ({
      sectionId: section.sectionId,
      headingPath: section.headingPath,
      ordinal: section.ordinal,
      preview: section.text.slice(0, 240),
    })),
    summaries: new SummaryRepository(db).listForTarget("document", docId),
  };
}

/** Exact section read shared by direct read transports. */
export interface DocumentSectionResult {
  section: SectionRecord;
  provenance: Provenance;
}

/** Reads one section by ID or exact heading path. */
export function readDocumentSection(
  db: StoreDatabase,
  docId: string,
  options: {
    sectionId?: string | undefined;
    heading?: readonly string[] | undefined;
  },
): DocumentSectionResult {
  const document = requiredDocument(db, docId, "readDocumentSection");
  const section = new SectionRepository(db)
    .listByDocument(docId)
    .find((candidate) =>
      options.sectionId === undefined
        ? sameHeading(candidate.headingPath, options.heading ?? [])
        : candidate.sectionId === options.sectionId,
    );
  if (section === undefined) {
    throw new RetrievalEntityNotFoundError("Section was not found.", {
      operation: "readDocumentSection",
      entity: options.sectionId ?? options.heading?.join(" > "),
    });
  }
  return {
    section,
    provenance: provenanceFromDocument(document, section.headingPath),
  };
}

/** Skill list item with transport-neutral artifact coverage. */
export interface SkillListItem {
  skill: SkillRecord;
  artifactSummary: SkillArtifactSummary;
  hasScripts: boolean;
}

/** Lists skills through one repository selection and artifact-summary path. */
export function listSkills(
  db: StoreDatabase,
  filter: {
    repoId?: string | undefined;
    packageId?: string | undefined;
    moduleId?: string | undefined;
    limit?: number | undefined;
  },
): SkillListItem[] {
  const repos = new RepoRepository(db);
  const skills = new SkillRepository(db);
  const repoIds =
    filter.repoId === undefined
      ? repos.list().map((repo) => repo.repoId)
      : [filter.repoId];
  return repoIds
    .flatMap((repoId) =>
      skills.listByRepo(repoId, {
        ...(filter.packageId === undefined
          ? {}
          : { packageId: filter.packageId }),
        ...(filter.moduleId === undefined ? {} : { moduleId: filter.moduleId }),
      }),
    )
    .slice(0, filter.limit ?? Number.POSITIVE_INFINITY)
    .map((skill) => {
      const artifactSummary = skills.summarizeArtifacts(skill.skillId);
      return {
        skill,
        artifactSummary,
        hasScripts: artifactSummary.scripts > 0,
      };
    });
}

/** Skill detail shared by direct read transports. */
export interface SkillDetailResult {
  skill: SkillRecord;
  sourceDocument?: DocumentRecord | undefined;
  summaries: SummaryRecord[];
  provenance?: Provenance | undefined;
}

/** Reads one skill, its source document, summaries, and provenance. */
export function readSkill(
  db: StoreDatabase,
  skillId: string,
): SkillDetailResult {
  const skill = new SkillRepository(db).get(skillId);
  if (skill === undefined) {
    throw new RetrievalEntityNotFoundError("Skill was not found.", {
      operation: "readSkill",
      entity: skillId,
    });
  }
  const sourceDocument = new DocRepository(db).get(skill.sourceDocId);
  return {
    skill,
    ...(sourceDocument === undefined ? {} : { sourceDocument }),
    summaries: new SummaryRepository(db).listForTarget("skill", skillId),
    ...(sourceDocument === undefined
      ? {}
      : {
          provenance: provenanceFromDocument(
            sourceDocument,
            undefined,
            skill.skillId,
          ),
        }),
  };
}

/** Freshness row shared by HTTP and MCP read surfaces. */
export type FreshnessResult = ReturnType<typeof freshnessFromRecords>;

/** Reads freshness for one repository or every stored repository. */
export function readFreshness(
  db: StoreDatabase,
  repoId?: string | undefined,
): FreshnessResult[] {
  const repos = new RepoRepository(db);
  const manifests = new ManifestRepository(db);
  const records =
    repoId === undefined
      ? repos.list()
      : (() => {
          const repo = repos.get(repoId);
          if (repo === undefined) {
            throw new RetrievalEntityNotFoundError(
              "Repository was not found.",
              {
                operation: "readFreshness",
                entity: repoId,
              },
            );
          }
          return [repo];
        })();
  return records.map((repo) =>
    freshnessFromRecords(repo, manifests.get(repo.repoId)),
  );
}

/** Presents freshness from stored repository and manifest records. */
export function freshnessFromRecords(
  repo: RepoRecord,
  manifest: ManifestRecord | undefined,
) {
  return {
    ...computeFreshness({
      repoId: repo.repoId,
      repoRevision: repo.revision,
      indexedRevision: manifest?.indexedRevision,
      lastSyncAt: manifest?.buildTimestamp,
      partialRevision: manifest?.partialRevision,
      partialBuildTimestamp: manifest?.partialBuildTimestamp,
      partialSelector: manifest?.partialSelector,
    }),
    manifest,
  };
}

/** Creates canonical provenance for a stored document. */
export function provenanceFromDocument(
  document: DocumentRecord,
  headingPath?: readonly string[] | undefined,
  skillId?: string | undefined,
): Provenance {
  return {
    repoId: document.repoId,
    ...(document.packageId === undefined
      ? {}
      : { packageId: document.packageId }),
    ...(document.moduleId === undefined ? {} : { moduleId: document.moduleId }),
    ...((skillId ?? document.skillId) === undefined
      ? {}
      : { skillId: skillId ?? document.skillId }),
    docId: document.docId,
    path: document.path,
    ...(headingPath === undefined ? {} : { headingPath: [...headingPath] }),
    sourceVersion: document.sourceVersion,
    authority: document.authority,
  };
}

function requiredDocument(
  db: StoreDatabase,
  docId: string,
  operation: string,
): DocumentRecord {
  const document = new DocRepository(db).get(docId);
  if (document === undefined) {
    throw new RetrievalEntityNotFoundError("Document was not found.", {
      operation,
      entity: docId,
    });
  }
  return document;
}

function sameHeading(
  left: readonly string[],
  right: readonly string[],
): boolean {
  return (
    left.length === right.length &&
    left.every((value, index) => value === right[index])
  );
}
