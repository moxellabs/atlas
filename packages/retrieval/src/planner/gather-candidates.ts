import type { DocumentMetadataFilters } from "@atlas/core";
import type { DocumentRecord, LexicalSearchHit } from "@atlas/store";

import { RetrievalDependencyError } from "../errors";
import type {
  RetrievalCandidate,
  RetrievalStore,
  ScopeCandidate,
} from "../types";
import {
  candidateFromLexicalHit,
  documentCandidate,
  documentsForScope,
  documentSummaries,
  sectionCandidate,
  skillCandidate,
} from "./candidate-factories";
import { dedupeCandidates } from "./candidate-utils";

/** Max documents broad fallback will score before ranking the top slice. */
const BROAD_FALLBACK_SCAN_LIMIT = 120;
/** Max repos scanned when no repoId filter is present. */
const BROAD_FALLBACK_REPO_LIMIT = 8;

export interface GatherCandidatesInput {
  readonly query: string;
  readonly expandedQuery: string;
  readonly repoId?: string | undefined;
  readonly packageId?: string | undefined;
  readonly moduleId?: string | undefined;
  readonly scopes: readonly ScopeCandidate[];
  readonly candidateLimit: number;
  readonly countTokens: (text: string) => number;
  readonly filters?: DocumentMetadataFilters | undefined;
}

/** Gathers bounded lexical, path, scope, and broad-fallback candidates. */
export function gatherCandidates(
  store: RetrievalStore,
  context: GatherCandidatesInput,
): RetrievalCandidate[] {
  try {
    const candidates: RetrievalCandidate[] = [];
    const expandedQuery = context.expandedQuery;
    const lexicalQuery = toLexicalQuery(context.query);
    const headingTerms = new Set(queryTerms(context.query));
    const expandedLexicalQuery = toExpandedLexicalQuery(
      context.query,
      expandedQuery,
    );
    const useAtlasVocabulary = shouldUseAtlasVocabulary(context.repoId);
    let useExpandedRetrieval = lexicalQuery.length === 0;
    let lexicalHits =
      lexicalQuery.length === 0
        ? []
        : store.lexicalSearch({
            query: lexicalQuery,
            repoId: context.repoId,
            limit: context.candidateLimit,
            filters: context.filters,
          });
    let lexicalScores = normalizedLexicalScores(lexicalHits);
    if (
      (lexicalHits.length < Math.min(context.candidateLimit, 3) ||
        useAtlasVocabulary) &&
      expandedLexicalQuery.length > 0 &&
      expandedLexicalQuery !== lexicalQuery
    ) {
      useExpandedRetrieval = true;
      const expandedHits = store.lexicalSearch({
        query: expandedLexicalQuery,
        repoId: context.repoId,
        limit: context.candidateLimit,
        filters: context.filters,
      });
      lexicalScores = mergeLexicalScores(
        lexicalScores,
        normalizedLexicalScores(expandedHits),
      );
      lexicalHits = mergeLexicalHits(
        lexicalHits,
        expandedHits,
        useAtlasVocabulary
          ? context.candidateLimit * 2
          : context.candidateLimit,
      );
    }

    if (lexicalHits.length > 0) {
      for (const hit of lexicalHits) {
        const hydrated = candidateFromLexicalHit({
          store,
          hit,
          score: lexicalScores.get(lexicalHitKey(hit)) ?? 0.35,
          countTokens: context.countTokens,
        });
        if (hydrated !== undefined) {
          candidates.push(hydrated.candidate);
          candidates.push(
            ...documentSummaries(
              store,
              hydrated.document,
              hydrated.candidate.score ?? 0.4,
            ),
          );
        }
      }
    }

    for (const signal of pathSignals(
      context.query,
      expandedQuery,
      useExpandedRetrieval,
    )) {
      for (const document of store.pathSearch({
        path: signal.path,
        mode: signal.path.includes("/") ? "contains" : "prefix",
        repoId: context.repoId,
        limit: 12,
        filters: context.filters,
      })) {
        const score = signal.expanded ? 0.94 : 1;
        candidates.push(
          documentCandidate(
            document,
            "path",
            score,
            [
              `Matched ${signal.expanded ? "expanded " : ""}path signal ${signal.path}.`,
            ],
            context.countTokens,
          ),
        );
        candidates.push(...documentSummaries(store, document, score * 0.72));
        if (isDocumentPath(signal.path)) {
          for (const { section } of store
            .listSectionsByDocument(document.docId)
            .map((section) => ({
              section,
              score: headingMatchScore(section.headingPath, headingTerms),
            }))
            .filter(({ score: headingScore }) => headingScore > 0)
            .sort(
              (left, right) =>
                right.score - left.score ||
                left.section.ordinal - right.section.ordinal,
            )
            .slice(0, 4)) {
            candidates.push(
              sectionCandidate(
                document,
                section,
                signal.expanded ? 0.9 : 0.96,
                context.countTokens,
              ),
            );
          }
        }
      }
    }

    for (const scope of context.scopes.slice(0, 6)) {
      for (const document of documentsForScope(store, scope, context.filters)) {
        candidates.push(
          documentCandidate(
            document,
            "scope",
            0.62 * scope.score,
            [`Matched inferred ${scope.level} scope ${scope.label}.`],
            context.countTokens,
          ),
        );
        candidates.push(
          ...documentSummaries(store, document, 0.68 * scope.score),
        );
        for (const { section, score } of store
          .listSectionsByDocument(document.docId)
          .map((section) => ({
            section,
            score: headingMatchScore(section.headingPath, headingTerms),
          }))
          .filter(({ score }) => score > 0)
          .sort(
            (left, right) =>
              right.score - left.score ||
              left.section.ordinal - right.section.ordinal,
          )
          .slice(0, 2)) {
          candidates.push({
            ...sectionCandidate(
              document,
              section,
              (0.7 + Math.min(score, 2) * 0.08) * scope.score,
              context.countTokens,
            ),
            source: "scope",
            rationale: [
              `Matched requested heading within ${scope.level} scope ${scope.label}.`,
            ],
          });
        }
      }
      if (scope.level === "skill" && scope.skillId !== undefined) {
        const skill = store.getSkill(scope.skillId);
        if (skill !== undefined) {
          candidates.push(
            skillCandidate(
              store,
              skill,
              0.85 * scope.score,
              context.countTokens,
            ),
          );
          const skillDoc = store.getDocument(skill.sourceDocId);
          if (skillDoc !== undefined) {
            candidates.push(
              ...documentSummaries(store, skillDoc, 0.7 * scope.score),
            );
          }
        }
      }
    }

    const deduped = dedupeCandidates(candidates).filter((candidate) =>
      matchesExactScope(candidate, context),
    );
    if (deduped.length < Math.min(context.candidateLimit, 3)) {
      return dedupeCandidates([
        ...deduped,
        ...broadFallbackCandidates(store, context, deduped.length),
      ]).filter((candidate) => matchesExactScope(candidate, context));
    }
    return deduped;
  } catch (error) {
    throw new RetrievalDependencyError(
      "Candidate generation failed while reading store search artifacts.",
      {
        operation: "gatherCandidates",
        entity: "store",
        cause: error,
      },
    );
  }
}

