/** HTTP method tags used to group the Scalar sidebar into product areas. */
export const openApiTags = [
  {
    name: "Runtime",
    description:
      "Health, version, and runtime readiness for the local Atlas server.",
  },
  {
    name: "Repositories",
    description: "Local repository config and indexed corpus inspection.",
  },
  {
    name: "Retrieval",
    description:
      "Search, scope inference, and context planning over the local corpus.",
  },
  {
    name: "Documents",
    description:
      "Canonical document outline and section reads from indexed public artifacts.",
  },
  {
    name: "Skills",
    description:
      "Generated Atlas skill discovery and read-only skill inspection.",
  },
  {
    name: "Inspection",
    description:
      "Diagnostics for manifests, freshness, topology, and retrieval state.",
  },
  {
    name: "Operations",
    description:
      "Explicit sync and build operations backed by local indexer services.",
  },
  {
    name: "MCP",
    description:
      "Model Context Protocol Streamable HTTP bridge for local agents.",
  },
] as const;
