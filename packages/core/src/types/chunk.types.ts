import type { Authority, DocKind } from "../enums";

/** Searchable corpus chunk emitted by the compiler. */
export interface CorpusChunk {
  chunkId: string;
  docId: string;
  repoId: string;
  packageId?: string | undefined;
  moduleId?: string | undefined;
  skillId?: string | undefined;
  kind: DocKind;
  authority: Authority;
  headingPath: string[];
  ordinal: number;
  text: string;
  tokenCount: number;
}
