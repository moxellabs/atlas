import { describe, expect, test } from "bun:test";

import { createChunkId } from "./chunk-id";
import { createDocId } from "./doc-id";
import { createModuleId } from "./module-id";
import { createPackageId } from "./package-id";
import { createSectionId } from "./section-id";
import { createSkillId } from "./skill-id";

describe("stable ID helpers", () => {
	test("create deterministic structural IDs", () => {
		const repoId = "github.mycorp.com/platform/docs";
		expect(createDocId({ repoId, path: "docs/guide.md" })).toBe(
			createDocId({ repoId, path: "docs/guide.md" }),
		);
		expect(createPackageId({ repoId, path: "packages/core" })).toBe(
			createPackageId({ repoId, path: "/packages\\core" }),
		);
		expect(createDocId({ repoId, path: "docs/guide.md" })).toBe(
			"doc_1e1ee4f91ca56b817fcfff4f",
		);
	});

	test("different relevant inputs produce different IDs", () => {
		expect(createDocId({ repoId: "atlas", path: "docs/a.md" })).not.toBe(
			createDocId({ repoId: "atlas", path: "docs/b.md" }),
		);
		expect(
			createModuleId({ repoId: "atlas", packageId: "pkg_a", path: "src/auth" }),
		).not.toBe(
			createModuleId({ repoId: "atlas", packageId: "pkg_b", path: "src/auth" }),
		);
	});

	test("section and chunk IDs validate ordinals", () => {
		const sectionId = createSectionId({
			docId: "doc_a",
			headingPath: ["Intro"],
			ordinal: 0,
		});

		expect(sectionId).toStartWith("section_");
		expect(
			createChunkId({ docId: "doc_a", sectionId, ordinal: 3 }),
		).toStartWith("chunk_");
		expect(() =>
			createSectionId({ docId: "doc_a", headingPath: [], ordinal: -1 }),
		).toThrow(TypeError);
	});

	test("skill IDs include optional package and module identity", () => {
		expect(
			createSkillId({ repoId: "atlas", path: "skills/setup.md" }),
		).not.toBe(
			createSkillId({
				repoId: "atlas",
				packageId: "pkg_core",
				moduleId: "mod_setup",
				path: "skills/setup.md",
			}),
		);
	});
});