function broadFallbackCandidates(
  store: RetrievalStore,
  context: GatherCandidatesInput,
  existingCount: number,
): RetrievalCandidate[] {
  const terms = queryTerms(context.query);
  if (terms.length === 0) {
    return [];
  }
  const needed = Math.max(0, context.candidateLimit - existingCount);
  if (needed === 0) {
    return [];
  }
  const scanLimit = Math.min(
    BROAD_FALLBACK_SCAN_LIMIT,
    Math.max(needed * 4, needed),
  );
  const documents = collectBroadFallbackDocuments(
    store,
    context,
    scanLimit,
  ).filter((document) => matchesExactDocumentScope(document, context));
  const scored = documents
    .map((document) => ({
      document,
      score: broadDocumentScore(document, store, terms),
    }))
    .filter((item) => item.score > 0)
    .sort(
      (a, b) =>
        b.score - a.score || a.document.path.localeCompare(b.document.path),
    )
    .slice(0, needed);
  const candidates: RetrievalCandidate[] = [];
  for (const { document, score } of scored) {
    candidates.push(
      documentCandidate(
        document,
        "summary",
        Number((0.36 + Math.min(score, 6) * 0.06).toFixed(3)),
        ["Matched broad fallback over document metadata and summaries."],
        context.countTokens,
      ),
    );
    candidates.push(...documentSummaries(store, document, 0.34));
  }
  return candidates;
}

