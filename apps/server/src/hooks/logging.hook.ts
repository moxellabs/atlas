import { Elysia } from "elysia";

import { requestIdFrom } from "../response";

/** Creates structured request logging hooks controlled by env. */
export function createLoggingHook(enabled: boolean) {
  return new Elysia({ name: "atlas-logging-hook" })
    .derive(() => ({ startedAt: performance.now() }))
    .onAfterResponse(({ request, set, startedAt }) => {
      if (!enabled) {
        return;
      }
      const durationMs = Number((performance.now() - startedAt).toFixed(2));
      console.log(
        JSON.stringify({
          event: "request",
          requestId: requestIdFrom(request),
          method: request.method,
          path: new URL(request.url).pathname,
          status: set.status ?? 200,
          durationMs
        })
      );
    });
}
