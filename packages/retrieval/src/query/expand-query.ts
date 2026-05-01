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
		/\bfrontmatter\b|\bbuilt-in defaults?\b|\bsupported visibility\b|\bmetadata precedence\b|\bprofile metadata\b|\bprivate profile\b|\bpublic default profile\b/i,
		["profile metadata", "frontmatter", "docs/configuration.md"],
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
		/\brepo show\b|\btarget inference\b|\bexplicit flags\b|\batlas repo\b|\bbunx @moxellabs\/atlas\b|\b--json\b|\b--verbose\b/i,
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
		/\bredacts?\b|\bsanitiz(?:e|es|ed|ation)\b|\bcookies?\b|\bprivate URLs?\b|\bproprietary document content\b|\btoken-like\b/i,
		["sanitized diagnostics", "safe sharing", "docs/troubleshooting.md"],
	],
	[
		/\bsecurity\b|\bcredentials?\b|\blocal-first\b|\bremote source content\b|\bupload indexed corpus\b/i,
		["security", "credentials", "tokens", "docs/security.md", "README.md"],
	],
	[
		/\bvalidation\b|\bimport fails?\b|\bprevious global rows\b|\brepo\.json\b/i,
		["artifact validation", "repo.json", "docs/ingestion-build-flow.md"],
	],
	[
		/\bgenerated\b|\bvendor\b|\bnode_modules\b|\bdist\b|\bcoverage\b|\bignored\b/i,
		["generated", "vendor", "ignored", "docs/troubleshooting.md"],
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
