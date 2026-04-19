import { describe, expect, test } from "bun:test";
import {
	type ClassifiedDoc,
	createDocId,
	createSkillId,
	type DocMetadataRule,
	type SkillNode,
} from "@atlas/core";

import {
	buildContextualChunkHeader,
	buildDocSummary,
	buildModuleSummary,
	buildOutline,
	CompilerFrontmatterError,
	compileMarkdownDocument,
	extractCodeBlocks,
	extractFrontmatter,
	extractSkill,
	parseMarkdown,
} from "./index";

const repoId = "atlas";
const moduleId = "mod_auth";
const skillId = createSkillId({
	repoId,
	moduleId,
	path: "Auth/docs/login-skill",
});

const moduleDoc: ClassifiedDoc = {
	docId: createDocId({ repoId, path: "Auth/docs/guide.md" }),
	repoId,
	path: "Auth/docs/guide.md",
	kind: "module-doc",
	authority: "preferred",
	scopes: [{ level: "module", repoId, moduleId }],
	moduleId,
	diagnostics: [],
};

const skillDoc: ClassifiedDoc = {
	docId: createDocId({ repoId, path: "Auth/docs/login-skill/skill.md" }),
	repoId,
	path: "Auth/docs/login-skill/skill.md",
	kind: "skill-doc",
	authority: "canonical",
	scopes: [{ level: "skill", repoId, moduleId, skillId }],
	moduleId,
	skillId,
	diagnostics: [],
};

const markdown = `---
title: Auth Guide
tags:
  - auth
  - security
---
Lead content before any heading.

# Overview
The auth module verifies sessions.

## Usage
- Create a token
- Validate the token

\`\`\`ts
export const ok = true;
\`\`\`

### Details
Nested detail text.
`;

