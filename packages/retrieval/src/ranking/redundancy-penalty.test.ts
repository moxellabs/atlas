import { describe, expect, test } from "bun:test";

import type { RetrievalCandidate } from "../types";
import { redundancyPenalty } from "./redundancy-penalty";

function candidate(
	overrides: Partial<RetrievalCandidate> = {},
): RetrievalCandidate {
	return {
		targetType: "section",
		targetId: "section:one",
		provenance: {
			repoId: "repo",
			path: "docs/one.md",
			docId: "doc:one",
			sourceVersion: "abc",
			authority: "canonical",
		},
		authority: "canonical",
		textPreview: "Atlas retrieves local documentation context for agents.",
		...overrides,
	};
}

describe("redundancyPenalty", () => {
	test("penalizes duplicate target identity most strongly", () => {
		expect(redundancyPenalty(candidate(), [candidate()])).toBe(1);
	});

	test("penalizes same document and target type", () => {
		const current = candidate({ targetId: "section:two" });
		expect(redundancyPenalty(current, [candidate()])).toBe(0.36);
	});

	test("penalizes similar previews across documents", () => {
		const previous = candidate({
			provenance: { ...candidate().provenance, docId: "doc:two" },
		});
		const current = candidate({ targetId: "section:two" });
		expect(redundancyPenalty(current, [previous])).toBe(0.36);
	});

	test("ignores empty previews and unrelated candidates", () => {
		const previous = candidate({ targetId: "section:two", textPreview: "" });
		const current = candidate({
			targetId: "section:three",
			provenance: { ...candidate().provenance, docId: "doc:three" },
			textPreview: "different content",
		});
		expect(redundancyPenalty(current, [previous])).toBe(0);
	});
});
