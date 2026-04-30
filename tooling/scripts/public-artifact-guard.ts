import { Database } from "bun:sqlite";
import { join } from "node:path";

const artifactDir = Bun.argv[2] ?? ".moxel/atlas";
const forbiddenPrefixes = ["docs/prd/", "docs/archive/", ".planning/"] as const;

function forbidden(path: string): string | undefined {
	return forbiddenPrefixes.find((prefix) => path.startsWith(prefix));
}

const docsIndexPath = join(artifactDir, "docs.index.json");
const docsIndex = (await Bun.file(docsIndexPath).json()) as {
	documents?: Array<{ path?: unknown }>;
};
const forbiddenIndexPaths = (docsIndex.documents ?? [])
	.map((doc) => (typeof doc.path === "string" ? doc.path : undefined))
	.filter(
		(path): path is string =>
			path !== undefined && forbidden(path) !== undefined,
	);

if (forbiddenIndexPaths.length > 0) {
	throw new Error(
		`public artifact docs.index.json includes forbidden paths: ${forbiddenIndexPaths.join(", ")}`,
	);
}

const db = new Database(join(artifactDir, "corpus.db"), { readonly: true });
try {
	const documentPaths = db
		.query<{ path: string }, []>("SELECT path FROM documents")
		.all()
		.map((row) => row.path)
		.filter((path) => forbidden(path) !== undefined);
	const ftsPaths = db
		.query<{ path: string }, []>(
			`SELECT d.path
			 FROM fts_entries f
			 JOIN documents d ON d.doc_id = f.doc_id`,
		)
		.all()
		.map((row) => row.path)
		.filter((path) => forbidden(path) !== undefined);
	const leaked = [...new Set([...documentPaths, ...ftsPaths])];
	if (leaked.length > 0) {
		throw new Error(
			`public artifact corpus.db includes forbidden paths: ${leaked.join(", ")}`,
		);
	}
} finally {
	db.close();
}

console.log(`Public artifact guard passed: ${artifactDir}`);
