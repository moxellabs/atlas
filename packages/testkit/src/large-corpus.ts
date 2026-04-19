import type { FakeRepoFile } from "./fake-repo";

export interface LargeCorpusOptions {
	packageCount: number;
	docsPerPackage: number;
	sectionsPerDoc: number;
	archiveDocs?: number | undefined;
}

/** Creates deterministic repository-relative Markdown files for large-corpus smoke tests. */
export function createLargeCorpusFiles(
	options: LargeCorpusOptions,
): FakeRepoFile[] {
	const files: FakeRepoFile[] = [];
	for (
		let packageIndex = 0;
		packageIndex < options.packageCount;
		packageIndex += 1
	) {
		const packageName = `pkg-${packageIndex.toString().padStart(2, "0")}`;
		files.push({
			path: `packages/${packageName}/package.json`,
			content: `${JSON.stringify({ name: `@atlas/${packageName}` }, null, 2)}\n`,
		});
		for (let docIndex = 0; docIndex < options.docsPerPackage; docIndex += 1) {
			files.push({
				path: `packages/${packageName}/docs/topic-${docIndex.toString().padStart(2, "0")}.md`,
				content: largeDoc({
					packageName,
					docIndex,
					sectionsPerDoc: options.sectionsPerDoc,
					archived: false,
				}),
			});
		}
	}
	for (
		let archiveIndex = 0;
		archiveIndex < (options.archiveDocs ?? 0);
		archiveIndex += 1
	) {
		files.push({
			path: `docs/archive/legacy-${archiveIndex.toString().padStart(2, "0")}.md`,
			content: largeDoc({
				packageName: "archive",
				docIndex: archiveIndex,
				sectionsPerDoc: options.sectionsPerDoc,
				archived: true,
			}),
		});
	}
	return files;
}

function largeDoc(input: {
	packageName: string;
	docIndex: number;
	sectionsPerDoc: number;
	archived: boolean;
}): string {
	const lines = [
		`# ${input.archived ? "Archived" : "Large Corpus"} ${input.packageName} ${input.docIndex}`,
		"",
		`Authority: ${input.archived ? "supplemental" : "preferred"}`,
		`Freshness: ${input.archived ? "historical" : "current"}`,
		"",
	];
	for (
		let sectionIndex = 0;
		sectionIndex < input.sectionsPerDoc;
		sectionIndex += 1
	) {
		lines.push(
			`## Topic ${sectionIndex}`,
			"",
			`Large corpus retrieval topic ${sectionIndex} for ${input.packageName} document ${input.docIndex}.`,
			`This section describes build planning, incremental rebuild, token budget, omission diagnostics, and context planning for ${input.packageName}.`,
			"",
		);
	}
	return `${lines.join("\n")}\n`;
}
