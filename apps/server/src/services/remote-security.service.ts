import { timingSafeEqual } from "node:crypto";
import { isIP } from "node:net";
import type { ResolvedAtlasConfig } from "@atlas/config";

import { requestIdFrom } from "../response";
import type { ServerEnv } from "../env";

export const MAX_HTTP_REQUEST_BODY_BYTES = 1024 * 1024;
const REMOTE_READ_POST_PATHS = new Set([
  "/api/search/scopes",
  "/api/search/docs",
  "/api/context/plan",
]);
const REMOTE_READ_GET_PATHS = new Set(["/health", "/version", "/api/repos"]);

interface RateWindow {
  count: number;
  resetAt: number;
}

/** Enforces the fail-closed boundary for a reverse-proxied Atlas server. */
export class RemoteSecurityService {
  private readonly windows = new Map<string, RateWindow>();

  constructor(
    private readonly env: ServerEnv,
    private readonly indexedRepoIds: () => readonly string[],
  ) {}

  get enabled(): boolean {
    return this.env.remote?.enabled === true || !isLoopbackHost(this.env.host);
  }

  async authorize(request: Request): Promise<Response | undefined> {
    if (!this.enabled) return undefined;
    if (this.env.remote === undefined)
      return this.deny(
        request,
        403,
        "forbidden",
        "Remote access is disabled until its security settings are configured.",
      );
    const path = new URL(request.url).pathname;
    if (request.method === "OPTIONS") return undefined;
    if (request.headers.get("x-forwarded-proto") !== "https")
      return this.deny(request, 400, "tls_required", "HTTPS is required.");
    if (!authorized(request, this.remote().token))
      return this.deny(
        request,
        401,
        "unauthorized",
        "A valid bearer token is required.",
        {
          "www-authenticate": 'Bearer realm="atlas"',
        },
      );
    if (!remoteMethodAllowed(request.method, path))
      return this.deny(
        request,
        405,
        "remote_read_only",
        "This route is not available on a remote read-only server.",
      );
    if (!this.takeRateSlot())
      return this.deny(
        request,
        429,
        "rate_limited",
        "Remote request rate limit exceeded.",
        { "retry-after": "60" },
      );
    if (
      this.indexedRepoIds().some(
        (repoId) => !this.remote().repoAllowlist.includes(repoId),
      )
    )
      return this.deny(
        request,
        503,
        "repository_scope_changed",
        "The indexed corpus no longer matches this server's allowed scope.",
      );
    const pathRepoId = path.match(/^\/api\/repos\/([^/]+)/u)?.[1];
    if (
      pathRepoId !== undefined &&
      !this.remote().repoAllowlist.includes(decodeURIComponent(pathRepoId))
    )
      return this.deny(
        request,
        403,
        "repository_scope_denied",
        "The requested repository is outside this server's allowed scope.",
      );
    const contentLength = Number(request.headers.get("content-length") ?? "0");
    if (
      Number.isFinite(contentLength) &&
      contentLength > MAX_HTTP_REQUEST_BODY_BYTES
    )
      return this.deny(
        request,
        413,
        "payload_too_large",
        "Remote request body is too large.",
      );
    if (request.body !== null) {
      const body = await readBoundedBody(
        request.clone(),
        MAX_HTTP_REQUEST_BODY_BYTES,
      );
      if (body === undefined)
        return this.deny(
          request,
          413,
          "payload_too_large",
          "Remote request body is too large.",
        );
      if (path === "/mcp" && isJsonRpcBatch(body))
        return this.deny(
          request,
          400,
          "mcp_batch_not_allowed",
          "Remote MCP requests must contain one JSON-RPC message.",
        );
      const scopedRepoId = repoIdFromBody(body);
      if (
        scopedRepoId !== undefined &&
        !this.remote().repoAllowlist.includes(scopedRepoId)
      )
        return this.deny(
          request,
          403,
          "repository_scope_denied",
          "The requested repository is outside this server's allowed scope.",
        );
    }
    this.audit(request, "allowed", 0);
    return undefined;
  }

