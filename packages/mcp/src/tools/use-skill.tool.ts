import { provenanceFromDocument } from "@atlas/retrieval";
import type { SkillRecord } from "@atlas/store";
import { SectionRepository, SkillRepository } from "@atlas/store";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";

import { toolResult } from "../mcp-result";
import { useSkillOutputSchema } from "../schemas/tool-output-schemas";
import {
  type UseSkillInput,
  useSkillInputSchema,
} from "../schemas/tool-schemas";
import {
  getDocument,
  getFreshnessForSkillRepo,
  listSkillArtifacts,
  listSummaries,
} from "../store-mappers";
import type { AtlasMcpDependencies, McpJsonObject } from "../types";

export const USE_SKILL_TOOL = "use_skill";

const DEFAULT_SKILL_LIMIT = 20;
const MIN_AUTOMATIC_MATCH_SCORE = 12;
const MIN_AUTOMATIC_MATCH_GAP = 4;
const TASK_STOP_WORDS = new Set([
  "a",
  "an",
  "and",
  "any",
  "approved",
  "atla",
  "bundle",
  "bundled",
  "complete",
  "can",
  "could",
  "do",
  "for",
  "help",
  "how",
  "i",
  "identify",
  "instruction",
  "in",
  "me",
  "my",
  "need",
  "of",
  "on",
  "or",
  "new",
  "please",
  "prepare",
  "procedure",
  "reference",
  "repository",
  "return",
  "script",
  "skill",
  "should",
  "the",
  "to",
  "want",
  "with",
  "would",
]);

interface RankedSkill {
  skill: SkillRecord;
  score: number;
  matchedTerms: string[];
}

/** Browses stored skills or resolves one into portable agent instructions. */
export function executeUseSkill(
  input: UseSkillInput,
  dependencies: AtlasMcpDependencies,
): McpJsonObject {
  const parsed = useSkillInputSchema.parse(input);
  const repository = new SkillRepository(dependencies.db);
  const prefix = dependencies.identity?.resourcePrefix ?? "atlas";
  const skills = listScopedSkills(repository, parsed);
  const limit = parsed.limit ?? DEFAULT_SKILL_LIMIT;

  if (parsed.skill !== undefined) {
    const matches = resolveExactSkillMatches(skills, parsed.skill, prefix);
    if (matches.length === 0) {
      return useSkillOutputSchema.parse({
        status: "not_found",
        skill: parsed.skill,
        diagnostics: [
          {
            stage: "resolution",
            message:
              "No stored skill matched the requested ID, title, or alias in the selected scope.",
          },
        ],
        recommendedNextActions: [
          "Call use_skill without skill to browse the selected scope, or pass a natural-language task.",
        ],
      });
    }
    if (matches.length > 1) {
      return ambiguousResult({
        candidates: matches.slice(0, limit),
        repository,
        prefix,
        skill: parsed.skill,
        message:
          "Multiple stored skills matched the requested title or alias in the selected scope.",
      });
    }
    return resolvedSkillResult(
      matches[0] as SkillRecord,
      parsed,
      dependencies,
      prefix,
      "exact",
    );
  }

  if (parsed.task !== undefined) {
    const terms = meaningfulTaskTerms(parsed.task);
    const ranked = rankSkills(skills, terms);
    if (ranked.length === 0) {
      return useSkillOutputSchema.parse({
        status: "not_found",
        task: parsed.task,
        diagnostics: [
          {
            stage: "resolution",
            message:
              "No stored skill matched the meaningful terms in the requested task.",
          },
        ],
        recommendedNextActions: [
          "Broaden the task description or call use_skill without task to browse the selected scope.",
        ],
      });
    }

    const best = ranked[0] as RankedSkill;
    const runnerUp = ranked[1];
    if (canResolveTaskAutomatically(best, runnerUp, terms.length)) {
      return resolvedSkillResult(
        best.skill,
        parsed,
        dependencies,
        prefix,
        "task",
        best,
      );
    }

    return ambiguousResult({
      candidates: ranked.slice(0, limit).map((match) => match.skill),
      matches: new Map(
        ranked.slice(0, limit).map((match) => [match.skill.skillId, match]),
      ),
      repository,
      prefix,
      task: parsed.task,
      message:
        "The task did not produce one complete, high-confidence skill match with a clear lead.",
    });
  }

  return useSkillOutputSchema.parse({
    status: "listed",
    total: skills.length,
    skills: skills
      .slice(0, limit)
      .map((skill) => presentSkillCandidate(skill, repository, prefix)),
    recommendedNextActions: [
      "Call use_skill with a listed skillId or invocation alias to load complete instructions.",
    ],
  });
}

