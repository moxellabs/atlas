import { Elysia } from "elysia";

import { ServerDependencyError } from "../errors";
import { docs } from "../openapi/route-docs";
import type { AtlasServerDependencies } from "../services/types";

/** MCP Streamable HTTP bridge route. */
export function createMcpRoutes(dependencies: AtlasServerDependencies) {
  const handleMcp = ({ request }: { request: Request }) => {
    if (dependencies.mcp === undefined) {
      throw new ServerDependencyError("MCP bridge is disabled.", {
        operation: "mcpBridge",
        entity: "mcp",
        details: { enabled: false }
      });
    }
    return dependencies.mcp.handle(request);
  };

  return new Elysia({ name: "atlas-mcp-routes" })
    .get("/mcp", handleMcp, docs.mcpGet)
    .post("/mcp", handleMcp, docs.mcpPost)
    .delete("/mcp", handleMcp, docs.mcpDelete);
}