  async limitResponse(request: Request, response: unknown): Promise<unknown> {
    if (
      !this.enabled ||
      response === undefined ||
      this.env.remote === undefined
    )
      return response;
    const maxBytes = this.remote().maxResponseBytes;
    if (
      response instanceof Response &&
      response.body !== null &&
      response.headers.get("content-type")?.includes("text/event-stream") ===
        true
    )
      return this.limitStreamingResponse(request, response, maxBytes);
    if (response instanceof Response) {
      const declared = Number(response.headers.get("content-length") ?? "0");
      if (Number.isFinite(declared) && declared > maxBytes)
        return this.deny(
          request,
          502,
          "response_too_large",
          "Remote response exceeded the configured size limit.",
        );
      return (await readBoundedStream(response.clone().body, maxBytes)) !==
        undefined
        ? response
        : this.deny(
            request,
            502,
            "response_too_large",
            "Remote response exceeded the configured size limit.",
          );
    }
    const bytes = new TextEncoder().encode(
      typeof response === "string" ? response : JSON.stringify(response),
    ).byteLength;
    return bytes <= maxBytes
      ? response
      : this.deny(
          request,
          502,
          "response_too_large",
          "Remote response exceeded the configured size limit.",
        );
  }

  private takeRateSlot(): boolean {
    const now = Date.now();
    // One deployment token is one trust boundary. Forwarded client headers are
    // not trusted as rate-limit keys because callers can spoof them.
    const key = "bearer";
    const current = this.windows.get(key);
    if (current === undefined || current.resetAt <= now) {
      if (current === undefined && this.windows.size >= 1024) {
        for (const [candidate, window] of this.windows)
          if (window.resetAt <= now) this.windows.delete(candidate);
        if (this.windows.size >= 1024) return false;
      }
      this.windows.set(key, { count: 1, resetAt: now + 60_000 });
      return true;
    }
    current.count += 1;
    return current.count <= this.remote().rateLimitPerMinute;
  }

  private limitStreamingResponse(
    request: Request,
    response: Response,
    maxBytes: number,
  ): Response {
    let bytes = 0;
    const audit = (outcome: string, status: number) =>
      this.audit(request, outcome, status);
    const body = response.body?.pipeThrough(
      new TransformStream<Uint8Array, Uint8Array>({
        transform(chunk, controller) {
          bytes += chunk.byteLength;
          if (bytes > maxBytes) {
            audit("response_stream_too_large", 502);
            controller.error(
              new Error(
                "Remote MCP stream exceeded the configured size limit.",
              ),
            );
            return;
          }
          controller.enqueue(chunk);
        },
      }),
    );
    return new Response(body, {
      status: response.status,
      statusText: response.statusText,
      headers: response.headers,
    });
  }

  private deny(
    request: Request,
    status: number,
    code: string,
    message: string,
    headers: Record<string, string> = {},
  ): Response {
    this.audit(request, code, status);
    return Response.json(
      {
        ok: false,
        requestId: requestIdFrom(request),
        error: { code, message },
      },
      { status, headers },
    );
  }

  private audit(request: Request, outcome: string, status: number): void {
    console.log(
      JSON.stringify({
        event: "remote_access",
        requestId: requestIdFrom(request),
        method: request.method,
        path: new URL(request.url).pathname,
        outcome,
        ...(status === 0 ? {} : { status }),
      }),
    );
  }

  private remote() {
    const remote = this.env.remote;
    if (remote === undefined)
      throw new Error("Remote security settings are unavailable.");
    return remote;
  }
}