function collectBroadFallbackDocuments(
  store: RetrievalStore,
  context: GatherCandidatesInput,
  scanLimit: number,
): DocumentRecord[] {
  if (context.repoId !== undefined) {
    return store.listDocumentsByRepo(context.repoId, { limit: scanLimit });
  }

  // Prefer repos already suggested by scope inference, then fill from the
  // registry. Never scan every document across every configured repo.
  const preferredRepoIds: string[] = [];
  const seen = new Set<string>();
  for (const scope of context.scopes) {
    if (!seen.has(scope.repoId)) {
      seen.add(scope.repoId);
      preferredRepoIds.push(scope.repoId);
    }
    if (preferredRepoIds.length >= BROAD_FALLBACK_REPO_LIMIT) {
      break;
    }
  }
  if (preferredRepoIds.length < BROAD_FALLBACK_REPO_LIMIT) {
    for (const repo of store.listRepos()) {
      if (!seen.has(repo.repoId)) {
        seen.add(repo.repoId);
        preferredRepoIds.push(repo.repoId);
      }
      if (preferredRepoIds.length >= BROAD_FALLBACK_REPO_LIMIT) {
        break;
      }
    }
  }

  const perRepo = Math.max(
    1,
    Math.ceil(scanLimit / Math.max(preferredRepoIds.length, 1)),
  );
  const documents: DocumentRecord[] = [];
  for (const repoId of preferredRepoIds) {
    for (const document of store.listDocumentsByRepo(repoId, {
      limit: perRepo,
    })) {
      documents.push(document);
      if (documents.length >= scanLimit) {
        return documents;
      }
    }
  }
  return documents;
}

function broadDocumentScore(
  document: DocumentRecord,
  store: RetrievalStore,
  terms: readonly string[],
): number {
  const metadataText = [
    (document.title ?? "").repeat(3),
    document.path.repeat(2),
    document.description ?? "",
    document.tags.join(" ").repeat(2),
  ]
    .join("\n")
    .toLowerCase();
  const metadataScore = terms.reduce(
    (score, term) => score + (metadataText.includes(term) ? 1 : 0),
    0,
  );
  // Skip summary loads when title/path/tags already match enough terms.
  if (metadataScore >= Math.min(2, terms.length)) {
    return metadataScore;
  }
  const summaryText = store
    .listSummaries("document", document.docId)
    .map((summary) => summary.text)
    .join(" ")
    .toLowerCase();
  const summaryScore = terms.reduce(
    (score, term) => score + (summaryText.includes(term) ? 1 : 0),
    0,
  );
  return metadataScore + summaryScore;
}

function matchesExactScope(
  candidate: RetrievalCandidate,
  context: Pick<GatherCandidatesInput, "repoId" | "packageId" | "moduleId">,
): boolean {
  return (
    (context.repoId === undefined ||
      candidate.provenance.repoId === context.repoId) &&
    (context.packageId === undefined ||
      candidate.provenance.packageId === context.packageId) &&
    (context.moduleId === undefined ||
      candidate.provenance.moduleId === context.moduleId)
  );
}

function matchesExactDocumentScope(
  document: DocumentRecord,
  context: Pick<GatherCandidatesInput, "repoId" | "packageId" | "moduleId">,
): boolean {
  return (
    (context.repoId === undefined || document.repoId === context.repoId) &&
    (context.packageId === undefined ||
      document.packageId === context.packageId) &&
    (context.moduleId === undefined || document.moduleId === context.moduleId)
  );
}

function normalizedLexicalScores(
  hits: readonly LexicalSearchHit[],
): ReadonlyMap<string, number> {
  const scores = new Map<string, number>();
  if (hits.length === 0) {
    return scores;
  }
  if (hits.length === 1) {
    scores.set(lexicalHitKey(hits[0]!), 1);
    return scores;
  }
  const bestRank = hits[0]?.rank ?? 0;
  const worstRank = hits.at(-1)?.rank ?? bestRank;
  const rankSpan = Math.abs(worstRank - bestRank);
  const denominator = Math.max(1, hits.length - 1);
  for (const [index, hit] of hits.entries()) {
    const positional = 1 - (index / denominator) * 0.65;
    const rankBased =
      rankSpan <= Number.EPSILON
        ? positional
        : 1 - (Math.abs(hit.rank - bestRank) / rankSpan) * 0.65;
    const score = Math.max(0.25, Math.min(1, (positional + rankBased) / 2));
    scores.set(lexicalHitKey(hit), Number(score.toFixed(3)));
  }
  return scores;
}

