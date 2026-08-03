const secretPatterns = [
	/\b(?:gh[pousr]_[A-Za-z0-9_]+|github_pat_[A-Za-z0-9_]+|npm_[A-Za-z0-9_-]+|sk-[A-Za-z0-9_-]+)\b/g,
	/\b(?:Bearer|token|secret|password)\s*[:=]\s*[^\s,;]+/gi,
];

/** Keeps public evidence bounded and removes common credential and local-path forms. */
export function sanitizeEvalText(value: string, limit = 12_000): string {
	let sanitized = value;
	for (const pattern of secretPatterns)
		sanitized = sanitized.replace(pattern, "[redacted]");
	sanitized = sanitized
		.replace(/\/(?:home|Users)\/[^\s"'`]+/g, "[local-path]")
		.replace(/(?:[A-Z]:\\Users\\)[^\s"'`]+/gi, "[local-path]");
	return sanitized.length <= limit
		? sanitized
		: `${sanitized.slice(0, limit)}\n[truncated]`;
}

export function sanitizeRepoPath(value: string): string {
	return value.startsWith("/") || /^[A-Z]:\\/i.test(value)
		? "[local-path]"
		: sanitizeEvalText(value, 512);
}
