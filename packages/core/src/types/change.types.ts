import type { NormalizedContentChangeKind } from "../enums/normalized-change-kind.enum";
import type { RawSourceChangeKind } from "../enums/raw-change-kind.enum";

/** A source-system change preserving raw fidelity and normalized rebuild semantics. */
export interface SourceChange {
	/** High-fidelity source-system change kind. */
	rawKind: RawSourceChangeKind;
	/** Processing-friendly content invalidation kind. */
	normalizedKind: NormalizedContentChangeKind;
	/** Current repository-relative path, or deleted path for deletions. */
	path: string;
	/** Previous repository-relative path for rename and copy changes. */
	oldPath?: string | undefined;
}