describe("compiler markdown pipeline", () => {
	test("extracts optional frontmatter and fails explicitly on malformed markers", () => {
		expect(extractFrontmatter("No metadata\n").present).toBe(false);
		expect(extractFrontmatter("---\ntitle: Hello\n---\n# Body").data).toEqual({
			title: "Hello",
		});
		expect(() => extractFrontmatter("---\ntitle: [\n---\n# Body")).toThrow(
			CompilerFrontmatterError,
		);
	});

	test("parses, normalizes, and builds golden canonical document output", () => {
		const result = compileMarkdownDocument({
			markdown,
			classifiedDoc: moduleDoc,
			sourceVersion: "rev_1",
		});

		expect(result.parsed.frontmatter.present).toBe(true);
		expect(result.canonical.title).toEqual({
			title: "Auth Guide",
			source: "frontmatter",
		});
		expect(result.canonical.document).toEqual({
			docId: moduleDoc.docId,
			repoId,
			path: "Auth/docs/guide.md",
			sourceVersion: "rev_1",
			title: "Auth Guide",
			kind: "module-doc",
			authority: "preferred",
			scopes: [{ level: "module", repoId, moduleId }],
			sections: [
				expect.objectContaining({
					headingPath: [],
					ordinal: 0,
					text: "Lead content before any heading.",
					codeBlocks: [],
				}),
				expect.objectContaining({
					headingPath: ["Overview"],
					ordinal: 1,
					text: "The auth module verifies sessions.",
					codeBlocks: [],
				}),
				expect.objectContaining({
					headingPath: ["Overview", "Usage"],
					ordinal: 2,
					text: "- Create a token\n- Validate the token",
					codeBlocks: [{ lang: "ts", code: "export const ok = true;" }],
				}),
				expect.objectContaining({
					headingPath: ["Overview", "Usage", "Details"],
					ordinal: 3,
					text: "Nested detail text.",
					codeBlocks: [],
				}),
			],
			metadata: {
				moduleId,
				audience: ["contributor"],
				purpose: ["implementation"],
				visibility: "internal",
				tags: ["auth", "security"],
			},
		});
	});

	test("uses deterministic title precedence after frontmatter", () => {
		const h1 = compileMarkdownDocument({
			markdown: "# Primary\n\n## Secondary",
			classifiedDoc: moduleDoc,
			sourceVersion: "rev_1",
		});
		const skippedH1 = compileMarkdownDocument({
			markdown: "### Deep Heading\nText",
			classifiedDoc: moduleDoc,
			sourceVersion: "rev_1",
		});

		expect(h1.canonical.title).toEqual({ title: "Primary", source: "h1" });
		expect(skippedH1.canonical.title).toEqual({
			title: "Deep Heading",
			source: "heading",
		});
	});

	test("extracts ordered code blocks from parsed and canonical artifacts", () => {
		const result = compileMarkdownDocument({
			markdown,
			classifiedDoc: moduleDoc,
			sourceVersion: "rev_1",
		});

		expect(extractCodeBlocks(result.parsed)).toEqual([
			{ lang: "ts", code: "export const ok = true;", ordinal: 0 },
		]);
		expect(extractCodeBlocks(result.canonical.document.sections)).toEqual([
			{
				lang: "ts",
				code: "export const ok = true;",
				ordinal: 2,
				headingPath: ["Overview", "Usage"],
			},
		]);
	});

	test("builds outline, document summary, and module summary deterministically", () => {
		const document = compileMarkdownDocument({
			markdown,
			classifiedDoc: moduleDoc,
			sourceVersion: "rev_1",
		}).canonical.document;

		expect(buildOutline(document).outline).toEqual([
			{
				headingPath: [],
				ordinal: 0,
				preview: "Lead content before any heading.",
			},
			{
				headingPath: ["Overview"],
				ordinal: 1,
				preview: "The auth module verifies sessions.",
			},
			{
				headingPath: ["Overview", "Usage"],
				ordinal: 2,
				preview: "- Create a token - Validate the token",
			},
			{
				headingPath: ["Overview", "Usage", "Details"],
				ordinal: 3,
				preview: "Nested detail text.",
			},
		]);
		expect(buildDocSummary(document, { level: "short" }).summary).toMatchObject(
			{
				targetType: "document",
				targetId: moduleDoc.docId,
				level: "short",
				text: "Auth Guide. Lead content before any heading.",
			},
		);
		expect(buildModuleSummary([document], { moduleId }).summary).toMatchObject({
			targetType: "module",
			targetId: moduleId,
			level: "medium",
		});
	});

	test("extracts skill metadata and contextual retrieval headers", () => {
		const skillNode: SkillNode = {
			skillId,
			repoId,
			moduleId,
			path: "Auth/docs/login-skill/skill.md",
			title: "Login Skill",
			sourceDocPath: "Auth/docs/login-skill/skill.md",
			topics: [],
			aliases: [],
			tokenCount: 0,
			diagnostics: [],
		};
		const document = compileMarkdownDocument({
			markdown:
				"---\ntopics:\n  - auth\n  - login\naliases: login helper, auth login\n---\n# Login Skill\nUse this to validate login flows.\n\n## Usage\nRun the login checklist.",
			classifiedDoc: skillDoc,
			sourceVersion: "rev_2",
		});

		expect(
			extractSkill({
				skill: skillNode,
				classifiedDoc: skillDoc,
				document: document.canonical.document,
				frontmatter: document.parsed.frontmatter.data,
			}).skill,
		).toEqual({
			skillId,
			title: "Login Skill",
			description: "Use this to validate login flows.",
			headings: [["Login Skill"], ["Login Skill", "Usage"]],
			keySections: ["Run the login checklist."],
			topics: ["auth", "login"],
			aliases: ["auth login", "login helper"],
			tokenCount: expect.any(Number),
		});
		expect(
			buildContextualChunkHeader({
				repoId,
				moduleId,
				skillId,
				docKind: "skill-doc",
				authority: "canonical",
				title: "Login Skill",
				headingPath: ["Login Skill", "Usage"],
			}).text,
		).toBe(
			`repo: atlas | module: ${moduleId} | skill: ${skillId} | kind: skill-doc | authority: canonical | title: Login Skill | section: Login Skill > Usage`,
		);
	});

	test("supports content before headings, heading jumps, code-only docs, GFM lists, and empty docs", () => {
		const leading = compileMarkdownDocument({
			markdown: "Intro\n\n### Jump\n- [x] Done",
			classifiedDoc: moduleDoc,
			sourceVersion: "rev_1",
		}).canonical.document;
		const codeOnly = compileMarkdownDocument({
			markdown: "```sh\necho ok\n```",
			classifiedDoc: moduleDoc,
			sourceVersion: "rev_1",
		}).canonical.document;
		const empty = compileMarkdownDocument({
			markdown: "",
			classifiedDoc: moduleDoc,
			sourceVersion: "rev_1",
		}).canonical.document;

		expect(leading.sections.map((section) => section.headingPath)).toEqual([
			[],
			["", "", "Jump"],
		]);
		expect(leading.sections[1]?.text).toBe("- [x] Done");
		expect(codeOnly.sections).toEqual([
			expect.objectContaining({
				headingPath: [],
				text: "",
				codeBlocks: [{ lang: "sh", code: "echo ok" }],
			}),
		]);
		expect(empty.sections).toEqual([
			expect.objectContaining({ headingPath: [], text: "", codeBlocks: [] }),
		]);
	});

	test("keeps parsing AST-based for GFM tables", () => {
		const parsed = parseMarkdown("| Name | Value |\n| --- | --- |\n| A | B |");

		expect(parsed.ast.children[0]?.type).toBe("table");
	});
});

