import type { AtlasTopologyRule } from "@atlas/config";

/** Stable built-in topology template names supported by the CLI. */
export type TopologyTemplate =
	| "mixed-monorepo"
	| "package-top-level"
	| "module-local-docs";

/** Returns built-in topology rules for a supported template. */
export function topologyTemplate(
	template: TopologyTemplate,
): AtlasTopologyRule[] {
	if (template === "package-top-level") {
		return [
			{
				id: "repo-docs",
				kind: "repo-doc",
				match: { include: ["docs/**/*.md"], exclude: ["docs/archive/**/*.md"] },
				ownership: { attachTo: "repo" },
				authority: "canonical",
				priority: 10,
			},
			{
				id: "package-docs",
				kind: "package-doc",
				match: { include: ["packages/*/docs/**/*.md"] },
				ownership: { attachTo: "package" },
				authority: "preferred",
				priority: 20,
			},
			{
				id: "skills",
				kind: "skill-doc",
				match: { include: ["**/{skill,SKILL}.md"] },
				ownership: { attachTo: "skill", skillPattern: "**/{skill,SKILL}.md" },
				authority: "canonical",
				priority: 30,
			},
		];
	}

	if (template === "module-local-docs") {
		return [
			{
				id: "module-docs",
				kind: "module-doc",
				match: {
					include: ["*/docs/**/*.md"],
					exclude: ["*/docs/**/{skill,SKILL}.md"],
				},
				ownership: { attachTo: "module", moduleRootPattern: "*/docs/**/*.md" },
				authority: "preferred",
				priority: 10,
			},
			{
				id: "skills",
				kind: "skill-doc",
				match: { include: ["**/{skill,SKILL}.md"] },
				ownership: { attachTo: "skill", skillPattern: "**/{skill,SKILL}.md" },
				authority: "canonical",
				priority: 20,
			},
		];
	}

	return [
		{
			id: "repo-docs",
			kind: "repo-doc",
			match: { include: ["docs/**/*.md"], exclude: ["docs/archive/**/*.md"] },
			ownership: { attachTo: "repo" },
			authority: "canonical",
			priority: 10,
		},
		{
			id: "package-docs",
			kind: "package-doc",
			match: { include: ["{apps,packages}/*/docs/**/*.md"] },
			ownership: { attachTo: "package" },
			authority: "preferred",
			priority: 20,
		},
		{
			id: "module-docs",
			kind: "module-doc",
			match: {
				include: ["{apps,packages}/*/src/**/docs/**/*.md"],
				exclude: ["{apps,packages}/*/src/**/docs/**/{skill,SKILL}.md"],
			},
			ownership: {
				attachTo: "module",
				moduleRootPattern: "{apps,packages}/*/src/**/docs/**/*.md",
			},
			authority: "preferred",
			priority: 30,
		},
		{
			id: "skills",
			kind: "skill-doc",
			match: { include: ["**/{skill,SKILL}.md"] },
			ownership: { attachTo: "skill", skillPattern: "**/{skill,SKILL}.md" },
			authority: "canonical",
			priority: 40,
		},
	];
}
