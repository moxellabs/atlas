import { ResourceTemplate, type McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";

import { resourceResult } from "../mcp-result";
import type { AtlasMcpDependencies, McpJsonObject } from "../types";

/** Package-local resource definition consumed by the server composition root. */
export interface AtlasResourceDefinition {
  /** Registered resource name. */
  name: string;
  /** Resource URI or template. */
  uri: string | ResourceTemplate;
  /** Human-readable title. */
  title: string;
  /** Resource description. */
  description: string;
  /** Reads and maps the resource payload. */
  read: (uri: URL, dependencies: AtlasMcpDependencies) => McpJsonObject;
}

export interface AtlasResourceIdentity {
  resourcePrefix: string;
  title: string;
}

/** Returns a resource definition with identity-aware display fields and stable atlas:// URI. */
export function withResourceIdentity(definition: AtlasResourceDefinition, identity: AtlasResourceIdentity): AtlasResourceDefinition {
  const name = definition.name.startsWith("atlas-") ? `${identity.resourcePrefix}-${definition.name.slice("atlas-".length)}` : definition.name;
  return {
    ...definition,
    name,
    title: definition.title.replace(/ATLAS|Atlas/g, identity.title),
    description: definition.description.replace(/ATLAS|Atlas/g, identity.title)
  };
}

/** Registers a resource definition on an SDK MCP server. */
export function registerAtlasResource(server: McpServer, definition: AtlasResourceDefinition, dependencies: AtlasMcpDependencies): void {
  const config = {
    title: definition.title,
    description: definition.description,
    mimeType: "application/json"
  };
  if (definition.uri instanceof ResourceTemplate) {
    server.registerResource(definition.name, definition.uri, config, (uri: URL) => resourceResult(uri.href, definition.read(uri, dependencies)));
    return;
  }
  server.registerResource(definition.name, definition.uri, config, (uri: URL) => resourceResult(uri.href, definition.read(uri, dependencies)));
}

/** Extracts the final path segment from an atlas:// resource URI. */
export function resourceId(uri: URL): string {
  const pathId = uri.pathname.replace(/^\/+/, "");
  return pathId.length > 0 ? decodeURIComponent(pathId) : decodeURIComponent(uri.hostname);
}
