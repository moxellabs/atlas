import { cors } from "@elysiajs/cors";
import { Elysia } from "elysia";

import { createLoggingHook } from "./hooks/logging.hook";
import { docs } from "./openapi/route-docs";
import { errorPlugin } from "./plugins/error.plugin";
import { moxelOpenApiPagePlugin } from "./plugins/moxel-openapi-page.plugin";
import { openApiPlugin } from "./plugins/openapi.plugin";
import { requestContextPlugin } from "./plugins/request-context.plugin";
import { telemetryPlugin } from "./plugins/telemetry.plugin";
import { timingPlugin } from "./plugins/timing.plugin";
import { createBuildRoutes } from "./routes/build.route";
import { createContextRoutes } from "./routes/context.route";
import { createDocsRoutes } from "./routes/docs.route";
import { createHealthRoutes } from "./routes/health.route";
import { createInspectRoutes } from "./routes/inspect.route";
import { createMcpRoutes } from "./routes/mcp.route";
import { createReposRoutes } from "./routes/repos.route";
import { createSearchRoutes } from "./routes/search.route";
import { createSkillsRoutes } from "./routes/skills.route";
import { createSyncRoutes } from "./routes/sync.route";
import type { AtlasServerDependencies } from "./services/types";

/** Builds the fully composed ATLAS Elysia app from explicit dependencies. */
export function createApp(dependencies: AtlasServerDependencies) {
  return new Elysia()
    .use(
      cors({
        origin: isAllowedLocalOrigin,
        methods: ["GET", "POST", "PUT", "DELETE", "OPTIONS"],
        allowedHeaders: ["content-type", "x-request-id", "mcp-session-id", "last-event-id", "authorization"],
        exposeHeaders: ["mcp-session-id"],
        credentials: false,
        maxAge: 600,
        preflight: true
      })
    )
    .use(requestContextPlugin)
    .use(timingPlugin)
    .use(createLoggingHook(dependencies.env.logRequests))
    .use(dependencies.env.enableTelemetry ? telemetryPlugin : new Elysia({ name: "atlas-telemetry-disabled" }))
    .use(dependencies.env.enableOpenApi ? openApiPlugin : new Elysia({ name: "atlas-openapi-disabled" }))
    .use(dependencies.env.enableOpenApi ? moxelOpenApiPagePlugin : new Elysia({ name: "moxel-openapi-page-disabled" }))
    .get(
      "/",
      ({ set }) => {
        set.status = 302;
        set.headers.location = "/docs";
        return "";
      },
      docs.rootRedirect
    )
    .use(createHealthRoutes(dependencies))
    .use(createReposRoutes(dependencies))
    .use(createSearchRoutes(dependencies))
    .use(createContextRoutes(dependencies))
    .use(createDocsRoutes(dependencies))
    .use(createSkillsRoutes(dependencies))
    .use(createInspectRoutes(dependencies))
    .use(createSyncRoutes(dependencies))
    .use(createBuildRoutes(dependencies))
    .use(dependencies.env.enableMcp ? createMcpRoutes(dependencies) : new Elysia({ name: "atlas-mcp-disabled" }))
    .use(errorPlugin);
}

/** Allows browser clients served from local development origins to exercise the local API. */
function isAllowedLocalOrigin(request: Request): boolean {
  const origin = request.headers.get("origin");
  if (origin === null) {
    return false;
  }

  let url: URL;
  try {
    url = new URL(origin);
  } catch {
    return false;
  }

  return url.protocol === "http:" && ["localhost", "127.0.0.1", "[::1]"].includes(url.hostname);
}