/** Registers the unified use_skill MCP tool. */
export function registerUseSkillTool(
  server: McpServer,
  dependencies: AtlasMcpDependencies,
): void {
  const prefix = dependencies.identity?.resourcePrefix ?? "atlas";
  const title = dependencies.identity?.title ?? "ATLAS";
  server.registerTool(
    USE_SKILL_TOOL,
    {
      title: `Resolve ${title} skill and artifacts`,
      description: `Call first for any request for a repository-approved procedure, complete skill instructions, or bundled scripts, references, or agent profiles. Pass task once for a natural-language request; pass skill only when an exact ID, title, or alias such as $${prefix}-add-cli-command is already known. This is the only tool that returns the complete stored instructions and artifact inventory; do not substitute search_passages or shell/file search. Report artifact inventory paths, but do not quote or summarize artifact content unless the request asks for it. Exact and unambiguous matches return agent-ready instructions, provenance, and read-only artifacts; do not call again after status resolved.`,
      inputSchema: useSkillInputSchema,
      outputSchema: useSkillOutputSchema,
      annotations: {
        readOnlyHint: true,
        destructiveHint: false,
        idempotentHint: true,
        openWorldHint: false,
      },
    },
    (input) => toolResult(executeUseSkill(input, dependencies)),
  );
}

function listScopedSkills(
  repository: SkillRepository,
  scope: {
    repoId?: string | undefined;
    packageId?: string | undefined;
    moduleId?: string | undefined;
  },
): SkillRecord[] {
  const skills =
    scope.repoId === undefined
      ? repository.listAll()
      : repository.listByRepo(scope.repoId);
  return skills.filter(
    (skill) =>
      (scope.packageId === undefined || skill.packageId === scope.packageId) &&
      (scope.moduleId === undefined || skill.moduleId === scope.moduleId),
  );
}

function resolveExactSkillMatches(
  skills: readonly SkillRecord[],
  requestedSkill: string,
  prefix: string,
): SkillRecord[] {
  const normalized = normalizeAlias(requestedSkill, prefix);
  return skills.filter((skill) =>
    [
      skill.skillId,
      skill.title,
      skillSlug(skill.sourceDocPath),
      ...skill.aliases,
      ...invocationAliasesForSkill(skill, prefix),
    ].some((candidate) => normalizeAlias(candidate, prefix) === normalized),
  );
}

function rankSkills(
  skills: readonly SkillRecord[],
  terms: readonly string[],
): RankedSkill[] {
  if (terms.length === 0) return [];
  return skills
    .map((skill) => scoreSkill(skill, terms))
    .filter((match) => match.score > 0)
    .sort(
      (left, right) =>
        right.score - left.score ||
        left.skill.repoId.localeCompare(right.skill.repoId) ||
        left.skill.sourceDocPath.localeCompare(right.skill.sourceDocPath) ||
        left.skill.skillId.localeCompare(right.skill.skillId),
    );
}

function scoreSkill(skill: SkillRecord, terms: readonly string[]): RankedSkill {
  const fields = [
    { weight: 8, tokens: lexicalTerms(skill.title) },
    { weight: 8, tokens: lexicalTerms(skillSlug(skill.sourceDocPath)) },
    { weight: 7, tokens: lexicalTerms(skill.aliases.join(" ")) },
    { weight: 6, tokens: lexicalTerms(skill.topics.join(" ")) },
    { weight: 5, tokens: lexicalTerms(skill.headings.flat().join(" ")) },
    { weight: 4, tokens: lexicalTerms(skill.description) },
    { weight: 3, tokens: lexicalTerms(skill.keySections.join(" ")) },
  ];
  const matchedTerms: string[] = [];
  let score = 0;
  for (const term of terms) {
    let termScore = 0;
    for (const field of fields) {
      if (field.tokens.has(term)) termScore = Math.max(termScore, field.weight);
    }
    if (termScore > 0) {
      matchedTerms.push(term);
      score += termScore;
    }
  }
  return { skill, score, matchedTerms };
}

function canResolveTaskAutomatically(
  best: RankedSkill,
  runnerUp: RankedSkill | undefined,
  termCount: number,
): boolean {
  return (
    termCount > 0 &&
    best.matchedTerms.length === termCount &&
    best.score >= MIN_AUTOMATIC_MATCH_SCORE &&
    (runnerUp === undefined ||
      best.score - runnerUp.score >= MIN_AUTOMATIC_MATCH_GAP)
  );
}

function ambiguousResult(input: {
  candidates: readonly SkillRecord[];
  repository: SkillRepository;
  prefix: string;
  matches?: ReadonlyMap<string, RankedSkill>;
  skill?: string;
  task?: string;
  message: string;
}): McpJsonObject {
  return useSkillOutputSchema.parse({
    status: "ambiguous",
    ...(input.skill === undefined ? {} : { skill: input.skill }),
    ...(input.task === undefined ? {} : { task: input.task }),
    candidates: input.candidates.map((skill) =>
      presentSkillCandidate(
        skill,
        input.repository,
        input.prefix,
        input.matches?.get(skill.skillId),
      ),
    ),
    diagnostics: [{ stage: "resolution", message: input.message }],
    recommendedNextActions: [
      "Call use_skill with the skill field set to one candidate skillId or invocation alias.",
    ],
  });
}

