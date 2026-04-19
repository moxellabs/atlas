import type { AtlasMcpIdentity } from "../types";

/** Stable ATLAS MCP server metadata. */
export const ATLAS_MCP_SERVER_METADATA = {
  name: "atlas-mcp",
  version: "0.0.0",
  title: "ATLAS Local Knowledge MCP",
  description: "MCP protocol surface for ATLAS local documentation retrieval, resources, and prompts.",
  resourcePrefix: "atlas"
} as const;

export function createAtlasMcpServerMetadata(identity: AtlasMcpIdentity = {}) {
  return {
    name: identity.name ?? ATLAS_MCP_SERVER_METADATA.name,
    version: ATLAS_MCP_SERVER_METADATA.version,
    title: identity.title ?? ATLAS_MCP_SERVER_METADATA.title,
    description: ATLAS_MCP_SERVER_METADATA.description,
    resourcePrefix: identity.resourcePrefix ?? ATLAS_MCP_SERVER_METADATA.resourcePrefix
  } as const;
}

/** Declared MCP surface capabilities implemented by this package. */
export const ATLAS_MCP_CAPABILITIES = {
  tools: true,
  resources: true,
  prompts: true,
  transports: ["stdio", "streamable-http"] as const
} as const;
