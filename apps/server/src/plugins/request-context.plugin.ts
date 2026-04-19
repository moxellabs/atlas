import { Elysia } from "elysia";

/** Adds a stable request ID to every Elysia context. */
export const requestContextPlugin = new Elysia({ name: "atlas-request-context" }).derive(({ request }) => ({
  requestId: request.headers.get("x-request-id") ?? crypto.randomUUID()
}));
