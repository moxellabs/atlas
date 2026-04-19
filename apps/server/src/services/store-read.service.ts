import {
  DocRepository,
  getStoreDiagnostics,
  ManifestRepository,
  ModuleRepository,
  PackageRepository,
  RepoRepository,
  SectionRepository,
  SkillRepository,
  SummaryRepository,
  type AtlasStoreClient,
  type DocumentRecord,
  type ManifestRecord,
  type ModuleRecord,
  type PackageRecord,
  type RepoRecord,
  type SectionRecord,
  type SkillRecord,
  type StoreDiagnostics,
  type SummaryRecord
} from "@atlas/store";
import { computeFreshness, type Provenance } from "@atlas/core";

import { ServerNotFoundError } from "../errors";

/** Read-only facade over store repositories used by HTTP routes. */
export class StoreReadService {
  constructor(private readonly db: AtlasStoreClient) {}

  /** Returns store diagnostics suitable for health and inspect surfaces. */
  diagnostics(): StoreDiagnostics {
    return getStoreDiagnostics(this.db);
  }

  /** Lists stored repositories with manifest metadata. */
  listRepos(): Array<{ repo: RepoRecord; manifest?: ManifestRecord | undefined }> {
    return new RepoRepository(this.db).list().map((repo) => ({
      repo,
      manifest: new ManifestRepository(this.db).get(repo.repoId)
    }));
  }

  /** Reads one repository or throws a route-safe not-found error. */
  getRepo(repoId: string): RepoRecord {
    const repo = new RepoRepository(this.db).get(repoId);
    if (repo === undefined) {
      throw new ServerNotFoundError("Repository was not found.", { operation: "getRepo", entity: repoId });
    }
    return repo;
  }

  /** Returns a repository inspection snapshot. */
  getRepoDetail(repoId: string): RepoDetail {
    const repo = this.getRepo(repoId);
    const packages = new PackageRepository(this.db).listByRepo(repoId);
    const modules = new ModuleRepository(this.db).listByRepo(repoId);
    const documents = new DocRepository(this.db).listByRepo(repoId);
    const skills = new SkillRepository(this.db).listByRepo(repoId);
    return {
      repo,
      manifest: new ManifestRepository(this.db).get(repoId),
      packages,
      modules,
      documents,
      skills,
      summaries: new SummaryRepository(this.db).listForTarget("repo", repoId)
    };
  }

  /** Returns manifest records for every known repo. */
  listManifests(): ManifestRecord[] {
    return this.listRepos().flatMap((entry) => (entry.manifest === undefined ? [] : [entry.manifest]));
  }

  /** Returns freshness rows comparing indexed and current stored revisions. */
  listFreshness(): FreshnessRecord[] {
    return this.listRepos().map(({ repo, manifest }) => ({
      ...computeFreshness({
        repoId: repo.repoId,
        repoRevision: repo.revision,
        indexedRevision: manifest?.indexedRevision,
        lastSyncAt: manifest?.buildTimestamp,
        partialRevision: manifest?.partialRevision,
        partialBuildTimestamp: manifest?.partialBuildTimestamp,
        partialSelector: manifest?.partialSelector
      }),
      manifest
    }));
  }

  /** Lists skills with optional scope filters. */
  listSkills(filter: { repoId?: string; packageId?: string; moduleId?: string; limit?: number }): SkillRecord[] {
    const repoIds = filter.repoId === undefined ? new RepoRepository(this.db).list().map((repo) => repo.repoId) : [filter.repoId];
    return repoIds
      .flatMap((repoId) =>
        new SkillRepository(this.db).listByRepo(repoId, {
          ...(filter.packageId === undefined ? {} : { packageId: filter.packageId }),
          ...(filter.moduleId === undefined ? {} : { moduleId: filter.moduleId })
        })
      )
      .slice(0, filter.limit ?? Number.POSITIVE_INFINITY);
  }

