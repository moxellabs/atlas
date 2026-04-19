import type { Authority } from "../enums";

/** Exact source provenance attached to generated or retrieved artifacts. */
export interface Provenance {
  repoId: string;
  packageId?: string | undefined;
  moduleId?: string | undefined;
  skillId?: string | undefined;
  docId: string;
  path: string;
  headingPath?: string[] | undefined;
  sourceVersion: string;
  authority: Authority;
}

/** Minimal source revision provenance for raw source reads. */
export interface SourceProvenance {
  repoId: string;
  path: string;
  revision: string;
}
