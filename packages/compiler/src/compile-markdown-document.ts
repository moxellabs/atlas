import { buildCanonicalDocument } from "./canonical/build-canonical-doc";
import { normalizeMarkdown } from "./parse/normalize-markdown";
import { parseMarkdown } from "./parse/parse-markdown";
import type {
	CompileMarkdownDocumentInput,
	CompileMarkdownDocumentResult,
} from "./types";

/** Runs the deterministic v1 markdown compilation pipeline through canonical document assembly. */
export function compileMarkdownDocument(
	input: CompileMarkdownDocumentInput,
): CompileMarkdownDocumentResult {
	const parsed = parseMarkdown(input.markdown, {
		path: input.classifiedDoc.path,
	});
	const normalized = normalizeMarkdown(parsed);
	const canonical = buildCanonicalDocument({
		classifiedDoc: input.classifiedDoc,
		sourceVersion: input.sourceVersion,
		normalized,
		metadataRules: input.metadataRules,
	});
	return { parsed, normalized, canonical };
}
