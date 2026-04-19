import type { DocumentRecord } from "@atlas/store";
import type { RepoConfig } from "@atlas/core";

import { IndexerIncrementalBuildError } from "../errors/indexer-errors";
import type { IndexerDependencies, RepoTopologySnapshot } from "../services/create-indexer-services";
import type { AffectedDocs, BuildSelection, IncrementalBuildPlan } from "../types/indexer.types";

/** Collects the exact document and skill sets affected by a build plan. */
export async function collectAffectedDocs(
  repo: RepoConfig,
  plan: IncrementalBuildPlan,
  deps: IndexerDependencies
): Promise<AffectedDocs> {
  try {
    const source = deps.getSourceAdapter(repo);
    const topology = await deps.resolveTopology(repo, source);
    const docsByPath = new Map(topology.docs.map((doc) => [doc.path, doc] as const));
    const skillsBySourceDocPath = new Map(topology.skills.map((skill) => [skill.sourceDocPath, skill] as const));
    const storedDocs = deps.store.docs.listByRepo(repo.repoId);
    const storedSkills = deps.store.skills.listByRepo(repo.repoId);

    const selectedDocs = selectDocs(plan, topology, storedDocs);
    const deletedStoredDocIds = collectDeletedStoredDocIds(plan, storedDocs, docsByPath);
    const deletedStoredSkillIds = storedSkills
      .filter((skill) => deletedStoredDocIds.includes(skill.sourceDocId) || !skillsBySourceDocPath.has(skill.sourceDocPath))
      .map((skill) => skill.skillId);
    const deletedModuleIds = storedDocs
      .filter((storedDoc) => deletedStoredDocIds.includes(storedDoc.docId) && storedDoc.moduleId !== undefined)
      .map((storedDoc) => storedDoc.moduleId as string);
    const affectedModuleIds = [...new Set([...selectedDocs.flatMap((doc) => (doc.moduleId ? [doc.moduleId] : [])), ...deletedModuleIds])].sort(
      (left, right) => left.localeCompare(right)
    );

    return {
      repoId: repo.repoId,
      packages: topology.packages,
      modules: topology.modules,
      docsByPath,
      skillsBySourceDocPath,
      allDocs: topology.docs,
      allSkills: topology.skills,
      selectedDocs,
      deletedStoredDocIds,
      deletedStoredSkillIds,
      affectedModuleIds
    };
  } catch (cause) {
    throw new IndexerIncrementalBuildError(`Failed to collect affected docs for ${repo.repoId}.`, {
      operation: "collectAffectedDocs",
      stage: "planning",
      repoId: repo.repoId,
      cause
    });
  }
}

function selectDocs(plan: IncrementalBuildPlan, topology: RepoTopologySnapshot, storedDocs: DocumentRecord[]) {
  if (plan.strategy === "full") {
    return [...topology.docs].sort((left, right) => left.path.localeCompare(right.path));
  }
  if (plan.strategy === "targeted") {
    return selectTargetedDocs(plan.selection, topology, storedDocs);
  }
  if (plan.strategy === "incremental") {
    const affected = new Set(plan.affectedDocPaths);
    return topology.docs.filter((doc) => affected.has(doc.path)).sort((left, right) => left.path.localeCompare(right.path));
  }
  return [];
}

function selectTargetedDocs(
  selection: BuildSelection | undefined,
  topology: RepoTopologySnapshot,
  storedDocs: DocumentRecord[]
) {
  if (!selection) {
    return [];
  }
  if (selection.docIds && selection.docIds.length > 0) {
    const targetIds = new Set(selection.docIds);
    const selected = topology.docs.filter((doc) => targetIds.has(doc.docId));
    const missing = selection.docIds.filter((docId) => !selected.some((doc) => doc.docId === docId) && !storedDocs.some((doc) => doc.docId === docId));
    if (missing.length > 0) {
      throw new TypeError(`Unknown document IDs requested for targeted build: ${missing.join(", ")}.`);
    }
    return selected.sort((left, right) => left.path.localeCompare(right.path));
  }
  if (selection.packageId) {
    const selected = topology.docs
      .filter((doc) => doc.packageId === selection.packageId || doc.scopes.some((scope) => scope.level === "package" && scope.packageId === selection.packageId))
      .sort((left, right) => left.path.localeCompare(right.path));
    if (selected.length === 0) {
      throw new TypeError(`Unknown package ID requested for targeted build: ${selection.packageId}.`);
    }
    return selected;
  }
  const selected = topology.docs
    .filter((doc) => doc.moduleId === selection.moduleId || doc.scopes.some((scope) => scope.level === "module" && scope.moduleId === selection.moduleId))
    .sort((left, right) => left.path.localeCompare(right.path));
  if (selected.length === 0) {
    throw new TypeError(`Unknown module ID requested for targeted build: ${selection.moduleId}.`);
  }
  return selected;
}

function collectDeletedStoredDocIds(
  plan: IncrementalBuildPlan,
  storedDocs: DocumentRecord[],
  docsByPath: Map<string, AffectedDocs["selectedDocs"][number]>
): string[] {
  if (plan.strategy === "full") {
    return storedDocs.filter((stored) => !docsByPath.has(stored.path)).map((stored) => stored.docId);
  }
  const deletedPaths = new Set(plan.deletedDocPaths);
  return storedDocs.filter((stored) => deletedPaths.has(stored.path)).map((stored) => stored.docId);
}
