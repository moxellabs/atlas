import type { DocMetadataRule } from "../types/repo.types";

/** Default metadata policy for repository documents without explicit Atlas frontmatter. */
export const BUILT_IN_DOC_METADATA_RULES: readonly DocMetadataRule[] = [
  {
    id: "atlas-docs-prd",
    match: { include: ["docs/prd/**"] },
    metadata: {
      visibility: "internal",
      audience: ["internal"],
      purpose: ["planning"],
    },
    priority: -100,
  },
  {
    id: "atlas-docs-archive",
    match: { include: ["docs/archive/**"] },
    metadata: {
      visibility: "internal",
      audience: ["internal"],
      purpose: ["archive"],
    },
    priority: -110,
  },
  {
    id: "atlas-planning",
    match: { include: [".planning/**"] },
    metadata: {
      visibility: "internal",
      audience: ["internal"],
      purpose: ["planning", "implementation"],
    },
    priority: -120,
  },
  {
    id: "atlas-root-readme",
    match: { include: ["README.md"] },
    metadata: {
      visibility: "public",
      audience: ["consumer"],
      purpose: ["guide"],
    },
    priority: -200,
  },
  {
    id: "atlas-nested-readme",
    match: { include: ["**/README.md"] },
    metadata: {
      visibility: "public",
      audience: ["contributor"],
      purpose: ["implementation", "reference"],
    },
    priority: -210,
  },
  {
    id: "atlas-docs",
    match: { include: ["docs/**"] },
    metadata: {
      visibility: "public",
      audience: ["consumer"],
      purpose: ["guide", "reference"],
    },
    priority: -300,
  },
  {
    id: "atlas-skills",
    match: { include: ["skills/**"] },
    metadata: {
      visibility: "public",
      audience: ["contributor", "maintainer"],
      purpose: ["workflow"],
    },
    priority: -400,
  },
  {
    id: "atlas-document-fallback",
    match: { include: ["**"] },
    metadata: {
      visibility: "internal",
      audience: ["contributor"],
      purpose: ["implementation"],
    },
    priority: -1000,
  },
];

/** Default for frontmatter that has no Atlas audience, purpose, or visibility fields. */
export const UNCLASSIFIED_FRONTMATTER_METADATA_RULE: DocMetadataRule = {
  id: "atlas-unclassified-frontmatter",
  match: { include: ["**"] },
  metadata: {
    visibility: "internal",
    audience: ["contributor"],
    purpose: ["implementation"],
  },
  priority: -1000,
};
