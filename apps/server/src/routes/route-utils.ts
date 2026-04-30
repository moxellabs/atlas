import { z, type ZodType } from "zod";

import { AtlasServerError, ServerValidationError } from "../errors";
import { fail } from "../response";
import { requestIdFrom } from "../response";

export const MAX_JSON_BODY_BYTES = 1024 * 1024;

class JsonBodyTooLargeError extends AtlasServerError {
  constructor(operation: string, details: { maxBytes: number; actualBytes?: number }) {
    super("Request JSON body is too large.", {
      code: "payload_too_large",
      status: 413,
      context: { operation, entity: "body", details },
    });
  }
}

async function readJsonBodyText(request: Request, operation: string, maxBytes = MAX_JSON_BODY_BYTES): Promise<string> {
  const contentLength = request.headers.get("content-length");
  if (contentLength !== null) {
    const declaredBytes = Number(contentLength);
    if (Number.isFinite(declaredBytes) && declaredBytes > maxBytes) {
      throw new JsonBodyTooLargeError(operation, { maxBytes, actualBytes: declaredBytes });
    }
  }

  const reader = request.body?.getReader();
  if (reader === undefined) {
    return "";
  }

  const chunks: Uint8Array[] = [];
  let bytesRead = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) {
        break;
      }
      bytesRead += value.byteLength;
      if (bytesRead > maxBytes) {
        throw new JsonBodyTooLargeError(operation, { maxBytes, actualBytes: bytesRead });
      }
      chunks.push(value);
    }
  } finally {
    reader.releaseLock();
  }

  return new TextDecoder().decode(concatChunks(chunks, bytesRead));
}

function concatChunks(chunks: Uint8Array[], totalBytes: number): Uint8Array {
  if (chunks.length === 1) {
    return chunks[0] ?? new Uint8Array();
  }
  const body = new Uint8Array(totalBytes);
  let offset = 0;
  for (const chunk of chunks) {
    body.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return body;
}

/** Parses and validates a JSON body for route handlers. */
export async function parseJsonBody<T>(request: Request, schema: ZodType<T>, operation: string): Promise<T> {
  let body: unknown;
  try {
    body = JSON.parse(await readJsonBodyText(request, operation));
  } catch (error) {
    if (error instanceof JsonBodyTooLargeError) {
      throw error;
    }
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
