import type { RepositoryRefreshState } from "@atlas/core";
import { classifyQuery, planContext } from "@atlas/retrieval";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";

import type { IndexedSourceCatalogEntry } from "../discovery/indexed-source-catalog";
import { toolResult } from "../mcp-result";
import { listIndexedCoverage } from "../store-mappers";
import {
  jsonOutputSchema,
  type PlanContextToolInput,
  planContextInputSchema,
} from "../schemas/tool-schemas";
import type { AtlasRetrievalMcpDependencies, McpJsonObject } from "../types";

export const PLAN_CONTEXT_TOOL = "plan_context";

const sourcePlanContextInputSchema = z
  .object({
    query: z
      .string()
      .trim()
      .min(1)
      .describe("The question to answer from this indexed source."),
  })
  .strict();

interface PlanCitation {
  repoId: string;
  path: string;
  docId: string;
}

/** Executes token-budgeted context planning for an MCP caller. */
export function executePlanContext(
  input: PlanContextToolInput,
  dependencies: AtlasRetrievalMcpDependencies,
): McpJsonObject {
  return buildPlanContextResult(input, dependencies);
}

function buildPlanContextResult(
  input: PlanContextToolInput,
  dependencies: AtlasRetrievalMcpDependencies,
) {
  const parsed = planContextInputSchema.parse(input);
  const plan = planContext({
    store: dependencies.retrievalStore,
    query: parsed.query,
    budgetTokens: parsed.budgetTokens,
    ...(parsed.repoId === undefined ? {} : { repoId: parsed.repoId }),
    ...(parsed.candidateLimit === undefined
      ? {}
      : { candidateLimit: parsed.candidateLimit }),
    ...(parsed.summaryLimit === undefined
      ? {}
      : { summaryLimit: parsed.summaryLimit }),
    ...(parsed.expansionLimit === undefined
      ? {}
      : { expansionLimit: parsed.expansionLimit }),
    filters: {
      ...(parsed.profile === undefined ? {} : { profile: parsed.profile }),
      ...(parsed.audience === undefined ? {} : { audience: parsed.audience }),
      ...(parsed.purpose === undefined ? {} : { purpose: parsed.purpose }),
      ...(parsed.visibility === undefined
        ? {}
        : { visibility: parsed.visibility }),
    },
  });
  const selected = plan.selected ?? [];
  const freshnessByRepo = new Map(
    listIndexedCoverage(dependencies.db).map((coverage) => [
      coverage.repoId,
      coverage.freshness,
    ]),
  );
  const refreshStateByRepo = new Map(
    [...new Set(selected.map((entry) => entry.provenance.repoId))].map(
      (repoId) => [
        repoId,
        dependencies.repositoryRefreshStateProvider?.getRepositoryRefreshState(
          repoId,
        ),
      ],
    ),
  );
  const stale = selected.some((entry) => {
    const repoId = entry.provenance.repoId;
    const refreshStatus = refreshStateByRepo.get(repoId)?.status;
    if (refreshStatus === "fresh") return false;
    if (refreshStatus === "stale" || refreshStatus === "refresh_failed") {
      return true;
    }
    return freshnessByRepo.get(repoId)?.stale === true;
  });
  const coverage =
    selected.length === 0
      ? "absent"
      : stale
        ? "stale"
        : plan.ambiguity !== undefined
          ? "partial"
          : "sufficient";
  const nextAction =
    coverage === "sufficient"
      ? "answer_locally"
      : coverage === "partial"
        ? "refine_locally"
        : "web_fallback";
  const citations = uniqueCitations(selected);
  return {
    query: parsed.query,
    coverage: {
      status: coverage,
      selectedSources: uniqueSelectedSources(
        selected,
        freshnessByRepo,
        refreshStateByRepo,
      ),
    },
    nextAction,
    context: plan.contextPacket,
    citations,
    ...(classifyQuery(parsed.query).kind === "diff"
      ? { recentChanges: recentRepositoryChanges(refreshStateByRepo) }
      : {}),
    ...(parsed.detail === "debug" ? { debug: plan } : {}),
  };
}

