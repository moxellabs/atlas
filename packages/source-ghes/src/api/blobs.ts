import type { GhesClient } from "../client/ghes-client";
import { GhesBlobReadError } from "../errors";

export interface GhesBlobResponse {
  sha: string;
  node_id?: string | undefined;
  size: number;
  url: string;
  content: string;
  encoding: string;
}

export interface ReadBlobOptions {
  client: GhesClient;
  repoId: string;
  owner: string;
  repoName: string;
  sha: string;
  path?: string | undefined;
}

export async function readBlobText(options: ReadBlobOptions): Promise<string> {
  try {
    const response = await options.client.request<GhesBlobResponse>({
      path: `/repos/${encodeSegment(options.owner)}/${encodeSegment(options.repoName)}/git/blobs/${encodeSegment(options.sha)}`,
      operation: "readBlobText",
      repoId: options.repoId
    });
    return decodeBlobContent(response.data, options);
  } catch (cause) {
    if (cause instanceof GhesBlobReadError) {
      throw cause;
    }
    throw new GhesBlobReadError({
      repoId: options.repoId,
      owner: options.owner,
      repoName: options.repoName,
      path: options.path,
      ref: options.sha,
      operation: "readBlobText",
      cause
    });
  }
}

export function decodeBlobContent(blob: GhesBlobResponse, context: Omit<ReadBlobOptions, "client">): string {
  if (!blob || typeof blob.content !== "string" || typeof blob.encoding !== "string") {
    throw new GhesBlobReadError({
      repoId: context.repoId,
      owner: context.owner,
      repoName: context.repoName,
      path: context.path,
      operation: "decodeBlobContent",
      message: "Unexpected GHES blob response shape."
    });
  }

  if (blob.encoding !== "base64") {
    throw new GhesBlobReadError({
      repoId: context.repoId,
      owner: context.owner,
      repoName: context.repoName,
      path: context.path,
      operation: "decodeBlobContent",
      message: `Unsupported GHES blob encoding: ${blob.encoding}.`
    });
  }

  try {
    return Buffer.from(blob.content.replaceAll(/\s/g, ""), "base64").toString("utf8");
  } catch (cause) {
    throw new GhesBlobReadError({
      repoId: context.repoId,
      owner: context.owner,
      repoName: context.repoName,
      path: context.path,
      operation: "decodeBlobContent",
      cause
    });
  }
}

function encodeSegment(value: string): string {
  return encodeURIComponent(value);
}
