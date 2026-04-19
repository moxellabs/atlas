import { Elysia } from "elysia";

import { docs } from "../openapi/route-docs";
import { presentSkillDetail } from "../presenters/repo.presenter";
import { ok, requestIdFrom } from "../response";
import { skillIdParamSchema } from "../schemas/common.schema";
import { listSkillsQuerySchema } from "../schemas/repo.schema";
import type { AtlasServerDependencies } from "../services/types";
import { parseParams, parseQuery, routeError } from "./route-utils";

/** Skill list and detail routes. */
export function createSkillsRoutes(dependencies: AtlasServerDependencies) {
  return new Elysia({ name: "atlas-skills-routes" })
    .get(
      "/api/skills",
      ({ query, request, set }) => {
        try {
          const parsed = parseQuery(query, listSkillsQuerySchema, "listSkills");
          return ok(requestIdFrom(request), dependencies.store.listSkills(compactListSkills(parsed)));
        } catch (error) {
          return routeError(error, request, set);
        }
      },
      docs.listSkills
    )
    .get(
      "/api/skills/:skillId",
      ({ params, request, set }) => {
        try {
          const { skillId } = parseParams(params, skillIdParamSchema, "getSkill");
          return ok(requestIdFrom(request), presentSkillDetail(dependencies.store.getSkill(skillId)));
        } catch (error) {
          return routeError(error, request, set);
        }
      },
      docs.getSkill
    );
}

function compactListSkills(query: import("../schemas/repo.schema").ListSkillsQuery) {
  return {
    ...(query.repoId === undefined ? {} : { repoId: query.repoId }),
    ...(query.packageId === undefined ? {} : { packageId: query.packageId }),
    ...(query.moduleId === undefined ? {} : { moduleId: query.moduleId }),
    ...(query.limit === undefined ? {} : { limit: query.limit })
  };
}
