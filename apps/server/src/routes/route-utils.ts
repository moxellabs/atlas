import { z, type ZodType } from "zod";

import { AtlasServerError, ServerValidationError } from "../errors";
import { fail } from "../response";
import { requestIdFrom } from "../response";

/** Parses and validates a JSON body for route handlers. */
export async function parseJsonBody<T>(request: Request, schema: ZodType<T>, operation: string): Promise<T> {
  let body: unknown;
  try {
    body = await request.json();
  } catch (error) {
    throw new ServerValidationError("Request body must be valid JSON.", { operation, entity: "body", cause: error });
  }
  try {
    return schema.parse(body);
  } catch (error) {
    throw new ServerValidationError("Request body validation failed.", { operation, entity: "body", cause: error, details: error });
  }
}

/** Validates query parameters from an Elysia query object. */
export function parseQuery<T>(query: Record<string, unknown>, schema: ZodType<T>, operation: string): T {
  try {
    return schema.parse(query);
  } catch (error) {
    throw new ServerValidationError("Query parameters are invalid.", { operation, entity: "query", cause: error, details: error });
  }
}

/** Validates route params from an Elysia params object. */
export function parseParams<T>(params: Record<string, unknown>, schema: ZodType<T>, operation: string): T {
  try {
    return schema.parse(params);
  } catch (error) {
    throw new ServerValidationError("Route parameters are invalid.", { operation, entity: "params", cause: error, details: error });
  }
}

/** Converts expected route-layer errors into the shared failure envelope. */
export function routeError(error: unknown, request: Request, set: { status?: number | string }): ReturnType<typeof fail> {
  if (error instanceof AtlasServerError) {
    set.status = error.status;
    return fail(requestIdFrom(request), error.code, error.message, error.context.details);
  }
  if (error instanceof z.ZodError || (error instanceof Error && error.name === "ZodError")) {
    set.status = 400;
    return fail(requestIdFrom(request), "validation_failed", "Request validation failed.", error);
  }
  throw error;
}
