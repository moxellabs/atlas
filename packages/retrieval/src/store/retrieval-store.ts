import {
  ChunkRepository,
  DocRepository,
  lexicalSearch,
  ManifestRepository,
  ModuleRepository,
  PackageRepository,
  pathSearch,
  RepoRepository,
  SectionRepository,
  SkillRepository,
  SummaryRepository,
  scopeSearch,
  type StoreDatabase,
} from "@atlas/store";

import type { RetrievalStore } from "../types";

/**
 * Creates the read-only retrieval port used by planner and scope inference hot paths.
 * Repository adapters are allocated once at the composition boundary, never per query.
 */
export function createRetrievalStore(db: StoreDatabase): RetrievalStore {
  const docs = new DocRepository(db);
  const summaries = new SummaryRepository(db);
  const chunks = new ChunkRepository(db);
  const sections = new SectionRepository(db);
  const skills = new SkillRepository(db);
  const repos = new RepoRepository(db);
  const manifests = new ManifestRepository(db);
  const packages = new PackageRepository(db);
  const modules = new ModuleRepository(db);

  return {
    lexicalSearch: (options) => lexicalSearch(db, options),
    pathSearch: (options) => pathSearch(db, options),
    scopeSearch: (options) => scopeSearch(db, options),
    getDocument: (docId) => docs.get(docId),
    listDocumentsByRepo: (repoId, options) => docs.listByRepo(repoId, options),
    listSummaries: (targetType, targetId) =>
      summaries.listForTarget(targetType, targetId),
    listSectionsByDocument: (docId) => sections.listByDocument(docId),
    getChunk: (chunkId) => chunks.getById(chunkId),
    getSection: (sectionId) => sections.getById(sectionId),
    getSkill: (skillId) => skills.get(skillId),
    listSkillsByRepo: (repoId, scope) => skills.listByRepo(repoId, scope),
    getRepo: (repoId) => repos.get(repoId),
    listRepos: () => repos.list(),
    getManifest: (repoId) => manifests.get(repoId),
    getPackage: (packageId) => packages.get(packageId),
    listPackagesByRepo: (repoId) => packages.listByRepo(repoId),
    getModule: (moduleId) => modules.get(moduleId),
    listModulesByRepo: (repoId) => modules.listByRepo(repoId),
  };
}