/** Registers the plan_context MCP tool. */
export function registerPlanContextTool(
  server: McpServer,
  dependencies: AtlasRetrievalMcpDependencies,
  options: { description?: string } = {},
) {
  return server.registerTool(
    PLAN_CONTEXT_TOOL,
    {
      title: "Answer from indexed documentation",
      description:
        options.description ??
        "Use this first to answer a question about an indexed library, framework, API, or repository. Searches the corpus and returns sufficient, partial, absent, or stale evidence with source-relative citations and the next safe action. When coverage is sufficient and context.evidence supports the required claims, answer immediately without calling find_docs, read_section, expand_related, web, or filesystem tools. Retrieve more only when a required claim is unsupported. Use repoId when the source is known.",
      inputSchema: planContextInputSchema,
      outputSchema: jsonOutputSchema,
      annotations: {
        readOnlyHint: true,
        destructiveHint: false,
        idempotentHint: true,
        openWorldHint: false,
      },
      _meta: { "anthropic/alwaysLoad": true },
    },
    (input) => toolResult(executePlanContext(input, dependencies)),
  );
}

/** Registers a source-bound answer tool that is discoverable by source name. */
export function registerSourcePlanContextTool(
  server: McpServer,
  dependencies: AtlasRetrievalMcpDependencies,
  source: IndexedSourceCatalogEntry,
) {
  const name = `answer_${source.toolSuffix}_docs`;
  return {
    name,
    handle: server.registerTool(
      name,
      {
        title: `Answer from ${source.title} documentation`,
        description: `Answer a question from the ${source.fresh ? "fresh" : "stale"} indexed ${source.title} documentation corpus (${source.documentCount} documents), which is independent of the client's current workspace. Returns focused exact passages and source-relative citations. When coverage is sufficient and the returned evidence supports the required claims, answer immediately without calling another retrieval tool or repeating this tool. Source names: ${source.aliases.slice(0, 8).join(", ")}. Covered topics: ${source.topics.slice(0, 24).join(", ")}.`,
        inputSchema: sourcePlanContextInputSchema,
        outputSchema: jsonOutputSchema,
        annotations: {
          readOnlyHint: true,
          destructiveHint: false,
          idempotentHint: true,
          openWorldHint: false,
        },
        _meta: { "anthropic/alwaysLoad": true },
      },
      (input) => {
        const result = buildPlanContextResult(
          {
            query: input.query,
            repoId: source.repoId,
            budgetTokens: 4_000,
            candidateLimit: 40,
          },
          dependencies,
        );
        return toolResult({
          ...result,
          exactPassages: selectExactPassages(
            input.query,
            result.citations,
            dependencies,
          ),
        });
      },
    ),
  };
}

function uniqueSelectedSources(
  selected: readonly {
    provenance: { repoId: string };
  }[],
  freshnessByRepo: ReadonlyMap<
    string,
    { readonly fresh: boolean; readonly stale: boolean }
  >,
  refreshStateByRepo: ReadonlyMap<string, RepositoryRefreshState | undefined>,
) {
  return [...new Set(selected.map((entry) => entry.provenance.repoId))].map(
    (repoId) => {
      const freshness = freshnessByRepo.get(repoId);
      const refresh = refreshStateByRepo.get(repoId);
      const refreshStatus = refresh?.status;
      const fresh =
        refreshStatus === "fresh"
          ? true
          : refreshStatus === "stale" || refreshStatus === "refresh_failed"
            ? false
            : (freshness?.fresh ?? false);
      return {
      repoId,
        fresh,
        stale: !fresh,
        repositoryRefresh:
          refresh === undefined
            ? {
                status: freshness?.stale === false ? "fresh" : "stale",
                changedPaths: [],
              }
            : refresh,
      };
    },
  );
}