describe("document metadata classification", () => {
	function compilePath(
		path: string,
		markdown = "# Title\n",
		metadataRules: DocMetadataRule[] = [],
	) {
		return compileMarkdownDocument({
			markdown,
			classifiedDoc: {
				docId: createDocId({ repoId, path }),
				repoId,
				path,
				kind: "repo-doc",
				authority: "canonical",
				scopes: [{ level: "repo", repoId }],
				diagnostics: [],
			},
			sourceVersion: "rev",
			metadataRules,
		}).canonical;
	}

	test("applies built-in metadata defaults", () => {
		expect(compilePath("README.md").document.metadata).toMatchObject({
			visibility: "public",
			audience: ["consumer"],
			purpose: ["guide"],
		});
		expect(compilePath("docs/guide.md").document.metadata).toMatchObject({
			visibility: "public",
			audience: ["consumer"],
			purpose: ["guide", "reference"],
		});
		expect(compilePath("docs/archive/old.md").document.metadata).toMatchObject({
			visibility: "internal",
			audience: ["internal"],
			purpose: ["archive"],
		});
		expect(
			compilePath("skills/example/SKILL.md").document.metadata,
		).toMatchObject({
			visibility: "public",
			audience: ["consumer"],
			purpose: ["workflow"],
		});
		expect(
			compilePath(".planning/phases/25/PLAN.md").document.metadata,
		).toMatchObject({
			visibility: "internal",
			audience: ["internal"],
			purpose: ["planning", "implementation"],
		});
		expect(
			compilePath("packages/core/src/notes.md").document.metadata,
		).toMatchObject({
			visibility: "internal",
			audience: ["contributor"],
			purpose: ["implementation"],
		});
	});

	test("merges config rules and frontmatter overrides with diagnostics", () => {
		const rule: DocMetadataRule = {
			id: "maintainers",
			match: { include: ["docs/maintainers/**"] },
			metadata: { audience: ["maintainer"] },
			priority: 10,
		};
		expect(
			compilePath("docs/maintainers/runbook.md", "# Runbook\n", [rule]).document
				.metadata.audience,
		).toEqual(["maintainer"]);
		const overridden = compilePath(
			"docs/maintainers/runbook.md",
			"---\naudience: consumer\nvisibility: public\norder: 20\n---\n# Runbook\n",
			[rule],
		);
		expect(overridden.document.metadata).toMatchObject({
			audience: ["consumer"],
			visibility: "public",
			order: 20,
		});
		const invalid = compilePath(
			"docs/guide.md",
			"---\nvisibility: private\n---\n# Guide\n",
		);
		expect(
			invalid.diagnostics.some(
				(diagnostic) =>
					diagnostic.code === "ATLAS_DOC_METADATA_INVALID_FRONTMATTER",
			),
		).toBe(true);
		expect(invalid.document.metadata.visibility).toBe("public");
	});
});
