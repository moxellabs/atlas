import { Elysia } from "elysia";
import { dirname } from "node:path";
import { loadConfig, mutateAtlasConfigFile } from "@atlas/config";

import { ServerForbiddenError, ServerNotFoundError, ServerValidationError } from "../errors";
import { docs } from "../openapi/route-docs";
import { ok, requestIdFrom } from "../response";
import { presentRepoDetail, presentRepoList } from "../presenters/repo.presenter";
import { repoIdParamSchema } from "../schemas/common.schema";
import { repoMutationBodySchema } from "../schemas/repo.schema";
import type { AtlasServerDependencies } from "../services/types";
import { parseJsonBody, parseParams, routeError } from "./route-utils";

/** Repository inspection routes. */
export function createReposRoutes(dependencies: AtlasServerDependencies) {
  return new Elysia({ name: "atlas-repos-routes" })
    .get("/api/repos", ({ request }) => ok(requestIdFrom(request), presentRepoList(dependencies.store.listRepos())), docs.listRepos)
    .get(
      "/api/repos/:repoId",
      ({ params, request }) => {
        const { repoId } = parseParams(params, repoIdParamSchema, "getRepo");
        return ok(requestIdFrom(request), presentRepoDetail(dependencies.store.getRepoDetail(repoId)));
      },
      docs.getRepo
    )
    .post(
      "/api/repos",
      async ({ request, set }) => {
        try {
          assertLocalMutationAllowed(dependencies);
          const body = await parseJsonBody(request, repoMutationBodySchema, "createRepo");
          const result = await mutateAtlasConfigFile(configMutationOptions(dependencies), (config) => {
            if (config.repos.some((repo) => repo.repoId === body.repoId)) {
              throw new ServerValidationError(`Repository ${body.repoId} already exists.`, {
                operation: "createRepo",
                entity: "repo",
                details: { repoId: body.repoId }
              });
            }
            return { ...config, repos: [...config.repos, body] };
          });
          await reloadMutatedConfig(dependencies);
          set.status = 201;
          return ok(requestIdFrom(request), result.config.repos.find((repo) => repo.repoId === body.repoId));
        } catch (error) {
          return routeError(error, request, set);
        }
      },
      docs.createRepo
    )
    .put(
      "/api/repos/:repoId",
      async ({ params, request, set }) => {
        try {
          assertLocalMutationAllowed(dependencies);
          const { repoId } = parseParams(params, repoIdParamSchema, "replaceRepo");
          const body = await parseJsonBody(request, repoMutationBodySchema, "replaceRepo");
          if (body.repoId !== repoId) {
            throw new ServerValidationError("Route repoId must match body repoId.", {
              operation: "replaceRepo",
              entity: "repo",
              details: { routeRepoId: repoId, bodyRepoId: body.repoId }
            });
          }
          const result = await mutateAtlasConfigFile(configMutationOptions(dependencies), (config) => {
            const exists = config.repos.some((repo) => repo.repoId === repoId);
            if (!exists) {
              throw new ServerNotFoundError(`Repository ${repoId} is not configured.`, {
                operation: "replaceRepo",
                entity: "repo",
                details: { repoId }
              });
            }
            return { ...config, repos: config.repos.map((repo) => (repo.repoId === repoId ? body : repo)) };
          });
          await reloadMutatedConfig(dependencies);
          return ok(requestIdFrom(request), result.config.repos.find((repo) => repo.repoId === repoId));
        } catch (error) {
          return routeError(error, request, set);
        }
      },
      docs.replaceRepo
    )
    .delete(
      "/api/repos/:repoId",
      async ({ params, request, set }) => {
        try {
          assertLocalMutationAllowed(dependencies);
          const { repoId } = parseParams(params, repoIdParamSchema, "deleteRepo");
          await mutateAtlasConfigFile(configMutationOptions(dependencies), (config) => {
            const exists = config.repos.some((repo) => repo.repoId === repoId);
            if (!exists) {
              throw new ServerNotFoundError(`Repository ${repoId} is not configured.`, {
                operation: "deleteRepo",
                entity: "repo",
                details: { repoId }
              });
            }
            return { ...config, repos: config.repos.filter((repo) => repo.repoId !== repoId) };
          });
          await reloadMutatedConfig(dependencies);
          return ok(requestIdFrom(request), { repoId, deleted: true });
        } catch (error) {
          return routeError(error, request, set);
        }
      },
      docs.deleteRepo
    );
}

function configMutationOptions(dependencies: AtlasServerDependencies) {
  return {
    cwd: dirname(dependencies.config.source.configPath),
    configPath: dependencies.config.source.configPath,
    env: process.env,
    requireGhesAuth: false
  };
}

async function reloadMutatedConfig(dependencies: AtlasServerDependencies): Promise<void> {
  dependencies.reloadConfig(
    await loadConfig({
      cwd: dirname(dependencies.config.source.configPath),
      configPath: dependencies.config.source.configPath,
      env: process.env,
      requireGhesAuth: false
    })
  );
}

function assertLocalMutationAllowed(dependencies: AtlasServerDependencies): void {
  if (["127.0.0.1", "localhost", "::1", "[::1]"].includes(dependencies.env.host)) {
    return;
  }
  throw new ServerForbiddenError("Repository mutation routes are only available on loopback-bound ATLAS servers.", {
    operation: "repoMutation",
    entity: "server",
    details: { host: dependencies.env.host }
  });
}
