import type { Authority } from "../enums/authority.enum";
import type { DocKind } from "../enums/doc-kind.enum";
import type { QueryKind } from "../enums/query-kind.enum";
import type { Provenance } from "./provenance.types";

/** User retrieval query accepted by retrieval planners. */
export interface RetrievalQuery {
	text: string;
	kind?: QueryKind | undefined;
	tokenBudget?: number | undefined;
}

/** Candidate or selected retrieval hit. */
export interface RetrievalHit {
	chunkId: string;
	docId: string;
	repoId: string;
	path: string;
	kind: DocKind;
	authority: Authority;
	score: number;
	text: string;
	provenance: Provenance;
}

/** Ambiguous retrieval result requiring caller disambiguation. */
export interface AmbiguousRetrievalResult {
	query: RetrievalQuery;
	candidates: RetrievalHit[];
	reason: string;
}

/** Planned context item selected for a response. */
export interface PlannedContextItem {
	hit: RetrievalHit;
	reason: string;
	tokenCount: number;
}

/** Final planned context bundle for an answer. */
export interface PlannedContext {
	query: RetrievalQuery;
	items: PlannedContextItem[];
	totalTokenCount: number;
}
