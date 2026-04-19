import type { GhesClient, GhesRequestOptions } from "./ghes-client";
import { GhesPaginationError } from "../errors";

export type ParsedLinkHeader = Record<string, string>;

export function parseLinkHeader(header: string | null): ParsedLinkHeader {
  if (!header) {
    return {};
  }

  const links: ParsedLinkHeader = {};
  for (const part of header.split(",")) {
    const match = /^\s*<([^>]+)>;\s*rel="([^"]+)"\s*$/.exec(part.trim());
    if (!match) {
      throw new GhesPaginationError({
        operation: "parseLinkHeader",
        message: `Invalid Link header segment: ${part.trim()}`
      });
    }
    const [, url, rel] = match;
    if (url && rel) {
      links[rel] = url;
    }
  }
  return links;
}

export function getNextPageUrl(headers: Headers): string | undefined {
  return parseLinkHeader(headers.get("link")).next;
}

export async function paginateRequest<T>(
  client: GhesClient,
  options: GhesRequestOptions,
  readItems: (data: unknown) => T[]
): Promise<T[]> {
  const items: T[] = [];
  let nextUrl: string | undefined;
  let pageCount = 0;

  do {
    const response = await client.request<unknown>({
      ...options,
      ...(nextUrl ? { path: undefined, query: undefined, url: nextUrl } : {})
    });
    pageCount += 1;
    items.push(...readItems(response.data));
    nextUrl = getNextPageUrl(response.headers);
  } while (nextUrl);

  if (pageCount === 0) {
    throw new GhesPaginationError({
      repoId: options.repoId,
      operation: options.operation,
      message: "Pagination completed without reading any page."
    });
  }

  return items;
}
