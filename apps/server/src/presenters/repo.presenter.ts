import type { ManifestRecord, RepoRecord, StoreDiagnostics } from "@atlas/store";

import type { FreshnessRecord, RepoDetail, SkillDetail } from "../services/store-read.service";

/** Presents store diagnostics for local operator surfaces. */
export function presentStoreDiagnostics(diagnostics: StoreDiagnostics) {
  return diagnostics;
}

/** Presents repository list entries with manifest freshness. */
export function presentRepoList(entries: RepoListEntry[]) {
  return entries.map(({ repo, manifest }) => ({
    repoId: repo.repoId,
    mode: repo.mode,
    revision: repo.revision,
    updatedAt: repo.updatedAt,
    indexedRevision: manifest?.indexedRevision,
    fresh: manifest?.indexedRevision === repo.revision,
    manifest
  }));
}

/** Presents one repository inspection snapshot. */
export function presentRepoDetail(detail: RepoDetail) {
  return {
    repo: detail.repo,
    manifest: detail.manifest,
    summaries: detail.summaries,
    counts: {
      packages: detail.packages.length,
      modules: detail.modules.length,
      documents: detail.documents.length,
      skills: detail.skills.length
    },
    packages: detail.packages,
    modules: detail.modules,
    documents: detail.documents.map((document) => ({
      docId: document.docId,
      path: document.path,
      kind: document.kind,
      authority: document.authority,
      title: document.title,
      packageId: document.packageId,
      moduleId: document.moduleId,
      skillId: document.skillId
    })),
    skills: detail.skills
  };
}

/** Presents freshness records for inspect APIs. */
export function presentFreshness(records: FreshnessRecord[]) {
  return records;
}

/** Presents one skill detail response. */
export function presentSkillDetail(detail: SkillDetail) {
  return detail;
}

interface RepoListEntry {
  repo: RepoRecord;
  manifest?: ManifestRecord | undefined;
}
