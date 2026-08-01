import {
  listDocumentsByRepo,
  listIndexedCoverage,
  listPackages,
} from "../store-mappers";
import type { AtlasMcpDependencies } from "../types";
import type { AtlasMcpDiscoveryPolicy } from "../types";

/** A compact, safe-to-advertise description of one locally indexed source. */
export interface IndexedSourceCatalogEntry {
  repoId: string;
  toolSuffix: string;
  title: string;
  aliases: string[];
  topics: string[];
  documentCount: number;
  packageCount: number;
  moduleCount: number;
  fresh: boolean;
  stale: boolean;
}

/** Deterministic catalog used to advertise local knowledge to MCP clients. */
export interface IndexedSourceCatalog {
  sources: IndexedSourceCatalogEntry[];
  fingerprint: string;
}

const MAX_ADVERTISED_SOURCES = 12;

/** Builds a bounded source catalog entirely from the local indexed corpus. */
export function buildIndexedSourceCatalog(
  dependencies: AtlasMcpDependencies,
): IndexedSourceCatalog {
  const sources = listIndexedCoverage(dependencies.db)
    .map((coverage) => {
      const packageNames = listPackages(dependencies.db, coverage.repoId)
        .map((pkg) => pkg.name)
        .filter((name) => name.length > 0);
      const aliases = unique([
        ...repoAliases(coverage.repoId),
        ...packageNames,
      ]);
      const topics = sourceTopics(
        listDocumentsByRepo(dependencies.db, coverage.repoId).map(
          (document) => ({
            title: document.title,
            path: document.path,
            description: document.description,
            tags: document.tags,
          }),
        ),
      );
      return {
        repoId: coverage.repoId,
        toolSuffix: toolSuffix(coverage.repoId),
        title: sourceTitle(coverage.repoId),
        aliases,
        topics,
        documentCount: coverage.documentCount,
        packageCount: coverage.packageCount,
        moduleCount: coverage.moduleCount,
        fresh: coverage.freshness.fresh,
        stale: coverage.freshness.stale,
      };
    })
    .sort((left, right) => left.repoId.localeCompare(right.repoId));
  const withUniqueSuffixes = sources.map((source, index) => ({
    ...source,
    toolSuffix: uniqueToolSuffix(
      source.toolSuffix,
      source.repoId,
      sources,
      index,
    ),
  }));
  return {
    sources: withUniqueSuffixes,
    fingerprint: JSON.stringify(withUniqueSuffixes),
  };
}

/** Bounded MCP initialization guidance for the selected discovery policy. */
export function discoveryInstructions(
  catalog: IndexedSourceCatalog,
  policy: AtlasMcpDiscoveryPolicy = "neutral",
): string {
  if (catalog.sources.length === 0) {
    return "Atlas has no indexed documentation. Coverage is absent; use another permitted source when evidence is needed.";
  }
  const listed = catalog.sources
    .slice(0, MAX_ADVERTISED_SOURCES)
    .map((source) => {
      const freshness = source.fresh ? "fresh" : "stale";
      return `${source.title} (${source.documentCount} docs, ${freshness}; aliases: ${source.aliases.slice(0, 5).join(", ")}; topics: ${source.topics.slice(0, 8).join(", ")})`;
    });
  const remainder = catalog.sources.length - listed.length;
  const catalogSummary = `Atlas provides indexed documentation independently of the current workspace for: ${listed.join("; ")}${remainder > 0 ? `; and ${remainder} more` : ""}. Retrieval reports sufficient, partial, absent, or stale coverage with source-relative provenance.`;
  if (policy === "neutral") return catalogSummary;
  return `For questions about a matching repository, library, framework, or API, consult Atlas's source-specific plan_context tool (or plan_context with repoId) before external search. Atlas is read-only and independent of the current workspace. Cite returned source-relative provenance; use another permitted source when coverage is partial, absent, or stale. ${catalogSummary}`;
}

/** Brief server metadata that remains useful when a client only exposes serverInfo. */
export function discoveryDescription(catalog: IndexedSourceCatalog): string {
  if (catalog.sources.length === 0) {
    return "Indexed documentation retrieval and planning. No sources are currently available.";
  }
  return `Indexed documentation retrieval and planning for ${catalog.sources.length} source${catalog.sources.length === 1 ? "" : "s"}: ${catalog.sources
    .slice(0, 4)
    .map(
      (source) => `${source.title} (${source.topics.slice(0, 5).join(", ")})`,
    )
    .join(
      "; ",
    )}${catalog.sources.length > 4 ? "; …" : ""}. Results include coverage, freshness, and source-relative provenance.`;
}

function repoAliases(repoId: string): string[] {
  const parts = repoId.split("/").filter((part) => part.length > 0);
  const name = parts.at(-1);
  const owner = parts.at(-2);
  return unique(
    [
      repoId,
      owner,
      name,
      owner === undefined || name === undefined
        ? undefined
        : `${owner}/${name}`,
    ].filter((value): value is string => value !== undefined),
  );
}

function sourceTitle(repoId: string): string {
  const parts = repoId.split("/").filter((part) => part.length > 0);
  return parts.length >= 2 ? parts.slice(-2).join("/") : repoId;
}

function toolSuffix(repoId: string): string {
  const normalized = repoId
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "");
  return normalized.length > 0 ? normalized.slice(-56) : "source";
}

function uniqueToolSuffix(
  candidate: string,
  repoId: string,
  sources: readonly IndexedSourceCatalogEntry[],
  index: number,
): string {
  const collisions = sources.filter(
    (source) => source.toolSuffix === candidate,
  );
  return collisions.length <= 1 ||
    (collisions[0]?.repoId === repoId &&
      index === sources.findIndex((source) => source.repoId === repoId))
    ? candidate
    : `${candidate.slice(0, 48)}_${stableHash(repoId)}`;
}

function unique(values: readonly string[]): string[] {
  return [
    ...new Set(
      values.map((value) => value.trim()).filter((value) => value.length > 0),
    ),
  ];
}

function stableHash(value: string): string {
  let hash = 2166136261;
  for (const character of value) {
    hash ^= character.charCodeAt(0);
    hash = Math.imul(hash, 16777619);
  }
  return (hash >>> 0).toString(36);
}

function sourceTopics(
  documents: readonly {
    title?: string | undefined;
    path: string;
    description?: string | undefined;
    tags: readonly string[];
  }[],
): string[] {
  const counts = new Map<string, number>();
  for (const document of documents) {
    const searchable = [
      document.title ?? "",
      document.path,
      document.description ?? "",
      ...document.tags,
    ].join(" ");
    for (const token of searchable.toLowerCase().split(/[^a-z0-9]+/)) {
      if (token.length < 3 || STOP_WORDS.has(token)) continue;
      counts.set(token, (counts.get(token) ?? 0) + 1);
    }
  }
  return [...counts.entries()]
    .sort(
      (left, right) => right[1] - left[1] || left[0].localeCompare(right[0]),
    )
    .slice(0, 24)
    .map(([topic]) => topic);
}

const STOP_WORDS = new Set([
  "and",
  "api",
  "app",
  "atlas",
  "code",
  "docs",
  "document",
  "for",
  "from",
  "guide",
  "how",
  "the",
  "this",
  "with",
]);