/** Validates remote prerequisites before the listener is opened. */
export function assertRemoteExposureSafe(
  env: ServerEnv,
  config: ResolvedAtlasConfig,
  indexedRepoIds: readonly string[] = [],
): void {
  if (!isLoopbackHost(env.host))
    throw new Error(
      "Atlas remote mode must bind to loopback and sit behind an HTTPS reverse proxy; public listener binds are refused.",
    );
  const remote = env.remote;
  if (remote?.enabled !== true) return;
  if (env.enableTelemetry)
    throw new Error(
      "Atlas remote mode requires ATLAS_ENABLE_TELEMETRY=false because the current telemetry plugin records request headers.",
    );
  if (!remote.tlsTerminated)
    throw new Error(
      "Atlas remote mode requires ATLAS_REMOTE_TLS_TERMINATED=true behind an HTTPS reverse proxy.",
    );
  if (remote.token.length < 32)
    throw new Error(
      "Atlas remote mode requires ATLAS_REMOTE_AUTH_TOKEN or ATLAS_REMOTE_AUTH_TOKEN_FILE with at least 32 characters.",
    );
  if (remote.repoAllowlist.length === 0)
    throw new Error(
      "Atlas remote mode requires a non-empty ATLAS_REMOTE_REPO_ALLOWLIST.",
    );
  if (remote.repoAllowlist.length > 100)
    throw new Error(
      "Atlas remote mode supports at most 100 repositories in ATLAS_REMOTE_REPO_ALLOWLIST.",
    );
  const disallowed = [
    ...new Set([
      ...config.config.repos.map((repo) => repo.repoId),
      ...indexedRepoIds,
    ]),
  ].filter((repoId) => !remote.repoAllowlist.includes(repoId));
  if (disallowed.length > 0)
    throw new Error(
      `Atlas config or corpus contains repositories outside ATLAS_REMOTE_REPO_ALLOWLIST: ${disallowed.join(", ")}.`,
    );
}

export function isLoopbackHost(host: string): boolean {
  const normalized = host
    .trim()
    .toLowerCase()
    .replace(/^\[|\]$/gu, "");
  if (normalized === "localhost" || normalized === "::1") return true;
  return isIP(normalized) === 4 && normalized.split(".", 1)[0] === "127";
}

function remoteMethodAllowed(method: string, path: string): boolean {
  if (path === "/mcp")
    return method === "GET" || method === "POST" || method === "DELETE";
  if (method === "GET") return REMOTE_READ_GET_PATHS.has(path);
  return method === "POST" && REMOTE_READ_POST_PATHS.has(path);
}

function authorized(request: Request, expectedToken: string): boolean {
  const authorization = request.headers.get("authorization");
  if (authorization === null || !authorization.startsWith("Bearer "))
    return false;
  const actual = Buffer.from(authorization.slice("Bearer ".length));
  const expected = Buffer.from(expectedToken);
  return actual.length === expected.length && timingSafeEqual(actual, expected);
}

async function readBoundedBody(
  request: Request,
  maxBytes: number,
): Promise<Uint8Array | undefined> {
  return readBoundedStream(request.body, maxBytes);
}

async function readBoundedStream(
  stream: ReadableStream<Uint8Array> | null,
  maxBytes: number,
): Promise<Uint8Array | undefined> {
  if (stream === null) return new Uint8Array();
  const reader = stream.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      total += value.byteLength;
      if (total > maxBytes) {
        void reader.cancel().catch(() => undefined);
        return undefined;
      }
      chunks.push(value);
    }
  } finally {
    reader.releaseLock();
  }
  const body = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    body.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return body;
}
function isJsonRpcBatch(body: Uint8Array): boolean {
  if (body.byteLength === 0) return false;
  try {
    return Array.isArray(JSON.parse(new TextDecoder().decode(body)));
  } catch {
    return false;
  }
}

function repoIdFromBody(body: Uint8Array): string | undefined {
  if (body.byteLength === 0) return undefined;
  let parsed: unknown;
  try {
    parsed = JSON.parse(new TextDecoder().decode(body));
  } catch {
    return undefined;
  }
  if (!isRecord(parsed)) return undefined;
  if (typeof parsed.repoId === "string") return parsed.repoId;
  if (parsed.method !== "tools/call" || !isRecord(parsed.params))
    return undefined;
  const args = parsed.params.arguments;
  return isRecord(args) && typeof args.repoId === "string"
    ? args.repoId
    : undefined;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
