import { z } from "zod";

import { repoIdParamSchema } from "../../schemas/common.schema";
import { inspectRetrievalQuerySchema } from "../../schemas/repo.schema";
import {
  notFoundResponse,
  okResponses,
  operation,
  pathParam,
  queryParam,
} from "./helpers";
import { repoDetailSchema } from "./repositories";

const manifestInspectionSchema = z
  .object({
    diagnostics: z.unknown(),
    manifests: z.array(z.unknown()),
  })
  .passthrough();

const repoIdParam = pathParam(
  "repoId",
  "Repository ID from atlas.config. Example: github.com/org/repo.",
  repoIdParamSchema.shape.repoId,
);

export const inspectionDocs = {
  inspectManifest: operation({
    tags: ["Inspection"],
    operationId: "inspectManifest",
    summary: "Inspect manifest state",
    description:
      "Returns manifest rows and store diagnostics for local indexed repositories. This OpenAPI surface plus CLI inspect/list commands is the supported local inspector UI for now.",
    responses: okResponses(manifestInspectionSchema),
  }),
  inspectFreshness: operation({
    tags: ["Inspection"],
    operationId: "inspectFreshness",
    summary: "Inspect repository freshness",
    description:
      "Compares indexed revisions against current repository state known to the store so local tooling can warn about stale artifacts before retrieval.",
    responses: okResponses(z.array(z.unknown())),
  }),
  inspectTopology: operation({
    tags: ["Inspection"],
    operationId: "inspectTopology",
    summary: "Inspect compiled topology",
    description:
      "Returns package/module/document topology for one indexed repository such as github.com/org/repo from local store state only.",
    parameters: [repoIdParam],
    responses: okResponses(repoDetailSchema, { 404: notFoundResponse() }),
  }),
  inspectRetrieval: operation({
    tags: ["Inspection"],
    operationId: "inspectRetrieval",
    summary: "Inspect retrieval diagnostics",
    description:
      "Runs retrieval with diagnostics for local debugging and ranking inspection, for example query session rotation with budgetTokens 2000.",
    parameters: [
      queryParam(
        "query",
        "Natural-language query.",
        inspectRetrievalQuerySchema.shape.query,
        true,
      ),
      queryParam(
        "repoId",
        "Optional repository ID.",
        inspectRetrievalQuerySchema.shape.repoId,
      ),
      queryParam(
        "budgetTokens",
        "Maximum token budget for inspection.",
        inspectRetrievalQuerySchema.shape.budgetTokens,
      ),
    ],
    responses: okResponses(z.unknown()),
  }),
} as const;
