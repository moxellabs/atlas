const QUERY_EXPANSIONS: ReadonlyArray<readonly [RegExp, readonly string[]]> = [
	[/\bartifacts?\b/i, [".moxel/atlas", "public artifact", "corpus artifact"]],
	[/\bmcp\b/i, ["model context protocol", "tools", "server"]],
	[/\brepo\s+imports?\b/i, ["repo add", "artifact", "without cloning"]],
	[/\bcorpus\b/i, ["SQLite", "store", "index"]],
	[/\bpublish(?:es|ed|ing)?\b/i, ["release", "build", "artifact"]],
];

/** Adds small Atlas-specific vocabulary expansions for lexical retrieval. */
export function expandQuery(query: string): string {
	const terms = [query.trim()];
	const seen = new Set(normalizeTerms(query));
	for (const [pattern, expansions] of QUERY_EXPANSIONS) {
		if (!pattern.test(query)) {
			continue;
		}
		for (const expansion of expansions) {
			const key = expansion.toLowerCase();
			if (!seen.has(key)) {
				seen.add(key);
				terms.push(expansion);
			}
		}
	}
	return terms.filter((term) => term.length > 0).join(" ");
}

function normalizeTerms(query: string): string[] {
	return query
		.toLowerCase()
		.split(/\s+/)
		.map((term) => term.trim())
		.filter((term) => term.length > 0);
}
