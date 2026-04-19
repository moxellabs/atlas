import type { RepoConfig } from "@atlas/core";
import type { BuildReport } from "./types/indexer.types";

export type DocumentationSignalLevel = "strong" | "weak" | "readme-only";
export type DocumentationSignalWarningCode =
	| "README_ONLY_DOCS"
	| "WEAK_DOCS_SIGNAL";

export interface DocumentationSignalWarning {
	code: DocumentationSignalWarningCode;
	message: string;
}

export interface DocumentationSignal {
	markdownFileCount: number;
	readmeFileCount: number;
	totalMarkdownBytes: number;
	signal: DocumentationSignalLevel;
	warnings: DocumentationSignalWarning[];
}

export interface IndexLocalOnlyRepoInput {
	repo: RepoConfig;
	repoId: string;
	checkoutPath: string;
	globalDbPath: string;
	ref: string;
	forceWeakDocs: boolean;
	ensureCheckout(): Promise<unknown>;
	listFiles(): Promise<string[]>;
	readFile(path: string): Promise<string | Uint8Array>;
	buildImport(): Promise<BuildReport>;
}

export interface IndexLocalOnlyRepoResult {
	repoId: string;
	checkoutPath: string;
	globalDbPath: string;
	documentationSignal: DocumentationSignal;
	imported: boolean;
	counts: Record<string, number>;
	diagnostics: Array<{ code?: string; message: string }>;
}

export async function analyzeDocumentationSignal(
	files: readonly string[],
	readFile: (path: string) => Promise<string | Uint8Array>,
): Promise<DocumentationSignal> {
	const markdownFiles = files.filter((file) => /\.mdx?$/i.test(file));
	let totalMarkdownBytes = 0;
	for (const file of markdownFiles) {
		const content = await readFile(file);
		totalMarkdownBytes +=
			typeof content === "string"
				? Buffer.byteLength(content)
				: content.byteLength;
	}
	const readmeFileCount = markdownFiles.filter(isReadmePath).length;
	const readmeOnly = markdownFiles.length === 1 && readmeFileCount === 1;
	const weak = markdownFiles.length < 3 || totalMarkdownBytes < 2000;
	const warnings: DocumentationSignalWarning[] = [];
	if (readmeOnly) {
		warnings.push({
			code: "README_ONLY_DOCS",
			message: "Repository documentation appears to be README-only.",
		});
	} else if (weak) {
		warnings.push({
			code: "WEAK_DOCS_SIGNAL",
			message: "Repository documentation signal is weak.",
		});
	}
	return {
		markdownFileCount: markdownFiles.length,
		readmeFileCount,
		totalMarkdownBytes,
		signal: readmeOnly ? "readme-only" : weak ? "weak" : "strong",
		warnings,
	};
}

export async function indexLocalOnlyRepo(
	input: IndexLocalOnlyRepoInput,
): Promise<IndexLocalOnlyRepoResult> {
	await input.ensureCheckout();
	const files = await input.listFiles();
	const documentationSignal = await analyzeDocumentationSignal(
		files,
		input.readFile,
	);
	if (documentationSignal.signal !== "strong" && !input.forceWeakDocs) {
		return {
			repoId: input.repoId,
			checkoutPath: input.checkoutPath,
			globalDbPath: input.globalDbPath,
			documentationSignal,
			imported: false,
			counts: {},
			diagnostics: documentationSignal.warnings.map((warning) => ({
				code: warning.code,
				message: warning.message,
			})),
		};
	}
	const report = await input.buildImport();
	return {
		repoId: input.repoId,
		checkoutPath: input.checkoutPath,
		globalDbPath: input.globalDbPath,
		documentationSignal,
		imported: !report.diagnostics.some(
			(diagnostic) => diagnostic.severity === "error",
		),
		counts: { docs: report.docsRebuilt, chunks: report.chunksPersisted },
		diagnostics: report.diagnostics.map((diagnostic) => ({
			...(diagnostic.code === undefined ? {} : { code: diagnostic.code }),
			message: diagnostic.message,
		})),
	};
}

function isReadmePath(path: string): boolean {
	const normalized = path.replaceAll("\\", "/");
	return /^readme\.md$/i.test(normalized) || /\/readme\.md$/i.test(normalized);
}
