import { Elysia } from "elysia";
import { ZodError } from "zod";

import { AtlasServerError } from "../errors";
import type { ApiFailure } from "../response";
import { requestIdFrom } from "../response";

/** Centralized error-to-response mapper for all HTTP routes. */
export const errorPlugin = new Elysia({ name: "atlas-error" }).onError(({ code, error, set, request }) => {
  const id = requestIdFrom(request);
  if (error instanceof AtlasServerError) {
    set.status = error.status;
    return jsonFailure(error.status, id, error.code, error.message, error.context.details);
  }
  if (error instanceof ZodError) {
    set.status = 400;
    return jsonFailure(400, id, "validation_failed", "Request validation failed.", error.issues);
  }
  if (code === "NOT_FOUND") {
    set.status = 404;
    return jsonFailure(404, id, "not_found", "The requested ATLAS route does not exist.");
  }

  set.status = 500;
  return jsonFailure(500, id, "internal_error", error instanceof Error ? error.message : "Unexpected server error.");
});

function failure(requestId: string, code: string, message: string, details?: unknown): ApiFailure {
  return {
    ok: false,
    requestId,
    error: {
      code,
      message,
      ...(details === undefined ? {} : { details })
    }
  };
}

function jsonFailure(status: number, requestId: string, code: string, message: string, details?: unknown): Response {
  return Response.json(failure(requestId, code, message, details), { status });
}
