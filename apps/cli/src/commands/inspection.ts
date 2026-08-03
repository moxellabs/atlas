import {
  DocRepository,
  ManifestRepository,
  ModuleRepository,
  PackageRepository,
  RepoRepository,
  SectionRepository,
  SkillRepository,
  SummaryRepository,
} from "@atlas/store";
import type { AtlasCliDependencies } from "../runtime/types";
/** Resolves cached doc/skill inspection data directly from the store. */
export function inspectArtifacts(db: AtlasCliDependencies["db"]) {
  return {
    repos: new RepoRepository(db),
    manifests: new ManifestRepository(db),
    packages: new PackageRepository(db),
    modules: new ModuleRepository(db),
    docs: new DocRepository(db),
    sections: new SectionRepository(db),
    skills: new SkillRepository(db),
    summaries: new SummaryRepository(db),
  };
}

/** Executes retrieval planning directly against the local store. */
export function inspectRetrievalPlan(
  deps: AtlasCliDependencies,
  query: string,
  repoId?: string,
  budgetTokens = 1200,
) {
  const startedAt = performance.now();
  const classification = deps.retrieval.classifyQuery(query);
  const scopes = deps.retrieval.inferScopes({
    query,
    classification,
    ...(repoId === undefined ? {} : { repoId }),
  });
  const plan = deps.retrieval.planContext({
    query,
    ...(repoId === undefined ? {} : { repoId }),
    budgetTokens,
  });
  return {
    classification,
    scopes,
    plan,
    timings: {
      retrievalLatencyMs: Math.round(performance.now() - startedAt),
    },
  };
}
