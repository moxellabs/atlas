import {
  listSkills as listApplicationSkills,
  readDocumentOutline,
  readDocumentSection,
  readFreshness,
  readSkill,
  type DocumentOutlineResult,
  type DocumentSectionResult,
  type FreshnessResult,
  type SkillDetailResult,
} from "@atlas/retrieval";
import {
  DocRepository,
  getStoreDiagnostics,
  ManifestRepository,
  ModuleRepository,
  PackageRepository,
  RepoRepository,
  SkillRepository,
  SummaryRepository,
  type AtlasStoreClient,
  type DocumentRecord,
  type ManifestRecord,
  type ModuleRecord,
  type PackageRecord,
  type RepoRecord,
  type SkillRecord,
  type StoreDiagnostics,
  type SummaryRecord,
} from "@atlas/store";

import { ServerNotFoundError } from "../errors";

/** Read-only facade over store repositories used by HTTP routes. */
export class StoreReadService {
  constructor(private readonly db: AtlasStoreClient) {}

  /** Returns store diagnostics suitable for health and inspect surfaces. */
  diagnostics(): StoreDiagnostics {
    return getStoreDiagnostics(this.db);
  }

  /** Lists stored repositories with manifest metadata. */
  listRepos(): Array<{
    repo: RepoRecord;
    manifest?: ManifestRecord | undefined;
  }> {
    return new RepoRepository(this.db).list().map((repo) => ({
      repo,
      manifest: new ManifestRepository(this.db).get(repo.repoId),
    }));
  }

  /** Reads one repository or throws a route-safe not-found error. */
  getRepo(repoId: string): RepoRecord {
    const repo = new RepoRepository(this.db).get(repoId);
    if (repo === undefined) {
      throw new ServerNotFoundError("Repository was not found.", {
        operation: "getRepo",
        entity: repoId,
      });
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
      summaries: new SummaryRepository(this.db).listForTarget("repo", repoId),
    };
  }

  /** Returns manifest records for every known repo. */
  listManifests(): ManifestRecord[] {
    return this.listRepos().flatMap((entry) =>
      entry.manifest === undefined ? [] : [entry.manifest],
    );
  }

  /** Returns freshness rows comparing indexed and current stored revisions. */
  listFreshness(): FreshnessRecord[] {
    return readFreshness(this.db);
  }

  /** Lists skills with optional scope filters. */
  listSkills(filter: {
    repoId?: string;
    packageId?: string;
    moduleId?: string;
    limit?: number;
  }): SkillRecord[] {
    return listApplicationSkills(this.db, filter).map(({ skill }) => skill);
  }

  /** Reads one skill or throws a route-safe not-found error. */
  getSkill(skillId: string): SkillDetail {
    return readSkill(this.db, skillId);
  }

  /** Reads a compact document outline or throws a route-safe not-found error. */
  getDocumentOutline(docId: string): DocumentOutlineDetail {
    return readDocumentOutline(this.db, docId);
  }

  /** Reads one exact document section by section ID or heading path. */
  getDocumentSection(
    docId: string,
    options: { sectionId?: string; heading?: readonly string[] },
  ): DocumentSectionDetail {
    return readDocumentSection(this.db, docId, options);
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

export type FreshnessRecord = FreshnessResult;

/** Skill detail payload. */
export type SkillDetail = SkillDetailResult;

/** Compact document outline payload. */
export type DocumentOutlineDetail = DocumentOutlineResult;

/** Exact section read payload. */
export type DocumentSectionDetail = DocumentSectionResult;
