import type { SkillRecord, StoreDatabase } from "@atlas/store";
import { SectionRepository, SkillRepository } from "@atlas/store";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";

import { toolResult } from "../mcp-result";
import {
	jsonOutputSchema,
	type UseSkillInput,
	useSkillInputSchema,
} from "../schemas/tool-schemas";
import {
	getDocument,
	getFreshnessForSkillRepo,
	listSkillArtifacts,
	listSummaries,
	provenanceFromDocument,
} from "../store-mappers";
import type { AtlasMcpDependencies, McpJsonObject } from "../types";

export const USE_SKILL_TOOL = "use_skill";

/** Resolves an ATLAS skill alias into portable agent instructions and read-only artifacts. */
export function executeUseSkill(
	input: UseSkillInput,
	dependencies: AtlasMcpDependencies,
): McpJsonObject {
	const parsed = useSkillInputSchema.parse(input);
	const aliasPrefix = dependencies.identity?.resourcePrefix ?? "atlas";
	const matches = resolveSkillMatches(
		dependencies.db,
		parsed.nameOrAlias,
		parsed.repoId,
		aliasPrefix,
	);
	if (matches.length === 0) {
		return {
			status: "not_found",
			query: parsed.nameOrAlias,
			diagnostics: [
				{
					stage: "resolution",
					message: "No ATLAS skill matched the requested name or alias.",
				},
			],
			recommendedNextActions: [
				"Call list_skills to inspect available ATLAS skills.",
				"Use a skillId or one of the listed invocationAliases.",
			],
		};
	}
	if (matches.length > 1) {
		return {
			status: "ambiguous",
			query: parsed.nameOrAlias,
			candidates: matches.map((skill) =>
				presentSkillCandidate(skill, aliasPrefix),
			),
			diagnostics: [
				{
					stage: "resolution",
					message: "Multiple ATLAS skills matched the requested name or alias.",
				},
			],
			recommendedNextActions: [
				"Call use_skill again with a skillId or a more specific invocation alias.",
			],
		};
	}

	const skill = matches[0] as SkillRecord;
	const document = getDocument(dependencies.db, skill.sourceDocId);
	const sections =
		document === undefined
			? []
			: new SectionRepository(dependencies.db).listByDocument(document.docId);
	const artifacts = listSkillArtifacts(dependencies.db, skill.skillId);
	const requestedAgent = parsed.agent?.trim().toLowerCase();
	const selectedAgentProfile =
		requestedAgent === undefined
			? undefined
			: artifacts.find(
					(artifact) =>
						artifact.kind === "agent-profile" &&
						artifact.path.toLowerCase() === `agents/${requestedAgent}.yaml`,
				);

	return {
		status: "ok",
		query: parsed.nameOrAlias,
		...(parsed.task === undefined ? {} : { task: parsed.task }),
		skill: {
			...skill,
			invocationAliases: invocationAliasesForSkill(
				skill,
				dependencies.identity?.resourcePrefix ?? "atlas",
			),
		},
		instructions: {
			title: skill.title,
			description: skill.description,
			sourceDocumentPath: skill.sourceDocPath,
			markdown: sections.map((section) => section.text).join("\n\n"),
			keySections: skill.keySections,
		},
		artifacts: artifacts.map((artifact) => ({
			...artifact,
			uri: `atlas://skill-artifact/${encodeURIComponent(skill.skillId)}/${artifact.path.split("/").map(encodeURIComponent).join("/")}`,
			execution: artifact.kind === "script" ? "served-only" : "not-executable",
		})),
		...(selectedAgentProfile === undefined ? {} : { selectedAgentProfile }),
		summaries: listSummaries(dependencies.db, "skill", skill.skillId),
		freshness: getFreshnessForSkillRepo(dependencies.db, skill),
		provenance:
			document === undefined
				? undefined
				: provenanceFromDocument(document, undefined, skill.skillId),
		diagnostics: [
			{
				stage: "execution-policy",
				message:
					"ATLAS serves skill artifacts as read-only source. Scripts are not executed by the ATLAS MCP server.",
			},
		],
		recommendedNextActions: [
			"Follow the returned skill instructions.",
			"Only run served scripts after applying the local agent or user approval policy.",
		],
	};
}

/** Registers the use_skill MCP tool. */
export function registerUseSkillTool(
	server: McpServer,
	dependencies: AtlasMcpDependencies,
): void {
	const prefix = dependencies.identity?.resourcePrefix ?? "atlas";
	const title = dependencies.identity?.title ?? "ATLAS";
	server.registerTool(
		USE_SKILL_TOOL,
		{
			title: `Use ${title} skill`,
			description: `Resolve a portable ${title} skill alias such as $${prefix}-add-cli-command and return agent-ready instructions, provenance, and read-only artifacts. Call this when a user asks to use a ${title} skill.`,
			inputSchema: useSkillInputSchema,
			outputSchema: jsonOutputSchema,
		},
		(input) => toolResult(executeUseSkill(input, dependencies)),
	);
}

function resolveSkillMatches(
	db: StoreDatabase,
	nameOrAlias: string,
	repoId: string | undefined,
	prefix = "atlas",
): SkillRecord[] {
	const normalized = normalizeAlias(nameOrAlias);
	const repoIds = repoId === undefined ? undefined : [repoId];
	const skills =
		repoIds === undefined
			? new SkillRepository(db).listAll()
			: repoIds.flatMap((id) => new SkillRepository(db).listByRepo(id));
	return skills.filter((skill) =>
		[
			skill.skillId,
			skill.title,
			skillSlug(skill.sourceDocPath),
			...skill.aliases,
			...invocationAliasesForSkill(skill, prefix),
		].some((candidate) => normalizeAlias(candidate) === normalized),
	);
}

function presentSkillCandidate(skill: SkillRecord, prefix = "atlas") {
	return {
		skillId: skill.skillId,
		title: skill.title,
		description: skill.description,
		sourceDocPath: skill.sourceDocPath,
		invocationAliases: invocationAliasesForSkill(skill, prefix),
	};
}

function invocationAliasesForSkill(
	skill: {
		title?: string | undefined;
		sourceDocPath: string;
		aliases: readonly string[];
	},
	prefix: string,
): string[] {
	const names = [
		skillSlug(skill.sourceDocPath),
		skill.title,
		...skill.aliases,
	].flatMap((value) => {
		const slug = slugify(value);
		return slug === undefined
			? []
			: [`${prefix}-${slug}`, `$${prefix}-${slug}`];
	});
	return [...new Set(names)].sort((left, right) => left.localeCompare(right));
}

function skillSlug(sourceDocPath: string): string | undefined {
	const parts = sourceDocPath.split("/").filter(Boolean);
	const file = parts.at(-1);
	if (file === undefined) {
		return undefined;
	}
	if (file.toLowerCase() === "skill.md") {
		return parts.at(-2);
	}
	return file.replace(/\.md$/i, "");
}

function slugify(value: string | undefined): string | undefined {
	const slug = value
		?.trim()
		.toLowerCase()
		.replace(/[^a-z0-9]+/g, "-")
		.replace(/^-+|-+$/g, "");
	return slug === undefined || slug.length === 0 ? undefined : slug;
}

function normalizeAlias(value: string | undefined): string {
	return slugify(value?.replace(/^\$/, "").replace(/^[a-z0-9]+-/i, "")) ?? "";
}
