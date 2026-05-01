import type { Authority } from "../enums/authority.enum";
import type { DocKind } from "../enums/doc-kind.enum";

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
	/** Optional indexing-only text used for lexical retrieval without changing stored chunk text. */
	searchText?: string | undefined;
	tokenCount: number;
}
