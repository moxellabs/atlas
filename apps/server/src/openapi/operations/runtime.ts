import { z } from "zod";

import { okResponses, operation } from "./helpers";

const readinessSchema = z
  .object({
    store: z
      .object({
        dbPath: z.string(),
        schemaVersion: z.number().int(),
        repoCount: z.number().int(),
        documentCount: z.number().int(),
        chunkCount: z.number().int(),
        summaryCount: z.number().int(),
        lastMigration: z.number().int(),
        ftsEntryCount: z.number().int(),
      })
      .passthrough(),
    mcpEnabled: z.boolean(),
    uiEnabled: z.boolean(),
    openApiEnabled: z.boolean(),
  })
  .strict();

const healthDataSchema = z
  .object({
    ok: z.literal(true),
    service: z.string(),
    version: z.string(),
    readiness: readinessSchema,
  })
  .strict();

const versionDataSchema = z
  .object({ service: z.string(), version: z.string() })
  .strict();

export const runtimeDocs = {
  rootRedirect: {
    detail: {
      hide: true,
    },
  },
  health: operation({
    tags: ["Runtime"],
    operationId: "getHealth",
    summary: "Check server health",
    description:
      "Returns local server readiness, store diagnostics, and enabled runtime surfaces so local tools can confirm the loopback Atlas server is ready before issuing retrieval or mutation calls.",
    responses: okResponses(healthDataSchema),
  }),
  version: operation({
    tags: ["Runtime"],
    operationId: "getVersion",
    summary: "Get server version",
    description:
      "Returns the ATLAS service name and server package version for local diagnostics, generated clients, and compatibility checks.",
    responses: okResponses(versionDataSchema),
  }),
} as const;