function resolvedSkillResult(
  skill: SkillRecord,
  parsed: UseSkillInput,
  dependencies: AtlasMcpDependencies,
  prefix: string,
  method: "exact" | "task",
  match?: RankedSkill,
): McpJsonObject {
  const document = getDocument(dependencies.db, skill.sourceDocId);
  const sections =
    document === undefined
      ? []
      : new SectionRepository(dependencies.db).listByDocument(document.docId);
  const artifacts = listSkillArtifacts(dependencies.db, skill.skillId);
  const artifactInventory = {
    scripts: artifacts
      .filter((artifact) => artifact.kind === "script")
      .map((artifact) => artifact.path),
    references: artifacts
      .filter((artifact) => artifact.kind === "reference")
      .map((artifact) => artifact.path),
    agentProfiles: artifacts
      .filter((artifact) => artifact.kind === "agent-profile")
      .map((artifact) => artifact.path),
    other: artifacts
      .filter((artifact) => artifact.kind === "other")
      .map((artifact) => artifact.path),
  };
  const requestedAgent = parsed.agent?.trim().toLowerCase();
  const selectedAgentProfile =
    requestedAgent === undefined
      ? undefined
      : artifacts.find(
          (artifact) =>
            artifact.kind === "agent-profile" &&
            artifact.path.toLowerCase() === `agents/${requestedAgent}.yaml`,
        );

  return useSkillOutputSchema.parse({
    status: "resolved",
    resolution: {
      method,
      ...(match === undefined
        ? {}
        : {
            score: match.score,
            matchedTerms: match.matchedTerms,
          }),
    },
    ...(parsed.skill === undefined ? {} : { requestedSkill: parsed.skill }),
    ...(parsed.task === undefined ? {} : { task: parsed.task }),
    skill: {
      ...skill,
      invocationAliases: invocationAliasesForSkill(skill, prefix),
    },
    artifactInventory,
    artifacts: artifacts.map((artifact) => ({
      ...artifact,
      uri: `atlas://skill-artifact/${encodeURIComponent(skill.skillId)}/${artifact.path.split("/").map(encodeURIComponent).join("/")}`,
      execution: artifact.kind === "script" ? "served-only" : "not-executable",
    })),
    ...(selectedAgentProfile === undefined ? {} : { selectedAgentProfile }),
    instructions: {
      title: skill.title,
      description: skill.description,
      sourceDocumentPath: skill.sourceDocPath,
      markdown: sections.map((section) => section.text).join("\n\n"),
      keySections: skill.keySections,
    },
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
      "TERMINAL: answer_locally now from instructions.markdown and artifactInventory. Mention every artifactInventory path, including agent profiles. Do not quote or summarize artifacts[].content unless the task explicitly requests artifact contents. Do not call another Atlas retrieval tool.",
    ],
  });
}

function presentSkillCandidate(
  skill: SkillRecord,
  repository: SkillRepository,
  prefix: string,
  match?: RankedSkill,
) {
  const artifactSummary = repository.summarizeArtifacts(skill.skillId);
  return {
    skillId: skill.skillId,
    repoId: skill.repoId,
    ...(skill.packageId === undefined ? {} : { packageId: skill.packageId }),
    ...(skill.moduleId === undefined ? {} : { moduleId: skill.moduleId }),
    title: skill.title,
    description: skill.description,
    sourceDocPath: skill.sourceDocPath,
    topics: skill.topics,
    aliases: skill.aliases,
    tokenCount: skill.tokenCount,
    invocationAliases: invocationAliasesForSkill(skill, prefix),
    artifactSummary,
    hasScripts: artifactSummary.scripts > 0,
    ...(match === undefined
      ? {}
      : {
          match: {
            score: match.score,
            matchedTerms: match.matchedTerms,
          },
        }),
  };
}

function meaningfulTaskTerms(value: string): string[] {
  return [...lexicalTerms(value)].filter((term) => !TASK_STOP_WORDS.has(term));
}

function lexicalTerms(value: string | undefined): Set<string> {
  return new Set(
    (value?.toLowerCase().match(/[a-z0-9]+/g) ?? []).map(normalizeTerm),
  );
}

function normalizeTerm(term: string): string {
  if (term === "adding") return "add";
  if (term.length > 4 && term.endsWith("ies")) return `${term.slice(0, -3)}y`;
  if (term.length > 3 && term.endsWith("s") && !term.endsWith("ss"))
    return term.slice(0, -1);
  return term;
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
  if (file === undefined) return undefined;
  if (file.toLowerCase() === "skill.md") return parts.at(-2);
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

function normalizeAlias(value: string | undefined, prefix: string): string {
  const withoutDollar = value?.trim().replace(/^\$/, "").toLowerCase() ?? "";
  const normalizedPrefix = `${prefix.toLowerCase()}-`;
  return (
    slugify(
      withoutDollar.startsWith(normalizedPrefix)
        ? withoutDollar.slice(normalizedPrefix.length)
        : withoutDollar,
    ) ?? ""
  );
}