function recentRepositoryChanges(
  refreshStateByRepo: ReadonlyMap<string, RepositoryRefreshState | undefined>,
) {
  return [...refreshStateByRepo.entries()]
    .filter((entry): entry is [string, NonNullable<(typeof entry)[1]>] => {
      const state = entry[1];
      return state !== undefined && state.changedPaths.length > 0;
    })
    .map(([repoId, state]) => ({
      repoId,
      status: state.status,
      changedPaths: [...state.changedPaths],
      ...(state.lastCheckedAt === undefined
        ? {}
        : { lastCheckedAt: state.lastCheckedAt }),
    }));
}

function selectExactPassages(
  query: string,
  citations: readonly PlanCitation[],
  dependencies: AtlasRetrievalMcpDependencies,
) {
  const terms = queryTerms(query);
  const compounds = [
    ...query.toLowerCase().matchAll(/[a-z0-9]+(?:[._/-][a-z0-9]+)+/g),
  ].map((match) => match[0]!);
  return citations
    .slice(0, 3)
    .flatMap((citation, citationIndex) =>
      dependencies.retrievalStore
        .listSectionsByDocument(citation.docId)
        .map((section) => ({
          citation,
          citationIndex,
          section,
          score: passageScore(section, terms, compounds, citationIndex),
        }))
        .filter((candidate) => candidate.score > 0)
        .sort(
          (left, right) =>
            right.score - left.score ||
            left.section.ordinal - right.section.ordinal,
        )
        .slice(0, 2),
    )
    .sort(
      (left, right) =>
        right.score - left.score ||
        left.citationIndex - right.citationIndex ||
        left.section.ordinal - right.section.ordinal,
    )
    .slice(0, 6)
    .map(({ citation, section }) => ({
      ...citation,
      sectionId: section.sectionId,
      headingPath: section.headingPath,
      text: section.text,
      codeBlocks: section.codeBlocks,
    }));
}

function passageScore(
  section: {
    readonly headingPath: readonly string[];
    readonly text: string;
  },
  terms: ReadonlySet<string>,
  compounds: readonly string[],
  citationIndex: number,
): number {
  const heading = normalizeSearchText(section.headingPath.join(" "));
  const text = normalizeSearchText(section.text);
  let score = Math.max(0, 3 - citationIndex);
  for (const term of terms) {
    if (heading.includes(term)) score += 3;
    if (text.includes(term)) score += 1;
  }
  for (const compound of compounds) {
    const normalized = normalizeSearchText(compound);
    if (heading.includes(normalized)) score += 6;
    if (text.includes(normalized)) score += 4;
  }
  return score;
}

function queryTerms(query: string): ReadonlySet<string> {
  return new Set(
    normalizeSearchText(query)
      .split(" ")
      .map((term) => stem(term))
      .filter((term) => term.length >= 3 && !PASSAGE_STOP_WORDS.has(term)),
  );
}

function normalizeSearchText(value: string): string {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .split(/\s+/)
    .filter((term) => term.length > 0)
    .map((term) => stem(term))
    .join(" ");
}

function stem(term: string): string {
  if (term.length > 5 && term.endsWith("ing")) return term.slice(0, -3);
  if (term.length > 4 && term.endsWith("ed")) return term.slice(0, -2);
  if (term.length > 4 && term.endsWith("s")) return term.slice(0, -1);
  return term;
}

const PASSAGE_STOP_WORDS = new Set([
  "after",
  "and",
  "exactly",
  "from",
  "how",
  "make",
  "may",
  "perform",
  "the",
  "this",
  "what",
  "which",
  "with",
]);

function uniqueCitations(
  selected: readonly {
    provenance: { repoId: string; path: string; docId: string };
  }[],
): PlanCitation[] {
  const seen = new Set<string>();
  return selected.flatMap((entry) => {
    const citation = {
      repoId: entry.provenance.repoId,
      path: entry.provenance.path,
      docId: entry.provenance.docId,
    };
    const key = `${citation.repoId}:${citation.docId}`;
    if (seen.has(key)) return [];
    seen.add(key);
    return [citation];
  });
}
