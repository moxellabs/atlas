import { z } from "zod";

import {
  docIdParamSchema,
  sectionIdParamSchema,
  skillIdParamSchema,
} from "../../schemas/common.schema";
import { headingQuerySchema } from "../../schemas/docs.schema";
import { listSkillsQuerySchema } from "../../schemas/repo.schema";
import { buildBodySchema, syncBodySchema } from "../../schemas/sync.schema";
import {
  jsonRequest,
  notFoundResponse,
  okResponses,
  operation,
  pathParam,
  queryParam,
  validationResponse,
} from "./helpers";
const documentOutlineSchema = z
  .object({
    document: z.unknown(),
    outline: z.array(
      z
        .object({
          sectionId: z.string(),
          headingPath: z.array(z.string()),
          ordinal: z.number().int(),
          preview: z.string(),
        })
        .strict(),
    ),
    summaries: z.array(z.unknown()),
  })
  .passthrough();

const documentSectionSchema = z
  .object({
    section: z.unknown(),
    provenance: z.unknown(),
  })
  .passthrough();

const skillDetailSchema = z
  .object({
    skill: z.unknown(),
    sourceDocument: z.unknown().nullable().optional(),
  })
  .passthrough();

const docIdParam = pathParam(
  "docId",
  "Canonical ATLAS document ID. Example: docs/runtime-surfaces.md.",
  docIdParamSchema.shape.docId,
);
const sectionIdParam = pathParam(
  "sectionId",
  "Canonical ATLAS section ID from an indexed public artifact.",
  sectionIdParamSchema.shape.sectionId,
);
const skillIdParam = pathParam(
  "skillId",
  "Generated ATLAS skill ID. Example: document-codebase.",
  skillIdParamSchema.shape.skillId,
);

export const corpusOperationsDocs = {
  readDocumentOutline: operation({
    tags: ["Documents"],
    operationId: "readDocumentOutline",
    summary: "Read document outline",
    description:
      "Returns canonical document metadata, ordered section previews, and document summaries for an indexed public artifact such as docs/runtime-surfaces.md.",
    parameters: [docIdParam],
    responses: okResponses(documentOutlineSchema, {
      404: notFoundResponse(),
    }),
  }),
  readDocumentSectionById: operation({
    tags: ["Documents"],
    operationId: "readDocumentSectionById",
    summary: "Read section by ID",
    description:
      "Returns exact canonical section text, code blocks, and provenance for a stable section ID from indexed local public artifact content.",
    parameters: [docIdParam, sectionIdParam],
    responses: okResponses(documentSectionSchema, {
      404: notFoundResponse(),
    }),
  }),
  readDocumentSectionByHeading: operation({
    tags: ["Documents"],
    operationId: "readDocumentSectionByHeading",
    summary: "Read section by heading path",
    description:
      "Returns exact canonical section text, code blocks, and provenance for an exact heading path, useful when a client knows document structure but not section IDs.",
    parameters: [
      docIdParam,
      queryParam(
        "heading",
        "Repeated heading path segment. Example: ?heading=Session&heading=Rotation.",
        headingQuerySchema,
        true,
      ),
    ],
    responses: okResponses(documentSectionSchema, {
      404: notFoundResponse(),
    }),
  }),
  listSkills: operation({
    tags: ["Skills"],
    operationId: "listSkills",
    summary: "List generated skills",
    description:
      "Lists generated ATLAS skills, optionally constrained by repository, package, module, and limit for read-only local skill discovery such as document-codebase.",
    parameters: [
      queryParam(
        "repoId",
        "Optional repository ID.",
        listSkillsQuerySchema.shape.repoId,
      ),
      queryParam(
        "packageId",
        "Optional package ID.",
        listSkillsQuerySchema.shape.packageId,
      ),
      queryParam(
        "moduleId",
        "Optional module ID.",
        listSkillsQuerySchema.shape.moduleId,
      ),
      queryParam(
        "limit",
        "Maximum number of skills to return.",
        listSkillsQuerySchema.shape.limit,
      ),
    ],
    responses: okResponses(z.array(z.unknown())),
  }),
  getSkill: operation({
    tags: ["Skills"],
    operationId: "getSkill",
    summary: "Get one generated skill",
    description:
      "Returns a generated skill such as document-codebase plus its source canonical document when available, using local indexed skill artifacts only.",
    parameters: [skillIdParam],
    responses: okResponses(skillDetailSchema, { 404: notFoundResponse() }),
  }),
  sync: operation({
    tags: ["Operations"],
    operationId: "requestSync",
    summary: "Request repository sync",
    description:
      "Synchronizes one repository or all configured repositories and returns structured source-update reports. Use incremental for normal local maintenance and trusted loopback callers only.",
    requestBody: jsonRequest(
      syncBodySchema,
      "Sync request. Example repoId: github.com/org/repo. Example mode: incremental.",
    ),
    responses: okResponses(z.unknown(), { 400: validationResponse() }),
  }),
  build: operation({
    tags: ["Operations"],
    operationId: "requestBuild",
    summary: "Request artifact build",
    description:
      "Builds one repository or all configured repositories, supporting full, incremental, and targeted partial rebuilds of local Atlas artifacts for trusted loopback callers.",
    requestBody: jsonRequest(
      buildBodySchema,
      "Build request. Example repoId: github.com/org/repo. Example mode: incremental. Example docIds entry: docs/runtime-surfaces.md.",
    ),
    responses: okResponses(z.unknown(), { 400: validationResponse() }),
  }),
} as const;