  /** Reads one skill or throws a route-safe not-found error. */
  getSkill(skillId: string): SkillDetail {
    const skill = new SkillRepository(this.db).get(skillId);
    if (skill === undefined) {
      throw new ServerNotFoundError("Skill was not found.", { operation: "getSkill", entity: skillId });
    }
    const sourceDocument = new DocRepository(this.db).get(skill.sourceDocId);
    return {
      skill,
      sourceDocument,
      summaries: new SummaryRepository(this.db).listForTarget("skill", skillId)
    };
  }

  /** Reads a compact document outline or throws a route-safe not-found error. */
  getDocumentOutline(docId: string): DocumentOutlineDetail {
    const document = this.getDocument(docId, "getDocumentOutline");
    return {
      document,
      outline: new SectionRepository(this.db).listByDocument(docId).map((section) => ({
        sectionId: section.sectionId,
        headingPath: section.headingPath,
        ordinal: section.ordinal,
        preview: section.text.slice(0, 240)
      })),
      summaries: new SummaryRepository(this.db).listForTarget("document", docId)
    };
  }

  /** Reads one exact document section by section ID or heading path. */
  getDocumentSection(docId: string, options: { sectionId?: string; heading?: readonly string[] }): DocumentSectionDetail {
    const document = this.getDocument(docId, "getDocumentSection");
    const sections = new SectionRepository(this.db).listByDocument(docId);
    const section =
      options.sectionId === undefined
        ? sections.find((candidate) => sameHeading(candidate.headingPath, options.heading ?? []))
        : sections.find((candidate) => candidate.sectionId === options.sectionId);
    if (section === undefined) {
      throw new ServerNotFoundError("Section was not found.", {
        operation: "getDocumentSection",
        entity: options.sectionId ?? options.heading?.join(" > ")
      });
    }

    return {
      section,
      provenance: provenanceFromDocument(document, section.headingPath)
    };
  }

  private getDocument(docId: string, operation: string): DocumentRecord {
    const document = new DocRepository(this.db).get(docId);
    if (document === undefined) {
      throw new ServerNotFoundError("Document was not found.", { operation, entity: docId });
    }
    return document;
  }
}

/** Repository inspection payload. */
export interface RepoDetail {
  repo: RepoRecord;
  manifest?: ManifestRecord | undefined;
  packages: PackageRecord[];
  modules: ModuleRecord[];
  documents: DocumentRecord[];
  skills: SkillRecord[];
  summaries: SummaryRecord[];
}

/** Freshness row comparing stored repo and manifest revisions. */
export interface FreshnessRecord {
  repoId: string;
  repoRevision: string;
  indexedRevision?: string | undefined;
  fresh: boolean;
  stale: boolean;
  indexed: boolean;
  lastSyncAt?: string | undefined;
  partialRevision?: string | undefined;
  partialBuildTimestamp?: string | undefined;
  partialSelector?: unknown;
  manifest?: ManifestRecord | undefined;
}

/** Skill detail payload. */
export interface SkillDetail {
  skill: SkillRecord;
  sourceDocument?: DocumentRecord | undefined;
  summaries: SummaryRecord[];
}

/** Compact document outline payload. */
export interface DocumentOutlineDetail {
  document: DocumentRecord;
  outline: Array<{
    sectionId: string;
    headingPath: string[];
    ordinal: number;
    preview: string;
  }>;
  summaries: SummaryRecord[];
}

/** Exact section read payload. */
export interface DocumentSectionDetail {
  section: SectionRecord;
  provenance: Provenance;
}

function provenanceFromDocument(document: DocumentRecord, headingPath?: readonly string[]) {
  return {
    repoId: document.repoId,
    ...(document.packageId === undefined ? {} : { packageId: document.packageId }),
    ...(document.moduleId === undefined ? {} : { moduleId: document.moduleId }),
    ...(document.skillId === undefined ? {} : { skillId: document.skillId }),
    docId: document.docId,
    path: document.path,
    ...(headingPath === undefined ? {} : { headingPath: [...headingPath] }),
    sourceVersion: document.sourceVersion,
    authority: document.authority
  };
}

function sameHeading(left: readonly string[], right: readonly string[]): boolean {
  return left.length === right.length && left.every((value, index) => value === right[index]);
}
