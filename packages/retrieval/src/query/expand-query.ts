const QUERY_EXPANSIONS: ReadonlyArray<readonly [RegExp, readonly string[]]> = [
	[/\bartifacts?\b/i, [".moxel/atlas", "public artifact", "corpus artifact"]],
	[/\bmcp\b/i, ["model context protocol", "tools", "server"]],
	[/\brepo\s+imports?\b/i, ["repo add", "artifact", "without cloning"]],
	[/\bcorpus\b/i, ["SQLite", "store", "index"]],
	[
		/\bpublish(?:es|ed|ing)?\b/i,
		["release", "build", "artifact", "docs/ingestion-build-flow.md"],
	],
	[
		/\bretriv?al\b|\bretrieval\b/i,
		["retrieval", "retrieval context", "docs/retrieval-and-context.md"],
	],
	[/\bcontxt\b|\bcontext\b/i, ["context", "plan context", "context packet"]],
	[/\bplaning\b|\bplanning\b/i, ["planning", "plan context"]],
	[/\bbudjet\b|\bbudget\b/i, ["budget", "token budget"]],
	[
		/\bomissions?\b|\bdiagnostics?\b/i,
		["omission diagnostics", "omitted", "diagnostics"],
	],
	[
		/\bprofile\b|\ball-profiles\b|\baudience\b|\bvisibility\b/i,
		[
			"profile",
			"audience",
			"purpose",
			"visibility",
			"docs/retrieval-and-context.md",
		],
	],
	[
		/\b(?:atlas\s+)?build\b|\bpublic artifact\b|\bchecksums?\b|\bdocs\.index\.json\b/i,
		[
			"atlas build --profile public",
			"public artifact",
			"docs.index.json",
			"docs/ingestion-build-flow.md",
		],
	],
	[
		/\brepo show\b|\btarget inference\b|\bexplicit flags\b/i,
		[
			"repo show",
			"repo target inference",
			"explicit flags",
			"apps/cli/docs/index.md",
		],
	],
	[
		/\bdoctor\b|\bstore readiness\b|\blocal prerequisites\b/i,
		["doctor", "store readiness", "docs/runtime-surfaces.md"],
	],
	[
		/\blocal SQLite corpus\b|\blocal corpus\b|\b~\/\.moxel\/atlas\/corpus\.db\b/i,
		[
			"local corpus",
			"~/.moxel/atlas/corpus.db",
			"docs/runtime-surfaces.md",
			"packages/store/docs/index.md",
		],
	],
	[
		/\binspect retrieval\b|\bretrieval planning diagnostics\b/i,
		["inspect retrieval", "--query", "README.md"],
	],
	[
		/\bsecurity\b|\bcredentials?\b|\blocal-first\b|\bremote source content\b|\bupload indexed corpus\b/i,
		["security", "credentials", "tokens", "docs/security.md", "README.md"],
	],
	[
		/\.planning|\barchive\b|\binternal visibility\b/i,
		[
			".planning/**",
			"docs/archive/**",
			"visibility: internal",
			"docs/ingestion-build-flow.md",
		],
	],
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
