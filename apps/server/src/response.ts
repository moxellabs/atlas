import { type z } from "zod";

import type {
	apiFailureSchema,
	apiSuccessSchema,
} from "./schemas/response.schema";

/** Successful API response envelope. */
export type ApiSuccess<T> = Omit<
	z.infer<typeof apiSuccessSchema>,
	"data"
> & { data: T };

/** Error API response envelope. */
export type ApiFailure = z.infer<typeof apiFailureSchema>;

/** Wraps route payloads in the stable success envelope. */
export function ok<T>(requestId: string, data: T): ApiSuccess<T> {
  return { ok: true, requestId, data };
}

/** Wraps route errors in the stable failure envelope. */
export function fail(requestId: string, code: string, message: string, details?: unknown): ApiFailure {
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

/** Returns the caller-supplied request ID or a stable local fallback. */
export function requestIdFrom(request: Request): string {
  return request.headers.get("x-request-id") ?? "local";
}
