/** Structured source-git event emitted for logs, telemetry, and tests. */
export interface SourceGitDiagnosticEvent {
	/** Stable event name intended for programmatic consumers. */
	type:
		| "clone_started"
		| "clone_completed"
		| "cache_validated"
		| "sparse_checkout_applied"
		| "sparse_checkout_disabled"
		| "current_checkout_sparse_detected"
		| "fetch_started"
		| "fetch_completed"
		| "revision_changed"
		| "revision_unchanged"
		| "diff_computed"
		| "relevant_paths_filtered";
	/** ATLAS repo identifier associated with the event, when available. */
	repoId?: string | undefined;
	/** Persistent local checkout path associated with the event, when available. */
	localPath?: string | undefined;
	/** Optional event-specific scalar details. */
	details?: Record<string, string | number | boolean> | undefined;
}

/** Callback used by callers that want streaming source-git diagnostics. */
export type SourceGitDiagnosticSink = (event: SourceGitDiagnosticEvent) => void;

/**
 * Records a diagnostic event in an operation-local list and forwards it to the
 * optional sink without making diagnostics part of control flow.
 */
export function recordDiagnostic(
	diagnostics: SourceGitDiagnosticEvent[],
	sink: SourceGitDiagnosticSink | undefined,
	event: SourceGitDiagnosticEvent,
): void {
	diagnostics.push(event);
	sink?.(event);
}