function shouldUseAtlasVocabulary(repoId: string | undefined): boolean {
  return repoId === "atlas" || repoId === "github.com/moxellabs/atlas";
}

function mergeLexicalScores(
  primary: ReadonlyMap<string, number>,
  expanded: ReadonlyMap<string, number>,
): ReadonlyMap<string, number> {
  const scores = new Map(primary);
  for (const [key, score] of expanded) {
    scores.set(key, Math.max(score, scores.get(key) ?? 0));
  }
  return scores;
}

function mergeLexicalHits(
  primary: readonly LexicalSearchHit[],
  expanded: readonly LexicalSearchHit[],
  limit: number,
): LexicalSearchHit[] {
  const merged = new Map<string, LexicalSearchHit>();
  for (const hit of [...primary, ...expanded]) {
    const key = lexicalHitKey(hit);
    if (!merged.has(key)) {
      merged.set(key, hit);
    }
    if (merged.size >= limit) {
      break;
    }
  }
  return [...merged.values()];
}

function lexicalHitKey(hit: LexicalSearchHit): string {
  return `${hit.entityType}:${hit.entityId}`;
}

function toLexicalQuery(query: string): string {
  return queryTerms(query).slice(0, 12).join(" ");
}

function toExpandedLexicalQuery(query: string, expandedQuery: string): string {
  const baseTerms = queryTerms(query);
  const baseTermSet = new Set(baseTerms);
  const expansionTerms = queryTerms(expandedQuery)
    .filter((term) => !baseTermSet.has(term))
    .slice(0, 4);
  if (expansionTerms.length === 0) {
    return baseTerms.slice(0, 12).join(" ");
  }
  return [
    ...baseTerms.slice(0, 12 - expansionTerms.length),
    ...expansionTerms,
  ].join(" ");
}

function queryTerms(query: string): string[] {
  return query
    .replace(/[`"'()[\]{}:*^~+-]/g, " ")
    .split(/[^a-z0-9_]+/i)
    .map((term) => term.toLowerCase())
    .filter((term) => term.length >= 2 && !STOPWORDS.has(term));
}

const STOPWORDS = new Set([
  "a",
  "an",
  "and",
  "are",
  "do",
  "does",
  "for",
  "how",
  "i",
  "in",
  "is",
  "of",
  "the",
  "to",
  "what",
  "where",
  "work",
  "works",
]);

function pathSignals(
  query: string,
  expandedQuery: string,
  includeExpanded: boolean,
): Array<{ path: string; expanded: boolean }> {
  const signals = new Map<string, { path: string; expanded: boolean }>();
  for (const path of extractPathSignals(query)) {
    signals.set(normalizePathSignal(path), { path, expanded: false });
  }
  if (includeExpanded) {
    for (const path of extractPathSignals(expandedQuery)) {
      const key = normalizePathSignal(path);
      if (!signals.has(key)) {
        signals.set(key, { path, expanded: true });
      }
    }
  }
  return [...signals.values()];
}

function extractPathSignals(query: string): string[] {
  return [
    ...query.matchAll(/`([^`]+\.[a-z0-9]+|[^`]+\/[^`]+)`/gi),
    ...query.matchAll(/\b[\w@.-]+\/[\w./-]+\b/gi),
    ...query.matchAll(/\b[\w.-]+\.(?:md|mdx|ts|tsx|js|jsx|json|yml|yaml)\b/gi),
  ]
    .map((match) => (match[1] ?? match[0]).trim())
    .filter((value) => value.length > 0);
}

function headingMatchScore(
  headingPath: readonly string[],
  queryTermsSet: ReadonlySet<string>,
): number {
  if (headingPath.length <= 1) {
    return 0;
  }
  const leafHeading = headingPath[headingPath.length - 1]!;
  return queryTerms(leafHeading).filter(
    (term) => !HEADING_STOPWORDS.has(term) && queryTermsSet.has(term),
  ).length;
}

const HEADING_STOPWORDS = new Set([
  "app",
  "mcp",
  "module",
  "package",
  "service",
]);

function isDocumentPath(path: string): boolean {
  return /\.(?:md|mdx)$/i.test(path);
}

function normalizePathSignal(path: string): string {
  return path.trim().replace(/\\/g, "/").replace(/^\.\//, "").toLowerCase();
}
