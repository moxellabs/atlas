import { buildAuthHeaders, describeAuth, type GhesAuthConfig } from "./auth";
import { GhesAuthenticationError, GhesConfigurationError, GhesRequestError } from "../errors";

export type GhesFetch = (input: RequestInfo | URL, init?: RequestInit) => Promise<Response>;

export interface GhesClientOptions {
  baseUrl: string;
  auth: GhesAuthConfig;
  fetch?: GhesFetch | undefined;
  userAgent?: string | undefined;
}

export interface GhesRequestOptions {
  method?: "GET" | "POST" | "PATCH" | "PUT" | "DELETE" | undefined;
  path?: string | undefined;
  url?: string | undefined;
  query?: Record<string, string | number | boolean | undefined> | undefined;
  operation: string;
  repoId?: string | undefined;
}

export interface GhesResponse<T> {
  status: number;
  headers: Headers;
  data: T;
  url: string;
}

/** Minimal GHES REST client with explicit base URL and auth handling. */
export class GhesClient {
  readonly #baseUrl: string;
  readonly #auth: GhesAuthConfig;
  readonly #fetch: GhesFetch;
  readonly #userAgent: string;

  constructor(options: GhesClientOptions) {
    this.#baseUrl = normalizeBaseUrl(options.baseUrl);
    this.#auth = options.auth;
    this.#fetch = options.fetch ?? fetch;
    this.#userAgent = options.userAgent ?? "atlas-source-ghes";
  }

  get baseUrl(): string {
    return this.#baseUrl;
  }

  async request<T>(options: GhesRequestOptions): Promise<GhesResponse<T>> {
    const url = buildRequestUrl(this.#baseUrl, options);
    const headers = buildHeaders(this.#auth, this.#userAgent);
    let response: Response;

    try {
      response = await this.#fetch(url, {
        method: options.method ?? "GET",
        headers
      });
    } catch (cause) {
      throw new GhesRequestError({
        repoId: options.repoId,
        endpoint: safeEndpoint(url),
        operation: options.operation,
        baseUrl: this.#baseUrl,
        authMode: describeAuth(this.#auth).kind,
        cause
      });
    }

    if (!response.ok) {
      await handleErrorResponse(response, {
        repoId: options.repoId,
        operation: options.operation,
        baseUrl: this.#baseUrl,
        authMode: describeAuth(this.#auth).kind
      });
    }

    return {
      status: response.status,
      headers: response.headers,
      data: (await parseResponseBody(response)) as T,
      url
    };
  }
}

export function normalizeBaseUrl(baseUrl: string): string {
  try {
    const url = new URL(baseUrl);
    url.hash = "";
    url.search = "";
    return url.toString().replace(/\/+$/, "");
  } catch (cause) {
    throw new GhesConfigurationError({
      baseUrl,
      operation: "normalizeBaseUrl",
      cause
    });
  }
}

function buildRequestUrl(baseUrl: string, options: GhesRequestOptions): string {
  const url = options.url ? new URL(options.url) : new URL(`${baseUrl}/${(options.path ?? "").replace(/^\/+/, "")}`);
  for (const [key, value] of Object.entries(options.query ?? {})) {
    if (value !== undefined) {
      url.searchParams.set(key, String(value));
    }
  }
  return url.toString();
}

function buildHeaders(auth: GhesAuthConfig, userAgent: string): HeadersInit {
  return {
    accept: "application/vnd.github+json",
    "x-github-api-version": "2022-11-28",
    "user-agent": userAgent,
    ...buildAuthHeaders(auth)
  };
}

async function handleErrorResponse(
  response: Response,
  context: {
    repoId?: string | undefined;
    operation: string;
    baseUrl: string;
    authMode: string;
  }
): Promise<never> {
  const message = await readErrorMessage(response);
  const errorContext = {
    ...context,
    endpoint: safeEndpoint(response.url),
    status: response.status,
    message
  };
  if (response.status === 401 || response.status === 403) {
    throw new GhesAuthenticationError(errorContext);
  }
  throw new GhesRequestError(errorContext);
}

async function parseResponseBody(response: Response): Promise<unknown> {
  if (response.status === 204) {
    return undefined;
  }
  const text = await response.text();
  if (text.trim().length === 0) {
    return undefined;
  }
  try {
    return JSON.parse(text) as unknown;
  } catch (cause) {
    throw new GhesRequestError({
      endpoint: safeEndpoint(response.url),
      status: response.status,
      operation: "parseResponseBody",
      cause
    });
  }
}

async function readErrorMessage(response: Response): Promise<string | undefined> {
  try {
    const text = await response.text();
    if (text.trim().length === 0) {
      return undefined;
    }
    const parsed = JSON.parse(text) as { message?: unknown };
    return typeof parsed.message === "string" ? parsed.message : text.slice(0, 500);
  } catch {
    return undefined;
  }
}

function safeEndpoint(rawUrl: string): string {
  try {
    const url = new URL(rawUrl);
    return `${url.origin}${url.pathname}`;
  } catch {
    return rawUrl;
  }
}
