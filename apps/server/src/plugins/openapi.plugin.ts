import { openapi } from "@elysiajs/openapi";

import { VERSION } from "../constants";
import { openApiTags } from "../openapi/route-docs";

const documentation = {
	info: {
		title: "MOXEL ATLAS Local API",
		version: VERSION,
		description: [
			'<section class="atlas-docs-hero">',
			'<p class="atlas-docs-eyebrow">Local-first docs runtime</p>',
			"<h1>Start building with your local engineering knowledge base.</h1>",
			'<p class="atlas-docs-lede">Atlas turns indexed repository docs into search, context planning, canonical document reads, generated skills, operations, and an MCP bridge. Use this Scalar page as the product docs and the API reference.</p>',
			'<div class="atlas-docs-actions"><a href="#tag/Retrieval">Search docs</a><a href="#tag/Documents">Read source docs</a><a href="#tag/MCP">Connect agents</a><a href="/openapi.json">Download OpenAPI JSON</a></div>',
			"</section>",
			"",
			'<section class="atlas-docs-cards">',
			"<article><strong>1 · Confirm runtime</strong><span>Call <code>GET /health</code> and <code>GET /api/repos</code> to verify local store readiness and indexed repositories.</span></article>",
			"<article><strong>2 · Ask a docs question</strong><span>Call <code>POST /api/search/docs</code> with <code>session rotation</code>, then use results to choose source material.</span></article>",
			"<article><strong>3 · Build model context</strong><span>Call <code>POST /api/context/plan</code> with <code>budgetTokens: 2000</code> for model-ready local context.</span></article>",
			"<article><strong>4 · Read exact docs</strong><span>Use <code>/api/docs/{docId}/outline</code> and section reads for canonical public artifact text.</span></article>",
			"</section>",
			"",
			"## Quickstart",
			"1. Start the server with `atlas serve`.",
			"2. Open `/docs` for this Scalar-backed product/API reference.",
			"3. Check `GET /health` to confirm local store, OpenAPI, and MCP readiness.",
			"4. List indexed repositories with `GET /api/repos`.",
			"5. Search the local corpus with `POST /api/search/docs` using `session rotation`.",
			"6. Build model-ready context with `POST /api/context/plan` and `budgetTokens: 2000`.",
			"7. Use `/openapi.json` for automation and generated clients.",
			"",
			'<section class="atlas-docs-workflow">',
			"<h2>Common workflows</h2>",
			"<div><strong>Explore indexed knowledge</strong><p>Use Repositories and Inspection routes to see what Atlas knows before querying.</p></div>",
			"<div><strong>Answer documentation questions</strong><p>Use Retrieval routes to infer scopes, search chunks, and package selected context.</p></div>",
			"<div><strong>Ground answers in source docs</strong><p>Use Documents routes to read exact outlines and section text from public artifacts.</p></div>",
			"<div><strong>Operate local artifacts</strong><p>Use Operations routes from trusted loopback clients for sync and incremental builds.</p></div>",
			"</section>",
			"",
			"## Safety model",
			"Retrieval reads the local corpus and does not fetch remote source at query time. Mutation routes are intended for loopback/local development use. Examples use safe placeholder values such as `github.com/org/repo`, `docs/runtime-surfaces.md`, `session rotation`, `document-codebase`, and `How does authentication work?`. Do not put tokens, secrets, or credential-bearing values in examples or client snippets.",
		].join("\n"),
	},
	servers: [
		{
			url: "http://127.0.0.1:3000",
			description: "Default loopback Atlas server",
		},
	],
	tags: [...openApiTags],
};

const exclude = {
	staticFile: true,
	methods: ["options", "head", "trace", "patch"],
};

/** Registers OpenAPI documentation for the local HTTP API. */
export const openApiPlugin = openapi({
	documentation,
	exclude,
	path: "/openapi",
	provider: null,
	specPath: "/openapi/json",
}).use(
	openapi({
		documentation,
		exclude,
		path: "/openapi",
		provider: null,
		specPath: "/openapi.json",
	}),
);
