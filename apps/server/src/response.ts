/** Successful API response envelope. */
export interface ApiSuccess<T> {
  ok: true;
  requestId: string;
  data: T;
}

/** Error API response envelope. */
export interface ApiFailure {
  ok: false;
  requestId: string;
  error: {
    code: string;
    message: string;
    details?: unknown;
  };
}

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
