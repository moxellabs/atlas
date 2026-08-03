import { atlasRepoConfigSchema } from "@atlas/config";
import { z } from "zod";

import { repoIdParamSchema } from "../../schemas/common.schema";
import {
  forbiddenResponse,
  jsonRequest,
  notFoundResponse,
  okResponses,
  operation,
  pathParam,
} from "./helpers";

const repoListItemSchema = z
  .object({
    repoId: z.string(),
    mode: z.string(),
    revision: z.string().nullable().optional(),
    indexedRevision: z.string().nullable().optional(),
    fresh: z.boolean(),
  })
  .passthrough();

const repoDetailSchema = z
  .object({
    repo: z.unknown(),
    counts: z.record(z.string(), z.number()).optional(),
  })
  .passthrough();

const repoIdParam = pathParam(
  "repoId",
  "Repository ID from atlas.config. Example: github.com/org/repo.",
  repoIdParamSchema.shape.repoId,
);

export const repositoryDocs = {
  listRepos: operation({
    tags: ["Repositories"],
    operationId: "listRepositories",
    summary: "List indexed repositories",
    description:
      "Lists repositories currently present in the local ATLAS store with freshness metadata, using only registry and corpus state already available on this machine.",
    responses: okResponses(z.array(repoListItemSchema)),
  }),
  getRepo: operation({
    tags: ["Repositories"],
    operationId: "getRepository",
    summary: "Inspect one repository",
    description:
      "Returns repository metadata, packages, modules, documents, skills, and aggregate counts for one local repository such as github.com/org/repo without fetching remote source.",
    parameters: [repoIdParam],
    responses: okResponses(repoDetailSchema, { 404: notFoundResponse() }),
  }),
  createRepo: operation({
    tags: ["Repositories"],
    operationId: "createRepository",
    summary: "Register repository config",
    description:
      "Adds one repository to the local ATLAS config file. This mutation route is intended for loopback/local development use and should reference a safe repo ID such as github.com/org/repo.",
    requestBody: jsonRequest(
      atlasRepoConfigSchema,
      "Repository config to register.",
    ),
    responses: okResponses(atlasRepoConfigSchema, { 403: forbiddenResponse() }),
  }),
  replaceRepo: operation({
    tags: ["Repositories"],
    operationId: "replaceRepository",
    summary: "Replace repository config",
    description:
      "Replaces one configured repository and refreshes config-bound runtime services without restarting the server. Use from trusted loopback clients because it mutates local config state.",
    parameters: [repoIdParam],
    requestBody: jsonRequest(
      atlasRepoConfigSchema,
      "Replacement repository config. Body repoId must match the path repoId.",
    ),
    responses: okResponses(atlasRepoConfigSchema, {
      403: forbiddenResponse(),
      404: notFoundResponse(),
    }),
  }),
  deleteRepo: operation({
    tags: ["Repositories"],
    operationId: "deleteRepository",
    summary: "Delete repository config",
    description:
      "Removes one repository from the local ATLAS config file. Indexed store rows and caches are not deleted, so local corpus inspection remains safe after config cleanup.",
    parameters: [repoIdParam],
    responses: okResponses(
      z.object({ repoId: z.string(), deleted: z.boolean() }).strict(),
      { 403: forbiddenResponse(), 404: notFoundResponse() },
    ),
  }),
} as const;

export { repoDetailSchema };
