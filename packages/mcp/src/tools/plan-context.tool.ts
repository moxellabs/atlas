import { planContext } from "@atlas/retrieval";
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
import type { AtlasMcpDependencies, McpJsonObject } from "../types";

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

/** Executes token-budgeted context planning for an MCP caller. */
export function executePlanContext(
  input: PlanContextToolInput,
  dependencies: AtlasMcpDependencies,
): McpJsonObject {
  const parsed = planContextInputSchema.parse(input);
  const plan = planContext({
    db: dependencies.db,
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
  const stale = selected.some(
    (entry) => freshnessByRepo.get(entry.provenance.repoId)?.stale === true,
  );
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
      selectedSources: selected.map((entry) => ({
        repoId: entry.provenance.repoId,
        fresh: freshnessByRepo.get(entry.provenance.repoId)?.fresh ?? false,
        stale: freshnessByRepo.get(entry.provenance.repoId)?.stale ?? true,
      })),
    },
    nextAction,
    context: plan.contextPacket,
    citations,
    ...(parsed.detail === "debug" ? { debug: plan } : {}),
  };
}

/** Registers the plan_context MCP tool. */
export function registerPlanContextTool(
  server: McpServer,
  dependencies: AtlasMcpDependencies,
  options: { description?: string } = {},
) {
  return server.registerTool(
    PLAN_CONTEXT_TOOL,
    {
      title: "Answer from indexed documentation",
      description:
        options.description ??
        "Answer a question about an indexed library, framework, API, or repository. Searches the corpus and returns sufficient, partial, absent, or stale evidence with source-relative citations and the next safe action. Use repoId when the source is known.",
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

/** Registers a source-bound alias so tool search can surface local knowledge by name. */
export function registerSourcePlanContextTool(
  server: McpServer,
  dependencies: AtlasMcpDependencies,
  source: IndexedSourceCatalogEntry,
) {
  const name = `search_docs__${source.toolSuffix}`;
  return {
    name,
    handle: server.registerTool(
      name,
      {
        title: `Search ${source.title} documentation`,
        description: `Search ${source.documentCount} indexed ${source.title} documents and return cited evidence for a question. Also known as: ${source.aliases.slice(0, 8).join(", ")}. Coverage includes: ${source.topics.slice(0, 24).join(", ")}. Index freshness: ${source.fresh ? "fresh" : "stale"}.`,
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
      (input) =>
        toolResult(
          executePlanContext(
            {
              query: input.query,
              repoId: source.repoId,
              budgetTokens: 4_000,
              candidateLimit: 20,
              summaryLimit: 5,
              expansionLimit: 12,
            },
            dependencies,
          ),
        ),
    ),
  };
}

function uniqueCitations(
  selected: readonly {
    provenance: { repoId: string; path: string; docId: string };
  }[],
) {
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
