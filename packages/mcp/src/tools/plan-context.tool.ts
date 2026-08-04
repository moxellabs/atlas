import type { RepositoryRefreshState } from "@atlas/core";
import { classifyQuery, planContext } from "@atlas/retrieval";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";

import type { IndexedSourceCatalogEntry } from "../discovery/indexed-source-catalog";
import { toolResult } from "../mcp-result";
import { listIndexedCoverage } from "../store-mappers";
import { planContextOutputSchema } from "../schemas/tool-output-schemas";
import {
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
    ...(parsed.scope?.repoId === undefined
      ? {}
      : { repoId: parsed.scope.repoId }),
    ...(parsed.scope?.packageId === undefined
      ? {}
      : { packageId: parsed.scope.packageId }),
    ...(parsed.scope?.moduleId === undefined
      ? {}
      : { moduleId: parsed.scope.moduleId }),
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
    coverage === "absent" || coverage === "stale"
      ? "web_fallback"
      : "answer_locally";
  const nextActionGuidance =
    coverage === "partial"
      ? "Answer from context.evidence while stating the scope ambiguity and likely candidates. Do not call another retrieval tool."
      : nextAction === "answer_locally"
        ? "Answer directly from context.evidence and cite provenance paths. Do not call another retrieval tool unless a required claim is unsupported."
        : "Indexed coverage is absent or stale. Use an external source, cite it, and do not attribute the answer to Atlas.";
  const citations = uniqueCitations(selected);
  return planContextOutputSchema.parse({
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
    nextActionGuidance,
    context: {
      ...plan.contextPacket,
      recommendedNextActions: [
        nextActionGuidance,
        ...plan.contextPacket.recommendedNextActions
          .filter((action) => action !== nextActionGuidance)
          .slice(0, 2),
      ],
    },
    citations,
    ...(classifyQuery(parsed.query).kind === "diff"
      ? { recentChanges: recentRepositoryChanges(refreshStateByRepo) }
      : {}),
    ...(parsed.detail === "debug" ? { debug: plan } : {}),
  });
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
      title: "Build answer-ready context",
      description:
        options.description ??
        "Use first for broad or cross-source questions. Returns one token-budgeted, deduplicated evidence packet with inferred scopes, coverage, citations, and an explicit next action. When nextAction is answer_locally, answer from this result without another retrieval call. Use exact scope constraints when the repository, package, or module is known.",
      inputSchema: planContextInputSchema,
      outputSchema: planContextOutputSchema,
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
  options: { alwaysLoad: boolean },
) {
  const name = `answer_${source.toolSuffix}_docs`;
  return {
    name,
    handle: server.registerTool(
      name,
      {
        title: `Answer from ${source.title} documentation`,
        description: `Use first for questions about ${source.title}. Returns one token-budgeted, deduplicated evidence packet from the ${source.fresh ? "fresh" : "stale"} indexed corpus with source-relative citations. When nextAction is answer_locally, answer immediately without another retrieval call. Aliases: ${source.aliases.slice(0, 5).join(", ")}. Topics: ${source.topics.slice(0, 12).join(", ")}.`,
        inputSchema: sourcePlanContextInputSchema,
        outputSchema: planContextOutputSchema,
        annotations: {
          readOnlyHint: true,
          destructiveHint: false,
          idempotentHint: true,
          openWorldHint: false,
        },
        ...(options.alwaysLoad
          ? { _meta: { "anthropic/alwaysLoad": true } }
          : {}),
      },
      (input) =>
        toolResult(
          buildPlanContextResult(
            {
              query: input.query,
              scope: { repoId: source.repoId },
              budgetTokens: 2_000,
              candidateLimit: 40,
              summaryLimit: 0,
              expansionLimit: 2,
            },
            dependencies,
          ),
        ),
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
