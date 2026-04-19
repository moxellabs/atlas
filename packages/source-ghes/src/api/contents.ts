import type { GhesClient } from "../client/ghes-client";
import { GhesContentReadError } from "../errors";

export interface GhesFileContentResponse {
  type: "file";
  encoding: string;
  size: number;
  name: string;
  path: string;
  content: string;
  sha: string;
  url: string;
  git_url: string | null;
  download_url: string | null;
}

export interface ReadContentOptions {
  client: GhesClient;
  repoId: string;
  owner: string;
  repoName: string;
  path: string;
  ref: string;
}

/**
 * Direct contents API read used as a documented fallback path. Repo-wide
 * discovery remains tree/blob based so adapter behavior stays deterministic.
 */
export async function readContentText(options: ReadContentOptions): Promise<string> {
  try {
    const response = await options.client.request<GhesFileContentResponse>({
      path: `/repos/${encodeSegment(options.owner)}/${encodeSegment(options.repoName)}/contents/${encodePath(options.path)}`,
      query: { ref: options.ref },
      operation: "readContentText",
      repoId: options.repoId
    });
    return decodeContentResponse(response.data, options);
  } catch (cause) {
    if (cause instanceof GhesContentReadError) {
      throw cause;
    }
    throw new GhesContentReadError({
      repoId: options.repoId,
      owner: options.owner,
      repoName: options.repoName,
      path: options.path,
      ref: options.ref,
      operation: "readContentText",
      cause
    });
  }
}

export function decodeContentResponse(content: GhesFileContentResponse, context: Omit<ReadContentOptions, "client">): string {
  if (!content || content.type !== "file" || typeof content.content !== "string" || typeof content.encoding !== "string") {
    throw new GhesContentReadError({
      repoId: context.repoId,
      owner: context.owner,
      repoName: context.repoName,
      path: context.path,
      ref: context.ref,
      operation: "decodeContentResponse",
      message: "Unexpected GHES contents response shape."
    });
  }

  if (content.encoding !== "base64") {
    throw new GhesContentReadError({
      repoId: context.repoId,
      owner: context.owner,
      repoName: context.repoName,
      path: context.path,
      ref: context.ref,
      operation: "decodeContentResponse",
      message: `Unsupported GHES contents encoding: ${content.encoding}.`
    });
  }

  try {
    return Buffer.from(content.content.replaceAll(/\s/g, ""), "base64").toString("utf8");
  } catch (cause) {
    throw new GhesContentReadError({
      repoId: context.repoId,
      owner: context.owner,
      repoName: context.repoName,
      path: context.path,
      ref: context.ref,
      operation: "decodeContentResponse",
      cause
    });
  }
}

function encodePath(path: string): string {
  return path.split("/").map(encodeSegment).join("/");
}

function encodeSegment(value: string): string {
  return encodeURIComponent(value);
}
