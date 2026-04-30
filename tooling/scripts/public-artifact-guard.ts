import { Database } from "bun:sqlite";
import { join } from "node:path";

const artifactDir = Bun.argv[2] ?? ".moxel/atlas";
const sourceRoot = Bun.argv[3] ?? ".";
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

const internalSourcePaths: string[] = [];
for (const doc of docsIndex.documents ?? []) {
	if (typeof doc.path !== "string") continue;
	const sourceFile = Bun.file(join(sourceRoot, doc.path));
	if (!(await sourceFile.exists())) continue;
	const text = await sourceFile.text();
	if (/^---\s*[\s\S]*?^visibility:\s*internal\s*$/m.test(text)) {
		internalSourcePaths.push(doc.path);
	}
}
if (internalSourcePaths.length > 0) {
	throw new Error(
		`public artifact docs.index.json includes source files marked visibility: internal: ${internalSourcePaths.join(", ")}`,
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
